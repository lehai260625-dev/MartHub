import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import test from 'node:test';
import request from 'supertest';
import { customerOrderDetailResponseSchema } from '@marthub/contracts';
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
async function fixture(t) {
  const database = createDatabase(
    validateDatabaseUrl(process.env.DATABASE_URL),
  );
  t.after(() => database.close());
  const { prisma } = database;
  const suffix = randomUUID();
  const users = [];
  for (const role of ['CUSTOMER', 'CUSTOMER', 'ADMIN'])
    users.push(
      await prisma.user.create({
        data: {
          email: `cancel-${suffix}-${users.length}@example.test`,
          passwordHash: 'unused',
          firstName: 'Cancel',
          lastName: 'Test',
          role,
        },
      }),
    );
  const category = await prisma.category.create({
    data: { name: 'Cancellation', slug: `cancel-${suffix}` },
  });
  const products = [];
  for (let i = 0; i < 2; i++)
    products.push(
      await prisma.product.create({
        data: {
          categoryId: category.id,
          sku: `CANCEL-${suffix}-${i}`,
          slug: `cancel-${suffix}-${i}`,
          name: `Snapshot ${i}`,
          sellingUnit: 'each',
          status: 'ACTIVE',
          inventory: { create: { quantityOnHand: 10 } },
          prices: {
            create: {
              price: 9007199254740993n,
              startsAt: new Date('2020-01-01'),
            },
          },
        },
      }),
    );
  const tokens = [];
  const sessions = createSessionService({ prisma, config });
  for (const user of users)
    tokens.push((await sessions.issue(user.id)).data.accessToken);
  const makeApp = (db = prisma) =>
    createApp({
      prisma: db,
      authConfig: config,
      shippingPolicy: readShippingConfig({}),
      origin: config.origin,
      logger: () => {},
    });
  const app = makeApp();
  const checkout = async (index = 0) => {
    const address = await prisma.address.create({
      data: {
        userId: users[index].id,
        label: 'Home',
        recipientName: 'Snapshot recipient',
        phone: '0901234567',
        line1: 'Original address',
        ward: 'Ward',
        district: 'District',
        province: 'Province',
      },
    });
    const cart = await prisma.cart.create({
      data: {
        userId: users[index].id,
        items: {
          create: products.map((product, i) => ({
            productId: product.id,
            quantity: i + 2,
          })),
        },
      },
    });
    const intent = { cartId: cart.id, addressId: address.id };
    const key = randomUUID();
    const response = await request(app)
      .post('/api/v1/checkout/orders')
      .set('Authorization', `Bearer ${tokens[index]}`)
      .set('Idempotency-Key', key)
      .send(intent)
      .expect(201);
    return { order: response.body.data, key, intent, cart };
  };
  const cancel = (id, body = {}, index = 0, target = app) =>
    request(target)
      .post(`/api/v1/orders/${id}/cancel`)
      .set('Authorization', `Bearer ${tokens[index]}`)
      .send(body);
  const state = async (id) => ({
    order: await prisma.order.findUnique({
      where: { id },
      include: { items: true, statusHistory: { orderBy: { id: 'asc' } } },
    }),
    stock: await prisma.inventory.findMany({
      where: { productId: { in: products.map((p) => p.id) } },
      orderBy: { productId: 'asc' },
    }),
    movements: await prisma.inventoryMovement.findMany({
      where: { productId: { in: products.map((p) => p.id) } },
      orderBy: { id: 'asc' },
    }),
  });
  return {
    prisma,
    users,
    products,
    tokens,
    app,
    makeApp,
    checkout,
    cancel,
    state,
  };
}

function wrapTransactions(prisma, wrap) {
  return new Proxy(prisma, {
    get(target, key) {
      if (key !== '$transaction') return target[key];
      return (callback, options) =>
        prisma.$transaction((tx) => callback(wrap(tx)), options);
    },
  });
}

// Wait for both commands to reach the actual lock query, without sleeps.
function competingLocks(prisma, marker) {
  let arrivals = 0,
    release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  return wrapTransactions(
    prisma,
    (tx) =>
      new Proxy(tx, {
        get(target, field) {
          if (field !== '$queryRaw') return target[field];
          return async (...args) => {
            const text = (args[0].strings ?? args[0]).join('');
            if (text.includes(marker) && arrivals < 2) {
              if (++arrivals === 2) release();
              await gate;
            }
            return tx.$queryRaw(...args);
          };
        },
      }),
  );
}

