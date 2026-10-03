import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import test from 'node:test';
import request from 'supertest';
import { checkoutOrderResponseSchema } from '@marthub/contracts';
import { createApp } from '../../src/app.js';
import { readAuthConfig } from '../../src/config/auth.js';
import {
  readShippingConfig,
  validateDatabaseUrl,
} from '../../src/config/env.js';
import { createDatabase } from '../../src/db/client.js';
import { createSessionService } from '../../src/modules/auth/sessions.js';
import { createOrderService } from '../../src/modules/checkout/orders.js';

const config = readAuthConfig({
  AUTH_JWT_SECRET: randomBytes(32).toString('hex'),
  WEB_ORIGIN: 'https://shop.example.test',
  NODE_ENV: 'production',
});
const shippingPolicy = readShippingConfig({});
async function setup(t, price = 499999n) {
  const database = createDatabase(
    validateDatabaseUrl(process.env.DATABASE_URL),
  );
  const { prisma } = database;
  t.after(() => database.close());
  const suffix = randomUUID();
  const users = await Promise.all(
    ['CUSTOMER', 'CUSTOMER', 'ADMIN'].map((role, i) =>
      prisma.user.create({
        data: {
          email: `order-${suffix}-${i}@example.test`,
          passwordHash: 'unused',
          firstName: 'Order',
          lastName: 'Test',
          role,
        },
      }),
    ),
  );
  const addresses = await Promise.all(
    users.map((user) =>
      prisma.address.create({
        data: {
          userId: user.id,
          label: 'Home',
          recipientName: 'Order Test',
          phone: '0901234567',
          line1: '10 Original Street',
          ward: 'Ward',
          district: 'District',
          province: 'Province',
        },
      }),
    ),
  );
  const category = await prisma.category.create({
    data: { name: 'Order test', slug: `order-test-${suffix}` },
  });
  const product = await prisma.product.create({
    data: {
      categoryId: category.id,
      sku: `ORDER-${suffix}`,
      name: 'Original product',
      slug: `order-test-${suffix}`,
      status: 'ACTIVE',
      sellingUnit: 'each',
    },
  });
  await prisma.productPriceHistory.create({
    data: {
      productId: product.id,
      price,
      compareAtPrice: price + 1n,
      startsAt: new Date('2020-01-01'),
    },
  });
  await prisma.inventory.create({
    data: { productId: product.id, quantityOnHand: 10 },
  });
  const carts = await Promise.all(
    users.slice(0, 2).map((user) =>
      prisma.cart.create({
        data: {
          userId: user.id,
          items: { create: { productId: product.id, quantity: 1 } },
        },
        include: { items: true },
      }),
    ),
  );
  const sessions = createSessionService({ prisma, config });
  const tokens = await Promise.all(
    users.map(async (user) => (await sessions.issue(user.id)).data.accessToken),
  );
  const makeApp = (db = prisma) =>
    createApp({
      prisma: db,
      authConfig: config,
      shippingPolicy,
      origin: config.origin,
      logger: () => {},
    });
  const app = makeApp();
  const intent = { cartId: carts[0].id, addressId: addresses[0].id };
  const send = (key, body = intent, token = tokens[0], target = app) => {
    const req = request(target)
      .post('/api/v1/checkout/orders')
      .set('Authorization', `Bearer ${token}`);
    if (key !== undefined) req.set('Idempotency-Key', key);
    return req.send(body);
  };
  return {
    prisma,
    users,
    addresses,
    carts,
    product,
    category,
    tokens,
    app,
    makeApp,
    intent,
    send,
  };
}

