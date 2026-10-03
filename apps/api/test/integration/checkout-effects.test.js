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

function competingInventoryLocks(prisma) {
  let arrivals = 0;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  return new Proxy(prisma, {
    get(target, key) {
      if (key !== '$transaction') return target[key];
      return (callback, options) =>
        prisma.$transaction(
          (tx) =>
            callback(
              new Proxy(tx, {
                get(transaction, field) {
                  if (field !== '$queryRaw') return transaction[field];
                  return async (...args) => {
                    const query = args[0];
                    const text = Array.isArray(query)
                      ? query.join('')
                      : (query.strings?.join('') ?? '');
                    if (text.includes('FOR UPDATE OF i') && arrivals < 2) {
                      if (++arrivals === 2) release();
                      await gate;
                    }
                    return tx.$queryRaw(...args);
                  };
                },
              }),
            ),
          options,
        );
    },
  });
}

test('concurrent last-item checkouts cannot oversell and the loser retains its cart with authoritative shortage', async (t) => {
  const f = await setup(t);
  await f.prisma.inventory.update({
    where: { productId: f.product.id },
    data: { quantityOnHand: 1 },
  });
  const app = f.makeApp(competingInventoryLocks(f.prisma));
  const results = await Promise.all(
    [0, 1].map((i) =>
      f.send(
        randomUUID(),
        { cartId: f.carts[i].id, addressId: f.addresses[i].id },
        f.tokens[i],
        app,
      ),
    ),
  );
  assert.deepEqual(results.map((res) => res.status).sort(), [201, 409]);
  const winner = results.findIndex((res) => res.status === 201);
  assert.equal(
    checkoutOrderResponseSchema.safeParse(results[winner].body).success,
    true,
  );
  const loser = 1 - winner;
  assert.equal(results[loser].body.error.code, 'INSUFFICIENT_STOCK');
  assert.deepEqual(results[loser].body.error.details, [
    { field: 'quantity', productId: f.product.id, requested: 1, available: 0 },
  ]);
  assert.equal(
    (
      await f.prisma.inventory.findUnique({
        where: { productId: f.product.id },
      })
    ).quantityOnHand,
    0,
  );
  const movement = await f.prisma.inventoryMovement.findMany({
    where: { productId: f.product.id },
  });
  assert.equal(movement.length, 1);
  assert.equal(movement[0].quantityDelta, -1);
  assert.equal(movement[0].quantityAfter, 0);
  assert.equal(movement[0].orderId, results[winner].body.data.id);
  assert.equal(movement[0].actorUserId, f.users[winner].id);
  assert.equal(
    await f.prisma.order.count({ where: { userId: f.users[loser].id } }),
    0,
  );
  assert.equal(
    await f.prisma.cartItem.count({ where: { cartId: f.carts[loser].id } }),
    1,
  );
  assert.equal(
    (await f.prisma.cart.findUnique({ where: { id: f.carts[loser].id } }))
      .checkedOutAt,
    null,
  );
  await f.prisma.inventory.update({
    where: { productId: f.product.id },
    data: { quantityOnHand: 1 },
  });
  const key = randomUUID();
  await f
    .send(
      key,
      { cartId: f.carts[loser].id, addressId: f.addresses[loser].id },
      f.tokens[loser],
    )
    .expect(201);
});