test('cancellation enforces Customer role, no-store and concealed ownership with no effects', async (t) => {
  const f = await fixture(t);
  const { order } = await f.checkout();
  const before = await f.state(order.id);
  const guest = await request(f.app)
    .post(`/api/v1/orders/${order.id}/cancel`)
    .send({})
    .expect(401);
  assert.match(guest.headers['cache-control'], /no-store/);
  await f.cancel(order.id, {}, 2).expect(403);
  const errors = [];
  for (const id of [order.id, randomUUID(), 'malformed'])
    errors.push((await f.cancel(id, {}, 1).expect(404)).body.error);
  assert.deepEqual(
    errors.map(({ code, message }) => ({ code, message })),
    Array(3).fill({ code: 'NOT_FOUND', message: 'Resource not found.' }),
  );
  await f.prisma.user.update({
    where: { id: f.users[0].id },
    data: { role: 'ADMIN' },
  });
  await f.cancel(order.id).expect(403);
  assert.deepEqual(await f.state(order.id), before);
});

test('PENDING and CONFIRMED cancel with immutable snapshots, correct actor and exactly-once history/restoration', async (t) => {
  for (const status of ['PENDING', 'CONFIRMED']) {
    const f = await fixture(t);
    const { order, key, intent, cart } = await f.checkout();
    if (status === 'CONFIRMED')
      await f.prisma.order.update({
        where: { id: order.id },
        data: {
          status,
          statusHistory: {
            create: {
              fromStatus: 'PENDING',
              toStatus: status,
              actorUserId: f.users[2].id,
            },
          },
        },
      });
    const before = await f.state(order.id);
    await f.prisma.product.update({
      where: { id: f.products[0].id },
      data: {
        name: 'Changed catalog',
        status: 'ARCHIVED',
        archivedAt: new Date(),
      },
    });
    const result = await f
      .cancel(order.id, { reason: '  Plans changed  ' })
      .expect(200);
    assert.match(result.headers['cache-control'], /no-store/);
    customerOrderDetailResponseSchema.parse(result.body);
    assert.equal(result.body.data.status, 'CANCELLED');
    for (const field of ['items', 'address', 'subtotal', 'total', 'placedAt'])
      assert.deepEqual(result.body.data[field], order[field]);
    const after = await f.state(order.id);
    assert.equal(after.order.cancellationReason, 'Plans changed');
    assert.ok(after.order.cancelledAt);
    const history = after.order.statusHistory.filter(
      (h) => h.toStatus === 'CANCELLED',
    );
    assert.equal(history.length, 1);
    assert.equal(history[0].fromStatus, status);
    assert.equal(history[0].actorUserId, f.users[0].id);
    assert.equal(history[0].reason, 'Plans changed');
    assert.deepEqual(history[0].createdAt, after.order.cancelledAt);
    assert.equal(
      after.order.statusHistory.length,
      before.order.statusHistory.length + 1,
    );
    for (let i = 0; i < 2; i++) {
      const movement = after.movements.find(
        (m) =>
          m.productId === f.products[i].id && m.type === 'ORDER_CANCEL_RESTORE',
      );
      assert.equal(movement.quantityDelta, i + 2);
      assert.equal(movement.quantityAfter, 10);
      assert.equal(movement.orderId, order.id);
      assert.equal(movement.actorUserId, f.users[0].id);
      assert.equal(movement.reason, 'Plans changed');
    }
    assert.equal(after.movements.length, 4);
    assert.ok(after.stock.every((s) => s.quantityOnHand === 10));
    for (const reason of [null, '', 'Different reason'])
      assert.deepEqual(
        (await f.cancel(order.id, { reason }).expect(200)).body,
        result.body,
      );
    assert.deepEqual(await f.state(order.id), after);
    const replay = await request(f.app)
      .post('/api/v1/checkout/orders')
      .set('Authorization', `Bearer ${f.tokens[0]}`)
      .set('Idempotency-Key', key)
      .send(intent)
      .expect(200);
    assert.equal(replay.body.data.status, 'CANCELLED');
    assert.deepEqual(await f.state(order.id), after);
    assert.equal(
      await f.prisma.cartItem.count({ where: { cartId: cart.id } }),
      0,
    );
  }
});

test('cancellation validates strict body/query and reason after trim without mutating on errors', async (t) => {
  const f = await fixture(t);
  const { order } = await f.checkout();
  const before = await f.state(order.id);
  for (const body of [
    { reason: 'x'.repeat(241) },
    { reason: 1 },
    { reason: {} },
    { status: 'CANCELLED' },
    { actorUserId: f.users[2].id },
    { quantityAfter: 50 },
    { idempotencyKey: randomUUID() },
    [],
  ])
    await f.cancel(order.id, body).expect(422);
  await f.cancel(order.id).query({ reason: 'spoof' }).expect(422);
  assert.deepEqual(await f.state(order.id), before);
  await f
    .cancel(order.id, { reason: '  ' + 'x'.repeat(240) + '  ' })
    .expect(200);
  assert.equal((await f.state(order.id)).order.cancellationReason.length, 240);
  for (const reason of [undefined, null, '', ' \n\t ']) {
    const g = await fixture(t);
    const created = await g.checkout();
    await g.cancel(created.order.id, { reason }).expect(200);
    const after = await g.state(created.order.id);
    assert.equal(after.order.cancellationReason, null);
    assert.equal(
      after.order.statusHistory.find((h) => h.toStatus === 'CANCELLED').reason,
      null,
    );
  }
});