test('new order is server-priced, no-store and atomic with items/actor history, stock movement and cart check-out', async (t) => {
  const f = await setup(t);
  const stock = await f.prisma.inventory.findUnique({
    where: { productId: f.product.id },
  });
  const cart = await f.prisma.cart.findUnique({
    where: { id: f.carts[0].id },
    include: { items: true },
  });
  const res = await f
    .send(randomUUID(), {
      ...f.intent,
      customerNote: '  Deliver at reception  ',
    })
    .expect(201);
  const data = res.body.data;
  assert.equal(checkoutOrderResponseSchema.safeParse(res.body).success, true);
  assert.match(res.headers['cache-control'], /no-store/);
  assert.equal(data.subtotal, '499999');
  assert.equal(data.shippingFee, '30000');
  assert.equal(data.discountTotal, '0');
  assert.equal(data.total, '529999');
  assert.equal(data.paymentMethod, 'COD');
  assert.equal(data.status, 'PENDING');
  assert.equal(data.address.line1, '10 Original Street');
  assert.equal(data.customerNote, 'Deliver at reception');
  assert.equal(data.items[0].unitPrice, '499999');
  assert.equal(data.items[0].compareAtPrice, '500000');
  assert.equal(data.items[0].productName, 'Original product');
  assert.equal(data.items[0].sellingUnit, 'each');
  assert.match(data.orderNumber, /^MH-[0-9a-f-]{36}$/);
  assert.equal('requestFingerprint' in data, false);
  assert.equal('idempotencyKey' in data, false);
  const history = await f.prisma.orderStatusHistory.findMany({
    where: { orderId: data.id },
  });
  assert.equal(history.length, 1);
  assert.equal(history[0].fromStatus, null);
  assert.equal(history[0].toStatus, 'PENDING');
  assert.equal(history[0].actorUserId, f.users[0].id);
  const inventory = await f.prisma.inventory.findUnique({
    where: { productId: f.product.id },
  });
  assert.equal(inventory.quantityOnHand, stock.quantityOnHand - 1);
  const checkedOut = await f.prisma.cart.findUnique({
    where: { id: cart.id },
    include: { items: true },
  });
  assert.equal(checkedOut.checkedOutAt.toISOString(), data.placedAt);
  assert.deepEqual(checkedOut.items, []);
  const movements = await f.prisma.inventoryMovement.findMany({
    where: { orderId: data.id },
  });
  assert.equal(movements.length, 1);
  assert.equal(movements[0].type, 'ORDER_DEBIT');
  assert.equal(movements[0].quantityDelta, -1);
  assert.equal(movements[0].quantityAfter, inventory.quantityOnHand);
  assert.equal(movements[0].actorUserId, f.users[0].id);
});

test('same canonical intent always replays after cart/address/catalog/price/stock changes without revalidation', async (t) => {
  const f = await setup(t, 9007199254740993n);
  const key = randomUUID();
  const first = await f.send(key).expect(201);
  assert.equal(first.body.data.total, '9007199254740993');
  await f.prisma.cartItem.deleteMany({ where: { cartId: f.carts[0].id } });
  await f.prisma.cart.update({
    where: { id: f.carts[0].id },
    data: { checkedOutAt: new Date() },
  });
  await f.prisma.cart.create({ data: { userId: f.users[0].id } });
  await f.prisma.address.update({
    where: { id: f.addresses[0].id },
    data: { line1: 'Changed Street', archivedAt: new Date() },
  });
  await f.prisma.product.update({
    where: { id: f.product.id },
    data: { name: 'Changed name', status: 'ARCHIVED', archivedAt: new Date() },
  });
  await f.prisma.inventory.update({
    where: { productId: f.product.id },
    data: { quantityOnHand: 0 },
  });
  const [{ now: future }] = await f.prisma
    .$queryRaw`SELECT CURRENT_TIMESTAMP AS now`;
  await f.prisma.$transaction(async (tx) => {
    await tx.productPriceHistory.updateMany({
      where: { productId: f.product.id },
      data: { endsAt: future },
    });
    await tx.productPriceHistory.create({
      data: { productId: f.product.id, price: 1n, startsAt: future },
    });
  });
  for (const customerNote of [null, '', '   ']) {
    const replayed = await f
      .send(key.toUpperCase(), {
        addressId: f.intent.addressId.toUpperCase(),
        cartId: f.intent.cartId.toUpperCase(),
        customerNote,
      })
      .expect(200);
    assert.deepEqual(replayed.body, first.body);
    assert.match(replayed.headers['cache-control'], /no-store/);
  }
  assert.equal(
    await f.prisma.order.count({ where: { userId: f.users[0].id } }),
    1,
  );
  assert.equal(
    await f.prisma.orderStatusHistory.count({
      where: { orderId: first.body.data.id },
    }),
    1,
  );
});