test('reverse multi-product carts lock in stable order and commit all or none', async (t) => {
  const f = await setup(t);
  const second = await f.prisma.product.create({
    data: {
      categoryId: f.category.id,
      name: 'Second',
      sku: `SECOND-${randomUUID()}`,
      slug: `second-${randomUUID()}`,
      status: 'ACTIVE',
      sellingUnit: 'each',
    },
  });
  await f.prisma.productPriceHistory.create({
    data: {
      productId: second.id,
      price: 100n,
      startsAt: new Date('2020-01-01'),
    },
  });
  await f.prisma.inventory.create({
    data: { productId: second.id, quantityOnHand: 1 },
  });
  await f.prisma.inventory.update({
    where: { productId: f.product.id },
    data: { quantityOnHand: 1 },
  });
  await f.prisma.cartItem.create({
    data: { cartId: f.carts[0].id, productId: second.id, quantity: 1 },
  });
  await f.prisma.cartItem.deleteMany({ where: { cartId: f.carts[1].id } });
  await f.prisma.cartItem.create({
    data: { cartId: f.carts[1].id, productId: second.id, quantity: 1 },
  });
  await f.prisma.cartItem.create({
    data: { cartId: f.carts[1].id, productId: f.product.id, quantity: 1 },
  });
  const target = f.makeApp(competingInventoryLocks(f.prisma));
  const results = await Promise.all(
    [0, 1].map((i) =>
      f.send(
        randomUUID(),
        { cartId: f.carts[i].id, addressId: f.addresses[i].id },
        f.tokens[i],
        target,
      ),
    ),
  );
  assert.deepEqual(results.map((res) => res.status).sort(), [201, 409]);
  const winner = results.find((res) => res.status === 201).body.data;
  assert.equal(winner.subtotal, '500099');
  assert.equal(winner.shippingFee, '0');
  assert.equal(winner.items.length, 2);
  const stocks = await f.prisma.inventory.findMany({
    where: { productId: { in: [f.product.id, second.id] } },
  });
  assert.ok(stocks.every((stock) => stock.quantityOnHand === 0));
  const movements = await f.prisma.inventoryMovement.findMany({
    where: { productId: { in: [f.product.id, second.id] } },
  });
  assert.equal(movements.length, 2);
  assert.ok(
    movements.every(
      (movement) =>
        movement.orderId === winner.id && movement.quantityAfter === 0,
    ),
  );
  const loser = results.findIndex((res) => res.status === 409);
  assert.equal(
    await f.prisma.cartItem.count({ where: { cartId: f.carts[loser].id } }),
    2,
  );
});

test('every stock/movement/cart failure rolls back order, history, stock and cart; same-key retry succeeds once', async (t) => {
  const f = await setup(t);
  const key = randomUUID();
  const beforeStock = await f.prisma.inventory.findUnique({
    where: { productId: f.product.id },
  });
  const beforeCart = await f.prisma.cart.findUnique({
    where: { id: f.carts[0].id },
    include: { items: true },
  });
  for (const [model, method, constraintFailure] of [
    ['inventory', 'update', false],
    ['inventoryMovement', 'create', true],
    ['inventoryMovement', 'create', false],
    ['cartItem', 'deleteMany', false],
    ['cart', 'update', false],
  ]) {
    const faultDb = new Proxy(f.prisma, {
      get(target, field) {
        if (field !== '$transaction') return target[field];
        return (callback, options) =>
          f.prisma.$transaction(
            (tx) =>
              callback(
                new Proxy(tx, {
                  get(transaction, prop) {
                    if (prop !== model) return transaction[prop];
                    return {
                      ...tx[model],
                      [method]: async (args) => {
                        if (constraintFailure) args.data.quantityAfter = -1;
                        await tx[model][method](args);
                        throw new Error(
                          'Forced transaction failure after real database effect',
                        );
                      },
                    };
                  },
                }),
              ),
            options,
          );
      },
    });
    const failed = await f
      .send(key, f.intent, f.tokens[0], f.makeApp(faultDb))
      .expect(500);
    assert.equal(failed.body.error.code, 'INTERNAL_ERROR');
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
      await f.prisma.inventoryMovement.count({
        where: { productId: f.product.id },
      }),
      0,
    );
    assert.deepEqual(
      await f.prisma.inventory.findUnique({
        where: { productId: f.product.id },
      }),
      beforeStock,
    );
    assert.deepEqual(
      await f.prisma.cart.findUnique({
        where: { id: beforeCart.id },
        include: { items: true },
      }),
      beforeCart,
    );
  }
  const created = await f.send(key).expect(201);
  await f.send(key).expect(200);
  const movement = await f.prisma.inventoryMovement.findFirst({
    where: { orderId: created.body.data.id },
  });
  assert.equal(movement.idempotencyKey, key);
  assert.equal(movement.quantityAfter - movement.quantityDelta, 10);
  await assert.rejects(
    f.prisma.inventoryMovement.create({
      data: {
        productId: movement.productId,
        orderId: movement.orderId,
        type: 'ORDER_DEBIT',
        quantityDelta: -1,
        quantityAfter: 8,
      },
    }),
    { code: 'P2002' },
  );
});