test('PACKING, SHIPPING and DELIVERED reject Customer cancellation without stock/history writes', async (t) => {
  const f = await fixture(t);
  const { order } = await f.checkout();
  for (const status of ['PACKING', 'SHIPPING', 'DELIVERED']) {
    await f.prisma.order.update({ where: { id: order.id }, data: { status } });
    const before = await f.state(order.id);
    assert.equal(
      (await f.cancel(order.id).expect(409)).body.error.code,
      'INVALID_ORDER_TRANSITION',
    );
    assert.deepEqual(await f.state(order.id), before);
  }
});

test('concurrent cancellations serialize on owned Order and preserve the winning reason without duplicate effects', async (t) => {
  const f = await fixture(t);
  const { order } = await f.checkout();
  const app = f.makeApp(competingLocks(f.prisma, 'FROM "users"'));
  const results = await Promise.all([
    f.cancel(order.id, { reason: 'first' }, 0, app),
    f.cancel(order.id, { reason: 'second' }, 0, app),
  ]);
  assert.deepEqual(
    results.map((r) => r.status),
    [200, 200],
  );
  assert.deepEqual(results[0].body, results[1].body);
  const after = await f.state(order.id);
  assert.ok(['first', 'second'].includes(after.order.cancellationReason));
  assert.equal(
    after.order.statusHistory.filter((h) => h.toStatus === 'CANCELLED').length,
    1,
  );
  assert.equal(
    after.movements.filter((m) => m.type === 'ORDER_CANCEL_RESTORE').length,
    2,
  );
  assert.ok(after.stock.every((s) => s.quantityOnHand === 10));
});

test('different orders with shared stock serialize restoration without lost updates or stale movement quantities', async (t) => {
  const f = await fixture(t);
  const first = await f.checkout();
  const second = await f.checkout(1);
  const app = f.makeApp(competingLocks(f.prisma, 'FOR UPDATE OF i'));
  const results = await Promise.all([
    f.cancel(first.order.id, {}, 0, app),
    f.cancel(second.order.id, {}, 1, app),
  ]);
  assert.deepEqual(
    results.map((r) => r.status),
    [200, 200],
  );
  const after = await f.state(first.order.id);
  assert.ok(after.stock.every((s) => s.quantityOnHand === 10));
  for (let i = 0; i < 2; i++) {
    const restores = after.movements.filter(
      (m) =>
        m.productId === f.products[i].id && m.type === 'ORDER_CANCEL_RESTORE',
    );
    assert.deepEqual(
      restores.map((m) => m.quantityAfter).sort((a, b) => a - b),
      [10 - (i + 2), 10],
    );
    assert.ok(restores.every((m) => m.quantityDelta === i + 2));
    assert.deepEqual(
      restores.map((m) => m.orderId).sort(),
      [first.order.id, second.order.id].sort(),
    );
  }
});

test('same-Customer checkout and cancellation serialize safely in either lock order without actor-FK deadlocks', async (t) => {
  for (const winner of ['CANCEL', 'CHECKOUT'])
    await t.test(`${winner} acquires User lock first`, async (t) => {
      const f = await fixture(t);
      const first = await f.checkout();
      const cart = await f.prisma.cart.create({
        data: {
          userId: f.users[0].id,
          items: {
            create: f.products.map((p, i) => ({
              productId: p.id,
              quantity: i + 2,
            })),
          },
        },
      });
      let acquired, attempted;
      const ready = new Promise((resolve) => {
        acquired = resolve;
      });
      const waiting = new Promise((resolve) => {
        attempted = resolve;
      });
      const coordinate = (command) =>
        wrapTransactions(
          f.prisma,
          (tx) =>
            new Proxy(tx, {
              get(target, field) {
                if (field !== '$queryRaw') return target[field];
                return async (...args) => {
                  const text = (args[0].strings ?? args[0]).join('');
                  if (
                    !text.includes('FROM "users"') ||
                    !text.includes('FOR UPDATE')
                  )
                    return tx.$queryRaw(...args);
                  if (command === winner) {
                    const result = await tx.$queryRaw(...args);
                    acquired();
                    await waiting;
                    return result;
                  }
                  await ready;
                  attempted();
                  return tx.$queryRaw(...args);
                };
              },
            }),
        );
      const results = await Promise.all([
        f.cancel(first.order.id, {}, 0, f.makeApp(coordinate('CANCEL'))),
        request(f.makeApp(coordinate('CHECKOUT')))
          .post('/api/v1/checkout/orders')
          .set('Authorization', `Bearer ${f.tokens[0]}`)
          .set('Idempotency-Key', randomUUID())
          .send({ cartId: cart.id, addressId: first.intent.addressId }),
      ]);
      assert.deepEqual(
        results.map((r) => r.status),
        [200, 201],
      );
      const after = await f.state(first.order.id);
      for (let i = 0; i < 2; i++)
        assert.equal(
          after.stock.find((s) => s.productId === f.products[i].id)
            .quantityOnHand,
          10 - (i + 2),
        );
      assert.equal(after.movements.length, 6);
      assert.equal(after.order.status, 'CANCELLED');
      assert.equal(
        after.order.statusHistory.filter((h) => h.toStatus === 'CANCELLED')
          .length,
        1,
      );
      assert.equal(
        await f.prisma.cartItem.count({ where: { cartId: cart.id } }),
        0,
      );
    });
});