test('different cart/address/normalized note conflicts clearly; the same key remains independently Customer-scoped', async (t) => {
  const f = await setup(t);
  const key = randomUUID();
  const first = await f
    .send(key, { ...f.intent, customerNote: ' note ' })
    .expect(201);
  assert.deepEqual(
    (await f.send(key, { ...f.intent, customerNote: 'note' }).expect(200)).body,
    first.body,
  );
  for (const body of [
    { ...f.intent, cartId: randomUUID(), customerNote: 'note' },
    { ...f.intent, addressId: randomUUID(), customerNote: 'note' },
    { ...f.intent, customerNote: 'other' },
    f.intent,
  ]) {
    const error = await f.send(key, body).expect(400);
    assert.equal(error.body.error.code, 'IDEMPOTENCY_KEY_REUSED');
    assert.ok(error.body.error.requestId);
  }
  const second = await f
    .send(
      key,
      { cartId: f.carts[1].id, addressId: f.addresses[1].id },
      f.tokens[1],
    )
    .expect(201);
  assert.notEqual(second.body.data.id, first.body.data.id);
  assert.equal(
    await f.prisma.order.count({ where: { userId: f.users[0].id } }),
    1,
  );
});

test('order creation denies guests/Admin and invalid/foreign inputs without persisting an idempotency record', async (t) => {
  const f = await setup(t);
  const key = randomUUID();
  await request(f.app)
    .post('/api/v1/checkout/orders')
    .send(f.intent)
    .expect(401);
  await f.send(key, f.intent, f.tokens[2]).expect(403);
  for (const badKey of [undefined, 'bad', `${key},${randomUUID()}`])
    await f.send(badKey).expect(422);
  for (const input of [
    { addressId: f.intent.addressId },
    { ...f.intent, customerNote: 'a'.repeat(501) },
    ...[
      'userId',
      'items',
      'total',
      'stock',
      'price',
      'shippingFee',
      'status',
      'quoteId',
    ].map((field) => ({ ...f.intent, [field]: 1 })),
  ])
    await f.send(key, input).expect(422);
  await request(f.app)
    .post('/api/v1/checkout/orders?total=1')
    .set('Authorization', `Bearer ${f.tokens[0]}`)
    .set('Idempotency-Key', key)
    .send(f.intent)
    .expect(422);
  await f.send(key, { ...f.intent, cartId: f.carts[1].id }).expect(404);
  await f.send(key, { ...f.intent, addressId: f.addresses[1].id }).expect(404);
  await f.prisma.inventory.update({
    where: { productId: f.product.id },
    data: { quantityOnHand: 0 },
  });
  await f.send(key).expect(409);
  await f.prisma.inventory.update({
    where: { productId: f.product.id },
    data: { quantityOnHand: 10 },
  });
  await f.prisma.product.update({
    where: { id: f.product.id },
    data: { status: 'DRAFT' },
  });
  await f.send(key).expect(409);
  await f.prisma.product.update({
    where: { id: f.product.id },
    data: { status: 'ACTIVE' },
  });
  assert.equal(
    await f.prisma.order.count({ where: { userId: f.users[0].id } }),
    0,
  );
  await f
    .send(key, { ...f.intent, customerNote: ' ' + 'a'.repeat(500) + ' ' })
    .expect(201);
});

test('failed item/history writes and post-insert failure roll back all records; retry is a new request', async (t) => {
  const f = await setup(t);
  const key = randomUUID();
  for (const failure of ['item', 'history', 'after-insert']) {
    const wrapped = {
      ...f.prisma,
      $transaction: (callback) =>
        f.prisma.$transaction((tx) =>
          callback(
            new Proxy(tx, {
              get(target, prop) {
                if (prop !== 'order') return target[prop];
                return {
                  ...tx.order,
                  create: async (args) => {
                    if (failure === 'item')
                      args.data.items.create[0].lineTotal = 1n;
                    if (failure === 'history')
                      args.data.statusHistory.create.actorUserId = randomUUID();
                    const result = await tx.order.create(args);
                    if (failure === 'after-insert')
                      throw new Error('Forced rollback after nested writes');
                    return result;
                  },
                };
              },
            }),
          ),
        ),
    };
    await assert.rejects(
      createOrderService({ prisma: wrapped, shippingPolicy }).create(
        { user: f.users[0] },
        f.intent,
        key,
      ),
    );
    assert.equal(
      await f.prisma.order.count({ where: { userId: f.users[0].id } }),
      0,
    );
    assert.equal(
      await f.prisma.orderItem.count({ where: { productId: f.product.id } }),
      0,
    );
    assert.equal(
      await f.prisma.orderStatusHistory.count({
        where: { actorUserId: f.users[0].id },
      }),
      0,
    );
    assert.equal(
      (
        await f.prisma.inventory.findUnique({
          where: { productId: f.product.id },
        })
      ).quantityOnHand,
      10,
    );
    assert.equal(
      await f.prisma.cartItem.count({ where: { cartId: f.carts[0].id } }),
      1,
    );
  }
  await f.send(key).expect(201);
  await f.send(key).expect(200);
});