test('replay never decrements again or clears a newly active cart; key conflict has no effects', async (t) => {
  const f = await setup(t);
  const key = randomUUID();
  const first = await f.send(key).expect(201);
  const added = await request(f.app)
    .post('/api/v1/cart/items')
    .set('Authorization', `Bearer ${f.tokens[0]}`)
    .send({ productId: f.product.id, quantity: 3 })
    .expect(200);
  assert.notEqual(added.body.data.id, f.intent.cartId);
  const newCart = await f.prisma.cart.findUnique({
    where: { id: added.body.data.id },
    include: { items: true },
  });
  const stock = await f.prisma.inventory.findUnique({
    where: { productId: f.product.id },
  });
  for (let i = 0; i < 3; i++)
    assert.deepEqual((await f.send(key).expect(200)).body, first.body);
  await f.send(key, { ...f.intent, customerNote: 'changed' }).expect(400);
  assert.deepEqual(
    await f.prisma.inventory.findUnique({ where: { productId: f.product.id } }),
    stock,
  );
  assert.deepEqual(
    await f.prisma.cart.findUnique({
      where: { id: newCart.id },
      include: { items: true },
    }),
    newCart,
  );
  assert.equal(
    await f.prisma.inventoryMovement.count({
      where: { orderId: first.body.data.id },
    }),
    1,
  );
});

test('same Customer cannot check out the same cart twice using distinct keys', async (t) => {
  const f = await setup(t);
  const results = await Promise.all([
    f.send(randomUUID()),
    f.send(randomUUID()),
  ]);
  assert.deepEqual(results.map((res) => res.status).sort(), [201, 404]);
  assert.equal(
    await f.prisma.order.count({ where: { userId: f.users[0].id } }),
    1,
  );
  assert.equal(
    await f.prisma.inventoryMovement.count({
      where: { productId: f.product.id },
    }),
    1,
  );
  assert.equal(
    (
      await f.prisma.inventory.findUnique({
        where: { productId: f.product.id },
      })
    ).quantityOnHand,
    9,
  );
});

test('cart add waiting behind checkout creates a fresh cart and its new items are not cleared', async (t) => {
  const f = await setup(t);
  let movementReady, addAttempted, finishCheckout;
  const ready = new Promise((resolve) => {
    movementReady = resolve;
  });
  const attempted = new Promise((resolve) => {
    addAttempted = resolve;
  });
  const finish = new Promise((resolve) => {
    finishCheckout = resolve;
  });
  let checkoutPaused = false;
  const db = new Proxy(f.prisma, {
    get(target, prop) {
      if (prop !== '$transaction') return target[prop];
      return (callback, options) =>
        f.prisma.$transaction(
          (tx) =>
            callback(
              new Proxy(tx, {
                get(transaction, field) {
                  if (field === 'inventoryMovement')
                    return {
                      ...tx.inventoryMovement,
                      create: async (args) => {
                        const result = await tx.inventoryMovement.create(args);
                        checkoutPaused = true;
                        movementReady();
                        await finish;
                        return result;
                      },
                    };
                  if (field === '$queryRaw')
                    return async (...args) => {
                      if (
                        checkoutPaused &&
                        Array.isArray(args[0]) &&
                        args[0].join('').includes('FROM "users"')
                      )
                        addAttempted();
                      return tx.$queryRaw(...args);
                    };
                  return transaction[field];
                },
              }),
            ),
          options,
        );
    },
  });
  const app = f.makeApp(db);
  const checkout = f
    .send(randomUUID(), f.intent, f.tokens[0], app)
    .then((res) => res);
  await ready;
  const add = request(app)
    .post('/api/v1/cart/items')
    .set('Authorization', `Bearer ${f.tokens[0]}`)
    .send({ productId: f.product.id, quantity: 2 })
    .then((res) => res);
  await attempted;
  finishCheckout();
  const [created, added] = await Promise.all([checkout, add]);
  assert.equal(created.status, 201);
  assert.equal(added.status, 200);
  assert.notEqual(added.body.data.id, f.intent.cartId);
  assert.equal(added.body.data.items[0].quantity, 2);
  assert.equal(
    await f.prisma.cartItem.count({ where: { cartId: f.intent.cartId } }),
    0,
  );
  assert.equal(
    (await f.prisma.cart.findUnique({ where: { id: added.body.data.id } }))
      .checkedOutAt,
    null,
  );
});