test('Customer cancellation and Admin adjustment share authoritative Inventory locks', async (t) => {
  const f = await fixture(t);
  const { order } = await f.checkout();
  const app = f.makeApp(competingLocks(f.prisma, 'FOR UPDATE OF i'));
  const results = await Promise.all([
    f.cancel(order.id, {}, 0, app),
    request(app)
      .post(`/api/v1/admin/inventory/${f.products[0].id}/adjustments`)
      .set('Authorization', `Bearer ${f.tokens[2]}`)
      .send({ adjustment: 4, reason: 'Stock reconciliation' }),
  ]);
  assert.deepEqual(
    results.map((r) => r.status),
    [200, 201],
  );
  const after = await f.state(order.id);
  assert.equal(
    after.stock.find((s) => s.productId === f.products[0].id).quantityOnHand,
    14,
  );
  const restore = after.movements.find(
    (m) =>
      m.productId === f.products[0].id && m.type === 'ORDER_CANCEL_RESTORE',
  );
  const adjustment = after.movements.find(
    (m) => m.productId === f.products[0].id && m.type === 'ADJUSTMENT',
  );
  assert.equal(restore.quantityDelta, 2);
  assert.equal(adjustment.quantityDelta, 4);
  assert.deepEqual(
    [restore.quantityAfter, adjustment.quantityAfter],
    restore.quantityAfter === 10 ? [10, 14] : [14, 12],
  );
  assert.equal(adjustment.actorUserId, f.users[2].id);
  assert.equal(
    await f.prisma.adminAuditLog.count({
      where: { actorUserId: f.users[2].id, action: 'INVENTORY_ADJUST' },
    }),
    1,
  );
});

test('database integer stock boundary rejects restoration atomically', async (t) => {
  const f = await fixture(t);
  const { order } = await f.checkout();
  await f.prisma.inventory.update({
    where: { productId: f.products[0].id },
    data: { quantityOnHand: 2147483647 },
  });
  const before = await f.state(order.id);
  await f.cancel(order.id).expect(500);
  assert.deepEqual(await f.state(order.id), before);
});

test('stock, movement, status and history failures roll back the complete cancellation and allow retry', async (t) => {
  for (const point of [
    'inventory',
    'inventoryMovement',
    'orderStatusHistory',
    'order',
  ]) {
    const f = await fixture(t);
    const { order } = await f.checkout();
    const before = await f.state(order.id);
    let calls = 0;
    const db = wrapTransactions(
      f.prisma,
      (tx) =>
        new Proxy(tx, {
          get(target, field) {
            if (field !== (point === 'orderStatusHistory' ? 'order' : point))
              return target[field];
            const method = field === 'inventoryMovement' ? 'create' : 'update';
            return new Proxy(target[field], {
              get(model, operation) {
                if (operation !== method) return model[operation];
                return async (args) => {
                  if (point === 'orderStatusHistory')
                    args.data.statusHistory.create.actorUserId = randomUUID();
                  const result = await model[operation](args);
                  if (
                    ++calls ===
                    (point === 'inventory' || point === 'inventoryMovement'
                      ? 2
                      : 1)
                  )
                    throw new Error('Injected persistence failure');
                  return result;
                };
              },
            });
          },
        }),
    );
    await f
      .cancel(order.id, { reason: 'Retry safely' }, 0, f.makeApp(db))
      .expect(500);
    assert.deepEqual(await f.state(order.id), before);
    await f.cancel(order.id, { reason: 'Retry safely' }).expect(200);
    assert.ok(
      (await f.state(order.id)).stock.every((s) => s.quantityOnHand === 10),
    );
  }
});
