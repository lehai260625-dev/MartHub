import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import test from 'node:test';
import request from 'supertest';
import { reorderResponseSchema } from '@marthub/contracts';
import { createApp } from '../../src/app.js';
import { readAuthConfig } from '../../src/config/auth.js';
import { validateDatabaseUrl } from '../../src/config/env.js';
import { createDatabase } from '../../src/db/client.js';
import { createSessionService } from '../../src/modules/auth/sessions.js';
const config = readAuthConfig({
  AUTH_JWT_SECRET: randomBytes(32).toString('hex'),
  WEB_ORIGIN: 'https://shop.example.test',
  NODE_ENV: 'production',
});
const price = 9007199254740993n;
async function fixture(t) {
  const database = createDatabase(
    validateDatabaseUrl(process.env.DATABASE_URL),
  );
  t.after(() => database.close());
  const { prisma } = database;
  const users = [];
  for (const role of ['CUSTOMER', 'CUSTOMER', 'ADMIN'])
    users.push(
      await prisma.user.create({
        data: {
          email: `reorder-${randomUUID()}@example.test`,
          passwordHash: 'unused',
          firstName: 'Reorder',
          lastName: 'Test',
          role,
        },
      }),
    );
  const category = await prisma.category.create({
    data: { name: 'Reorder', slug: `reorder-${randomUUID()}` },
  });
  const product = async (options = {}) => {
    const suffix = randomUUID();
    return prisma.product.create({
      data: {
        categoryId: category.id,
        sku: `REORDER-${suffix}`,
        slug: `reorder-${suffix}`,
        name: 'Current product',
        sellingUnit: 'each',
        status: 'ACTIVE',
        prices: { create: { price, startsAt: new Date('2020-01-01') } },
        inventory: { create: { quantityOnHand: 1 } },
        ...options,
      },
    });
  };
  const order = async (items, index = 0) =>
    prisma.order.create({
      data: {
        orderNumber: `MH-${randomUUID()}`,
        userId: users[index].id,
        status: 'DELIVERED',
        idempotencyKey: randomUUID(),
        requestFingerprint: 'private',
        subtotal: 1n,
        total: 1n,
        shippingFee: 0n,
        discountTotal: 0n,
        recipientName: 'Private',
        recipientPhone: '0901234567',
        addressLine1: 'Private address',
        ward: 'Ward',
        district: 'District',
        province: 'Province',
        items: {
          create: items.map((item) => ({
            productId: item.product.id,
            quantity: item.quantity,
            sku: 'OLD',
            productName: 'Old product',
            sellingUnit: 'box',
            unitPrice: 1n,
            lineTotal: BigInt(item.quantity),
            createdAt: new Date('2020-01-01'),
          })),
        },
        statusHistory: {
          create: {
            fromStatus: 'SHIPPING',
            toStatus: 'DELIVERED',
            actorUserId: users[2].id,
          },
        },
      },
      include: {
        items: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
        statusHistory: true,
      },
    });
  const sessions = createSessionService({ prisma, config });
  const tokens = [];
  for (const user of users)
    tokens.push((await sessions.issue(user.id)).data.accessToken);
  const makeApp = (db = prisma) =>
    createApp({
      prisma: db,
      authConfig: config,
      origin: config.origin,
      logger: () => {},
    });
  const app = makeApp();
  const send = (id, input = {}, index = 0, target = app) =>
    request(target)
      .post(`/api/v1/orders/${id}/reorder`)
      .set('Authorization', `Bearer ${tokens[index]}`)
      .send(input);
  const carts = () =>
    prisma.cart.findMany({
      where: { userId: users[0].id },
      include: { items: { orderBy: { productId: 'asc' } } },
      orderBy: { id: 'asc' },
    });
  return {
    prisma,
    users,
    category,
    product,
    order,
    tokens,
    app,
    makeApp,
    send,
    carts,
  };
}
function wrap(prisma, hook) {
  return new Proxy(prisma, {
    get(target, field) {
      if (field !== '$transaction') return target[field];
      return (callback, options) =>
        prisma.$transaction((tx) => callback(hook(tx)), options);
    },
  });
}
test('reorder is Customer-only, concealed owner-scoped and rejects all writable inputs without mutation', async (t) => {
  const f = await fixture(t),
    p = await f.product();
  const o = await f.order([{ product: p, quantity: 2 }]);
  assert.match(
    (await request(f.app).post(`/api/v1/orders/${o.id}/reorder`).expect(401))
      .headers['cache-control'],
    /no-store/,
  );
  await f.send(o.id, {}, 2).expect(403);
  for (const id of [o.id, randomUUID(), 'malformed'])
    assert.equal(
      (await f.send(id, {}, 1).expect(404)).body.error.code,
      'NOT_FOUND',
    );
  for (const input of [
    { quantity: 1 },
    { userId: f.users[1].id },
    { price: '1' },
    { items: [] },
    [],
  ])
    await f.send(o.id, input).expect(422);
  await f.send(o.id).query({ quantity: '1' }).expect(422);
  assert.deepEqual(await f.carts(), []);
  await f.prisma.user.update({
    where: { id: f.users[0].id },
    data: { role: 'ADMIN' },
  });
  await f.send(o.id).expect(403);
});
test('partial reorder reports every line, preserves full quantity and current exact price, and merges without reserving stock', async (t) => {
  const f = await fixture(t);
  const active = await f.product(),
    cap = await f.product();
  const archived = await f.product({
      status: 'ARCHIVED',
      archivedAt: new Date(),
    }),
    draft = await f.product({ status: 'DRAFT' });
  const zero = await f.product({
    inventory: { create: { quantityOnHand: 0 } },
  });
  const unpriced = await f.product({
    prices: { create: { price, startsAt: new Date('2099-01-01') } },
  });
  const hiddenCategory = await f.prisma.category.create({
    data: {
      name: 'Hidden',
      slug: `hidden-${randomUUID()}`,
      status: 'ARCHIVED',
      archivedAt: new Date(),
    },
  });
  const hidden = await f.product({ categoryId: hiddenCategory.id });
  const o = await f.order([
    { product: active, quantity: 5 },
    { product: cap, quantity: 2 },
    ...[archived, draft, zero, unpriced, hidden].map((product) => ({
      product,
      quantity: 3,
    })),
  ]);
  const cart = await f.prisma.cart.create({
    data: {
      userId: f.users[0].id,
      items: {
        create: [
          { productId: active.id, quantity: 4 },
          { productId: cap.id, quantity: 98 },
        ],
      },
    },
  });
  const result = await f.send(o.id).expect(200);
  assert.match(result.headers['cache-control'], /no-store/);
  reorderResponseSchema.parse(result.body);
  assert.deepEqual(result.body.data.added, [
    { productId: active.id, quantity: 5, currentUnitPrice: price.toString() },
  ]);
  const reasons = new Map([
    [cap.id, 'QUANTITY_LIMITED'],
    [archived.id, 'UNAVAILABLE'],
    [draft.id, 'UNAVAILABLE'],
    [zero.id, 'OUT_OF_STOCK'],
    [unpriced.id, 'UNAVAILABLE'],
    [hidden.id, 'UNAVAILABLE'],
  ]);
  assert.deepEqual(
    result.body.data.skipped,
    o.items
      .filter((item) => item.productId !== active.id)
      .map((item) => ({
        productId: item.productId,
        reason: reasons.get(item.productId),
      })),
  );
  assert.equal(result.body.data.cartId, cart.id);
  const items = (await f.carts())[0].items;
  assert.equal(items.find((item) => item.productId === active.id).quantity, 9);
  assert.equal(items.find((item) => item.productId === cap.id).quantity, 98);
  assert.equal(
    (await f.prisma.inventory.findUnique({ where: { productId: active.id } }))
      .quantityOnHand,
    1,
  );
  assert.equal(
    await f.prisma.inventoryMovement.count({ where: { productId: active.id } }),
    0,
  );
  assert.deepEqual(
    await f.prisma.order.findUnique({
      where: { id: o.id },
      include: {
        items: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
        statusHistory: true,
      },
    }),
    o,
  );
  const cartRead = await request(f.app)
    .get('/api/v1/cart')
    .set('Authorization', `Bearer ${f.tokens[0]}`)
    .expect(200);
  assert.equal(
    cartRead.body.data.items.find((item) => item.productId === active.id)
      .product.price,
    price.toString(),
  );
});
test('all-skipped preserves absent/existing carts, historical over-cap quantities are not clamped', async (t) => {
  const f = await fixture(t);
  const p = await f.product({ status: 'DRAFT' }),
    over = await f.product();
  const o = await f.order([
    { product: p, quantity: 4 },
    { product: over, quantity: 100 },
  ]);
  assert.equal((await f.send(o.id).expect(200)).body.data.cartId, null);
  assert.deepEqual(await f.carts(), []);
  const cart = await f.prisma.cart.create({
    data: {
      userId: f.users[0].id,
      items: { create: { productId: p.id, quantity: 10 } },
    },
  });
  const before = await f.carts();
  const result = await f.send(o.id).expect(200);
  assert.equal(result.body.data.cartId, cart.id);
  assert.equal(
    result.body.data.skipped.find((line) => line.productId === over.id).reason,
    'QUANTITY_LIMITED',
  );
  assert.deepEqual(await f.carts(), before);
});
test('repeated reorder increments existing product to 99, then skips without clamping or creating duplicate rows', async (t) => {
  const f = await fixture(t),
    p = await f.product();
  const o = await f.order([{ product: p, quantity: 33 }]);
  for (let i = 0; i < 3; i++)
    assert.equal(
      (await f.send(o.id).expect(200)).body.data.added[0].quantity,
      33,
    );
  const before = await f.carts();
  assert.equal(before[0].items[0].quantity, 99);
  assert.deepEqual((await f.send(o.id).expect(200)).body.data, {
    cartId: before[0].id,
    added: [],
    skipped: [{ productId: p.id, reason: 'QUANTITY_LIMITED' }],
  });
  assert.deepEqual(await f.carts(), before);
});
test('reorder creates a new active cart without touching checked-out or archived carts', async (t) => {
  const f = await fixture(t),
    p = await f.product();
  for (const field of ['checkedOutAt', 'archivedAt'])
    await f.prisma.cart.create({
      data: {
        userId: f.users[0].id,
        [field]: new Date(),
        items: { create: { productId: p.id, quantity: 8 } },
      },
    });
  const before = await f.carts();
  const o = await f.order([{ product: p, quantity: 2 }]);
  const response = await f.send(o.id).expect(200);
  const after = await f.carts();
  for (const old of before)
    assert.deepEqual(
      after.find((cart) => cart.id === old.id),
      old,
    );
  assert.equal(
    after.find((cart) => cart.id === response.body.data.cartId).items[0]
      .quantity,
    2,
  );
});
test('concurrent reorders and cart add serialize safely at the per-product cap', async (t) => {
  for (const other of ['REORDER', 'ADD']) {
    const f = await fixture(t),
      p = await f.product();
    const o = await f.order([{ product: p, quantity: 60 }]);
    let arrivals = 0,
      release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const db = wrap(
      f.prisma,
      (tx) =>
        new Proxy(tx, {
          get(target, field) {
            if (field !== '$queryRaw') return target[field];
            return async (...args) => {
              if (
                (args[0].strings ?? args[0])
                  .join('')
                  .includes('FROM "users"') &&
                arrivals < 2
              ) {
                if (++arrivals === 2) release();
                await gate;
              }
              return tx.$queryRaw(...args);
            };
          },
        }),
    );
    const app = f.makeApp(db);
    const results = await Promise.all([
      f.send(o.id, {}, 0, app),
      other === 'REORDER'
        ? f.send(o.id, {}, 0, app)
        : request(app)
            .post('/api/v1/cart/items')
            .set('Authorization', `Bearer ${f.tokens[0]}`)
            .send({ productId: p.id, quantity: 60 }),
    ]);
    if (other === 'REORDER') {
      assert.deepEqual(
        results.map((res) => res.status),
        [200, 200],
      );
      assert.equal(
        results.filter((res) => res.body.data.added.length === 1).length,
        1,
      );
    } else
      assert.ok(
        (results[0].body.data.added.length === 1 &&
          results[1].status === 422) ||
          (results[0].body.data.skipped[0].reason === 'QUANTITY_LIMITED' &&
            results[1].status === 200),
      );
    const carts = await f.carts();
    assert.equal(carts.length, 1);
    assert.equal(carts[0].items.length, 1);
    assert.equal(carts[0].items[0].quantity, 60);
  }
});
test('unexpected item persistence failure rolls back earlier lines and newly created cart, then retry succeeds', async (t) => {
  const f = await fixture(t),
    a = await f.product(),
    b = await f.product();
  const o = await f.order([
    { product: a, quantity: 2 },
    { product: b, quantity: 3 },
  ]);
  let writes = 0;
  const db = wrap(
    f.prisma,
    (tx) =>
      new Proxy(tx, {
        get(target, field) {
          if (field !== 'cartItem') return target[field];
          return new Proxy(tx.cartItem, {
            get(model, operation) {
              if (operation !== 'create') return model[operation];
              return async (args) => {
                const result = await model.create(args);
                if (++writes === 2)
                  throw new Error('Injected persistence failure');
                return result;
              };
            },
          });
        },
      }),
  );
  await f.send(o.id, {}, 0, f.makeApp(db)).expect(500);
  assert.deepEqual(await f.carts(), []);
  assert.equal((await f.send(o.id).expect(200)).body.data.added.length, 2);
});