test('checkout and Admin inventory adjustment share PostgreSQL stock serialization', async (t) => {
  const f = await setup(t);
  await f.prisma.inventory.update({
    where: { productId: f.product.id },
    data: { quantityOnHand: 1 },
  });
  const target = f.makeApp(competingInventoryLocks(f.prisma));
  const results = await Promise.all([
    f.send(randomUUID(), f.intent, f.tokens[0], target),
    request(target)
      .post(`/api/v1/admin/inventory/${f.product.id}/adjustments`)
      .set('Authorization', `Bearer ${f.tokens[2]}`)
      .send({ adjustment: -1, reason: 'Damaged stock removal' }),
  ]);
  assert.ok(
    (results[0].status === 201 && results[1].status === 409) ||
      (results[0].status === 409 && results[1].status === 200),
  );
  const conflict = results.find((res) => res.status === 409);
  assert.equal(conflict.body.error.code, 'INSUFFICIENT_STOCK');
  assert.equal(
    (
      await f.prisma.inventory.findUnique({
        where: { productId: f.product.id },
      })
    ).quantityOnHand,
    0,
  );
  const movements = await f.prisma.inventoryMovement.findMany({
    where: { productId: f.product.id },
  });
  assert.equal(movements.length, 1);
  assert.equal(movements[0].quantityDelta, -1);
  assert.equal(movements[0].quantityAfter, 0);
});

test('positive but insufficient stock and a later multi-product movement failure preserve all earlier effects', async (t) => {
  const f = await setup(t);
  const second = await f.prisma.product.create({
    data: {
      categoryId: f.category.id,
      name: 'Second rollback product',
      sku: `SECOND-${randomUUID()}`,
      slug: `second-${randomUUID()}`,
      status: 'ACTIVE',
      sellingUnit: 'each',
    },
  });
  await f.prisma.productPriceHistory.create({
    data: {
      productId: second.id,
      price: 100n,
      startsAt: new Date('2020-01-01'),
    },
  });
  await f.prisma.inventory.create({
    data: { productId: second.id, quantityOnHand: 1 },
  });
  await f.prisma.cartItem.create({
    data: { cartId: f.intent.cartId, productId: second.id, quantity: 2 },
  });
  const key = randomUUID();
  const shortage = await f.send(key).expect(409);
  assert.equal(shortage.body.error.code, 'INSUFFICIENT_STOCK');
  assert.deepEqual(shortage.body.error.details, [
    { field: 'quantity', productId: second.id, requested: 2, available: 1 },
  ]);
  assert.equal(
    await f.prisma.order.count({ where: { userId: f.users[0].id } }),
    0,
  );
  assert.equal(
    await f.prisma.inventoryMovement.count({
      where: { productId: { in: [f.product.id, second.id] } },
    }),
    0,
  );
  await f.prisma.inventory.update({
    where: { productId: second.id },
    data: { quantityOnHand: 2 },
  });
  let successfulMovements = 0;
  const fault = new Proxy(f.prisma, {
    get(target, key) {
      if (key !== '$transaction') return target[key];
      return (callback, options) =>
        f.prisma.$transaction(
          (tx) =>
            callback(
              new Proxy(tx, {
                get(transaction, field) {
                  if (field !== 'inventoryMovement') return transaction[field];
                  return {
                    ...tx.inventoryMovement,
                    create: async (args) => {
                      if (successfulMovements === 1)
                        args.data.quantityAfter = -1;
                      const movement = await tx.inventoryMovement.create(args);
                      successfulMovements++;
                      return movement;
                    },
                  };
                },
              }),
            ),
          options,
        );
    },
  });
  await f.send(key, f.intent, f.tokens[0], f.makeApp(fault)).expect(500);
  assert.equal(successfulMovements, 1);
  const stocks = await f.prisma.inventory.findMany({
    where: { productId: { in: [f.product.id, second.id] } },
  });
  assert.equal(
    stocks.find((stock) => stock.productId === f.product.id).quantityOnHand,
    10,
  );
  assert.equal(
    stocks.find((stock) => stock.productId === second.id).quantityOnHand,
    2,
  );
  assert.equal(
    await f.prisma.order.count({ where: { userId: f.users[0].id } }),
    0,
  );
  assert.equal(
    await f.prisma.inventoryMovement.count({
      where: { productId: { in: [f.product.id, second.id] } },
    }),
    0,
  );
  assert.equal(
    await f.prisma.cartItem.count({ where: { cartId: f.intent.cartId } }),
    2,
  );
  assert.equal(
    (await f.prisma.cart.findUnique({ where: { id: f.intent.cartId } }))
      .checkedOutAt,
    null,
  );
  const created = await f.send(key).expect(201);
  const movements = await f.prisma.inventoryMovement.findMany({
    where: { orderId: created.body.data.id },
  });
  assert.equal(movements.length, 2);
  const two = movements.find((movement) => movement.productId === second.id);
  assert.equal(two.quantityDelta, -2);
  assert.equal(two.quantityAfter, 0);
  assert.equal(two.quantityAfter - two.quantityDelta, 2);
});