test('parallel identical requests commit one order/items/history and all return its identity', async (t) => {
  const f = await setup(t);
  const key = randomUUID();
  const results = await Promise.all(
    Array.from({ length: 8 }, (_, i) =>
      f.send(key, { ...f.intent, customerNote: i % 2 ? null : ' ' }),
    ),
  );
  assert.equal(results.filter((res) => res.status === 201).length, 1);
  assert.equal(results.filter((res) => res.status === 200).length, 7);
  for (const res of results) assert.deepEqual(res.body, results[0].body);
  const id = results[0].body.data.id;
  assert.equal(
    await f.prisma.order.count({ where: { userId: f.users[0].id } }),
    1,
  );
  assert.equal(await f.prisma.orderItem.count({ where: { orderId: id } }), 1);
  assert.equal(
    await f.prisma.orderStatusHistory.count({ where: { orderId: id } }),
    1,
  );
});

test('forced parallel key lookup serializes competing intents and returns clear key-reuse conflict', async (t) => {
  const f = await setup(t);
  let arrivals = 0;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const db = new Proxy(f.prisma, {
    get(target, prop) {
      if (prop !== '$transaction') return target[prop];
      return (callback, options) =>
        f.prisma.$transaction(
          (tx) =>
            callback(
              new Proxy(tx, {
                get(transaction, key) {
                  if (key !== 'order') return transaction[key];
                  return {
                    ...tx.order,
                    findUnique: async (args) => {
                      const found = await tx.order.findUnique(args);
                      if (arrivals < 2) {
                        assert.equal(found, null);
                        if (++arrivals === 2) release();
                        await gate;
                      }
                      return found;
                    },
                  };
                },
              }),
            ),
          options,
        );
    },
  });
  const key = randomUUID();
  const target = f.makeApp(db);
  const results = await Promise.all(
    ['first', 'second'].map((customerNote) =>
      f.send(key, { ...f.intent, customerNote }, f.tokens[0], target),
    ),
  );
  assert.deepEqual(results.map((res) => res.status).sort(), [201, 400]);
  assert.equal(
    results.find((res) => res.status === 400).body.error.code,
    'IDEMPOTENCY_KEY_REUSED',
  );
  const winner = results.find((res) => res.status === 201).body.data;
  assert.equal(
    await f.prisma.order.count({ where: { userId: f.users[0].id } }),
    1,
  );
  assert.equal(
    await f.prisma.orderItem.count({ where: { orderId: winner.id } }),
    1,
  );
  assert.equal(
    await f.prisma.orderStatusHistory.count({ where: { orderId: winner.id } }),
    1,
  );
});

test('first creation recomputes cart/address/prices/shipping after an earlier quote', async (t) => {
  const f = await setup(t);
  const quoted = await request(f.app)
    .post('/api/v1/checkout/quote')
    .set('Authorization', `Bearer ${f.tokens[0]}`)
    .send({ addressId: f.intent.addressId })
    .expect(200);
  assert.equal(quoted.body.data.total, '529999');
  const [{ now }] = await f.prisma.$queryRaw`SELECT CURRENT_TIMESTAMP AS now`;
  await f.prisma.$transaction(async (tx) => {
    await tx.productPriceHistory.updateMany({
      where: { productId: f.product.id },
      data: { endsAt: now },
    });
    await tx.productPriceHistory.create({
      data: { productId: f.product.id, price: 250000n, startsAt: now },
    });
  });
  await f.prisma.cartItem.update({
    where: { id: f.carts[0].items[0].id },
    data: { quantity: 2 },
  });
  await f.prisma.address.update({
    where: { id: f.addresses[0].id },
    data: { line1: 'Latest validated address' },
  });
  const data = (await f.send(randomUUID()).expect(201)).body.data;
  assert.equal(data.items[0].quantity, 2);
  assert.equal(data.items[0].unitPrice, '250000');
  assert.equal(data.items[0].lineTotal, '500000');
  assert.equal(data.subtotal, '500000');
  assert.equal(data.shippingFee, '0');
  assert.equal(data.total, '500000');
  assert.equal(data.address.line1, 'Latest validated address');
});
