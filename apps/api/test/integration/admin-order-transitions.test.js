import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import test from 'node:test';
import request from 'supertest';
import { adminOrderDetailResponseSchema } from '@marthub/contracts';
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

function wrapTransactions(prisma, wrap) {
  return new Proxy(prisma, {
    get(target, key) {
      if (key !== '$transaction') return target[key];
      return (callback, options) =>
        prisma.$transaction((tx) => callback(wrap(tx)), options);
    },
  });
}

function competingLocks(prisma, marker) {
  let arrivals = 0;
  let release;
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

async function fixture(t) {
  const database = createDatabase(
    validateDatabaseUrl(process.env.DATABASE_URL),
  );
  t.after(() => database.close());
  const { prisma } = database;
  const suffix = randomUUID();
  const customer = await prisma.user.create({
    data: {
      email: `transition-customer-${suffix}@example.test`,
      passwordHash: 'unused',
      firstName: 'Transition',
      lastName: 'Customer',
    },
  });
  const admin = await prisma.user.create({
    data: {
      email: `transition-admin-${suffix}@example.test`,
      passwordHash: 'unused',
      firstName: 'Transition',
      lastName: 'Admin',
      role: 'ADMIN',
    },
  });
  const category = await prisma.category.create({
    data: { name: 'Transition', slug: `transition-${suffix}` },
  });
  const quantities = [2, 3];
  const products = [];
  for (let index = 0; index < quantities.length; index += 1)
    products.push(
      await prisma.product.create({
        data: {
          categoryId: category.id,
          sku: `TRANSITION-${suffix}-${index}`,
          name: `Transition product ${index}`,
          slug: `transition-${suffix}-${index}`,
          sellingUnit: 'each',
          status: 'ACTIVE',
          inventory: {
            create: { quantityOnHand: 10 - quantities[index] },
          },
        },
      }),
    );
  const sessions = createSessionService({ prisma, config });
  const customerToken = (await sessions.issue(customer.id)).data.accessToken;
  const adminToken = (await sessions.issue(admin.id)).data.accessToken;
  const makeApp = (db = prisma) =>
    createApp({
      prisma: db,
      authConfig: config,
      origin: config.origin,
      logger: () => {},
    });
  const app = makeApp();
  const transition = (
    orderId,
    body,
    { token = adminToken, target = app } = {},
  ) =>
    request(target)
      .post(`/api/v1/admin/orders/${orderId}/transitions`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Request-Id', randomUUID())
      .send(body);
  const createOrder = (status = 'PENDING') =>
    prisma.order.create({
      data: {
        orderNumber: `MH-${randomUUID()}`,
        userId: customer.id,
        status,
        idempotencyKey: randomUUID(),
        requestFingerprint: randomUUID(),
        subtotal: 500000n,
        shippingFee: 0n,
        discountTotal: 0n,
        total: 500000n,
        recipientName: 'Immutable recipient',
        recipientPhone: '0901234567',
        addressLine1: 'Immutable address',
        ward: 'Ward',
        district: 'District',
        province: 'Province',
        ...(status === 'CANCELLED'
          ? {
              cancellationReason: 'Fixture cancellation',
              cancelledAt: new Date(),
            }
          : {}),
        ...(status === 'DELIVERED' ? { deliveredAt: new Date() } : {}),
        items: {
          create: products.map((product, index) => ({
            productId: product.id,
            sku: `SNAPSHOT-${index}`,
            productName: `Snapshot product ${index}`,
            sellingUnit: 'each',
            unitPrice: index === 0 ? 100000n : 100000n,
            quantity: quantities[index],
            lineTotal: BigInt(quantities[index]) * 100000n,
          })),
        },
        statusHistory: {
          create: {
            fromStatus: null,
            toStatus: status,
            actorUserId: customer.id,
            reason: status === 'CANCELLED' ? 'Fixture cancellation' : null,
          },
        },
      },
    });
  const state = async (orderId) => ({
    order: await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        statusHistory: {
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        },
      },
    }),
    stock: await prisma.inventory.findMany({
      where: { productId: { in: products.map(({ id }) => id) } },
      orderBy: { productId: 'asc' },
    }),
    movements: await prisma.inventoryMovement.findMany({
      where: { orderId },
      orderBy: { productId: 'asc' },
    }),
    audits: await prisma.adminAuditLog.findMany({
      where: { entityType: 'ORDER', entityId: orderId },
      orderBy: { createdAt: 'asc' },
    }),
  });
  return {
    prisma,
    customer,
    admin,
    products,
    quantities,
    customerToken,
    adminToken,
    app,
    makeApp,
    transition,
    createOrder,
    state,
  };
}

test('Admin transition command enforces RBAC, no-store, strict body, and reason boundaries', async (t) => {
  const f = await fixture(t);
  const order = await f.createOrder();
  const body = { expectedStatus: 'PENDING', toStatus: 'CONFIRMED' };
  const guest = await request(f.app)
    .post(`/api/v1/admin/orders/${order.id}/transitions`)
    .send(body)
    .expect(401);
  assert.match(guest.headers['cache-control'], /no-store/);
  await f.transition(order.id, body, { token: f.customerToken }).expect(403);
  await f.transition('not-a-uuid', body).expect(404);
  await request(f.app)
    .post(`/api/v1/admin/orders/${order.id}/transitions?force=true`)
    .set('Authorization', `Bearer ${f.adminToken}`)
    .send(body)
    .expect(422);
  for (const invalid of [
    {},
    { toStatus: 'CONFIRMED' },
    { expectedStatus: 'PENDING' },
    { expectedStatus: 'PENDING', toStatus: 'CANCELLED' },
    { expectedStatus: 'PENDING', toStatus: 'CANCELLED', reason: '   ' },
    {
      expectedStatus: 'PENDING',
      toStatus: 'CANCELLED',
      reason: 'x'.repeat(241),
    },
    {
      expectedStatus: 'PENDING',
      toStatus: 'CONFIRMED',
      reason: 'must be rejected',
    },
    {
      expectedStatus: 'PENDING',
      toStatus: 'CONFIRMED',
      internal: true,
    },
  ]) {
    const response = await f.transition(order.id, invalid).expect(422);
    assert.equal(response.body.error.code, 'VALIDATION_ERROR');
  }
  const after = await f.state(order.id);
  assert.equal(after.order.status, 'PENDING');
  assert.equal(after.order.statusHistory.length, 1);
  assert.equal(after.audits.length, 0);
});

test('Admin applies the complete forward chain with actor history, delivery timestamp, and safe audits', async (t) => {
  const f = await fixture(t);
  const order = await f.createOrder();
  let expectedStatus = 'PENDING';
  for (const toStatus of ['CONFIRMED', 'PACKING', 'SHIPPING', 'DELIVERED']) {
    const response = await f
      .transition(order.id, { expectedStatus, toStatus })
      .expect(200);
    assert.match(response.headers['cache-control'], /no-store/);
    assert.ok(adminOrderDetailResponseSchema.safeParse(response.body).success);
    assert.equal(response.body.data.status, toStatus);
    expectedStatus = toStatus;
  }
  const after = await f.state(order.id);
  assert.equal(after.order.status, 'DELIVERED');
  assert.ok(after.order.deliveredAt instanceof Date);
  assert.equal(after.order.cancellationReason, null);
  assert.deepEqual(
    after.order.statusHistory.map(({ toStatus }) => toStatus),
    ['PENDING', 'CONFIRMED', 'PACKING', 'SHIPPING', 'DELIVERED'],
  );
  assert.ok(
    after.order.statusHistory
      .slice(1)
      .every(
        ({ actorUserId, reason }) =>
          actorUserId === f.admin.id && reason === null,
      ),
  );
  assert.equal(after.movements.length, 0);
  assert.equal(after.audits.length, 4);
  for (const audit of after.audits) {
    assert.equal(audit.action, 'ORDER_STATUS_TRANSITION');
    assert.equal(audit.entityType, 'ORDER');
    assert.equal(audit.actorUserId, f.admin.id);
    assert.deepEqual(Object.keys(audit.beforeJson).sort(), [
      'orderNumber',
      'status',
    ]);
    assert.deepEqual(Object.keys(audit.afterJson).sort(), [
      'orderNumber',
      'status',
    ]);
  }
});

test('Admin rejects skip, backward, and terminal mutations without effects', async (t) => {
  const f = await fixture(t);
  const cases = [
    ['PENDING', 'PACKING'],
    ['CONFIRMED', 'PENDING'],
    ['PACKING', 'CONFIRMED'],
    ['SHIPPING', 'PACKING'],
    ['DELIVERED', 'CANCELLED'],
    ['CANCELLED', 'PENDING'],
  ];
  for (const [expectedStatus, toStatus] of cases) {
    const order = await f.createOrder(expectedStatus);
    const response = await f
      .transition(order.id, {
        expectedStatus,
        toStatus,
        ...(toStatus === 'CANCELLED'
          ? { reason: 'Invalid terminal jump' }
          : {}),
      })
      .expect(409);
    assert.equal(response.body.error.code, 'INVALID_ORDER_TRANSITION');
    const after = await f.state(order.id);
    assert.equal(after.order.status, expectedStatus);
    assert.equal(after.order.statusHistory.length, 1);
    assert.equal(after.movements.length, 0);
    assert.equal(after.audits.length, 0);
  }
});

test('Admin stale writes conflict while same-target retries are successful no-ops', async (t) => {
  const f = await fixture(t);
  const order = await f.createOrder();
  const command = { expectedStatus: 'PENDING', toStatus: 'CONFIRMED' };
  const first = await f.transition(order.id, command).expect(200);
  const beforeRetry = await f.state(order.id);
  const retry = await f.transition(order.id, command).expect(200);
  assert.deepEqual(retry.body, first.body);
  assert.deepEqual(await f.state(order.id), beforeRetry);

  const stale = await f
    .transition(order.id, {
      expectedStatus: 'PENDING',
      toStatus: 'PACKING',
    })
    .expect(409);
  assert.equal(stale.body.error.code, 'ORDER_STATUS_CONFLICT');
  assert.deepEqual(stale.body.error.details, [
    { currentStatus: 'CONFIRMED', expectedStatus: 'PENDING' },
  ]);
  assert.deepEqual(await f.state(order.id), beforeRetry);
});

test('Admin cancellation from every eligible state requires and preserves the committed reason with exactly-once restoration', async (t) => {
  for (const expectedStatus of ['PENDING', 'CONFIRMED', 'PACKING'])
    await t.test(expectedStatus, async (t) => {
      const f = await fixture(t);
      const order = await f.createOrder(expectedStatus);
      const reason =
        expectedStatus === 'PACKING'
          ? '  ' + 'x'.repeat(240) + '  '
          : `  Cancel ${expectedStatus} safely  `;
      const normalized = reason.trim();
      const first = await f
        .transition(order.id, {
          expectedStatus,
          toStatus: 'CANCELLED',
          reason,
        })
        .expect(200);
      assert.equal(first.body.data.status, 'CANCELLED');
      assert.equal(first.body.data.statusHistory.at(-1).reason, normalized);
      const committed = await f.state(order.id);
      assert.equal(committed.order.cancellationReason, normalized);
      assert.ok(committed.order.cancelledAt instanceof Date);
      assert.equal(committed.movements.length, 2);
      assert.ok(
        committed.movements.every(
          ({ actorUserId, reason: movementReason }) =>
            actorUserId === f.admin.id && movementReason === normalized,
        ),
      );
      assert.deepEqual(
        committed.stock.map(({ quantityOnHand }) => quantityOnHand),
        [10, 10],
      );
      assert.equal(committed.audits.length, 1);
      assert.deepEqual(committed.audits[0].beforeJson, {
        orderNumber: committed.order.orderNumber,
        status: expectedStatus,
        cancellationReason: null,
      });
      assert.deepEqual(committed.audits[0].afterJson, {
        orderNumber: committed.order.orderNumber,
        status: 'CANCELLED',
        cancellationReason: normalized,
      });

      const repeated = await f
        .transition(order.id, {
          expectedStatus,
          toStatus: 'CANCELLED',
          reason: 'A different retry reason',
        })
        .expect(200);
      assert.equal(repeated.body.data.statusHistory.at(-1).reason, normalized);
      assert.deepEqual(await f.state(order.id), committed);
    });
});

test('Concurrent Admin commands serialize into one winner with deterministic no-op or stale conflict behavior', async (t) => {
  await t.test('same target retries', async (t) => {
    const f = await fixture(t);
    const order = await f.createOrder();
    const app = f.makeApp(competingLocks(f.prisma, 'FROM "users"'));
    const command = { expectedStatus: 'PENDING', toStatus: 'CONFIRMED' };
    const responses = await Promise.all([
      f.transition(order.id, command, { target: app }),
      f.transition(order.id, command, { target: app }),
    ]);
    assert.deepEqual(
      responses.map(({ status }) => status),
      [200, 200],
    );
    assert.deepEqual(responses[0].body, responses[1].body);
    const after = await f.state(order.id);
    assert.equal(after.order.statusHistory.length, 2);
    assert.equal(after.audits.length, 1);
  });

  await t.test('different targets from one expected state', async (t) => {
    const f = await fixture(t);
    const order = await f.createOrder();
    const app = f.makeApp(competingLocks(f.prisma, 'FROM "users"'));
    const responses = await Promise.all([
      f.transition(
        order.id,
        { expectedStatus: 'PENDING', toStatus: 'CONFIRMED' },
        { target: app },
      ),
      f.transition(
        order.id,
        {
          expectedStatus: 'PENDING',
          toStatus: 'CANCELLED',
          reason: 'Concurrent cancellation',
        },
        { target: app },
      ),
    ]);
    assert.deepEqual(responses.map(({ status }) => status).sort(), [200, 409]);
    assert.equal(
      responses.find(({ status }) => status === 409).body.error.code,
      'ORDER_STATUS_CONFLICT',
    );
    const after = await f.state(order.id);
    assert.ok(['CONFIRMED', 'CANCELLED'].includes(after.order.status));
    assert.equal(after.order.statusHistory.length, 2);
    assert.equal(after.audits.length, 1);
    assert.equal(
      after.movements.length,
      after.order.status === 'CANCELLED' ? 2 : 0,
    );
  });

  await t.test(
    'Admin and Customer cancellation share the owner and Order locks',
    async (t) => {
      const f = await fixture(t);
      const order = await f.createOrder();
      const app = f.makeApp(competingLocks(f.prisma, 'FROM "users"'));
      const responses = await Promise.all([
        f.transition(
          order.id,
          {
            expectedStatus: 'PENDING',
            toStatus: 'CANCELLED',
            reason: 'Admin won cancellation',
          },
          { target: app },
        ),
        request(app)
          .post(`/api/v1/orders/${order.id}/cancel`)
          .set('Authorization', `Bearer ${f.customerToken}`)
          .send({ reason: 'Customer won cancellation' }),
      ]);
      assert.deepEqual(
        responses.map(({ status }) => status),
        [200, 200],
      );
      const after = await f.state(order.id);
      const cancellation = after.order.statusHistory.find(
        ({ toStatus }) => toStatus === 'CANCELLED',
      );
      assert.equal(after.order.status, 'CANCELLED');
      assert.equal(after.order.statusHistory.length, 2);
      assert.equal(after.movements.length, 2);
      assert.deepEqual(
        after.stock.map(({ quantityOnHand }) => quantityOnHand),
        [10, 10],
      );
      assert.equal(
        after.audits.length,
        cancellation.actorUserId === f.admin.id ? 1 : 0,
      );
      assert.ok(
        ['Admin won cancellation', 'Customer won cancellation'].includes(
          after.order.cancellationReason,
        ),
      );
      assert.ok(
        after.movements.every(
          ({ actorUserId }) => actorUserId === cancellation.actorUserId,
        ),
      );
    },
  );
});

test('Admin audit failure rolls back cancellation status, history, stock, and movements together', async (t) => {
  const f = await fixture(t);
  const order = await f.createOrder('PACKING');
  const before = await f.state(order.id);
  const failing = wrapTransactions(
    f.prisma,
    (tx) =>
      new Proxy(tx, {
        get(target, field) {
          if (field !== 'adminAuditLog') return target[field];
          return new Proxy(target[field], {
            get(model, operation) {
              if (operation !== 'create') return model[operation];
              return async (args) => {
                await model.create(args);
                throw new Error('Injected audit persistence failure');
              };
            },
          });
        },
      }),
  );
  const command = {
    expectedStatus: 'PACKING',
    toStatus: 'CANCELLED',
    reason: 'Atomic rollback',
  };
  await f
    .transition(order.id, command, { target: f.makeApp(failing) })
    .expect(500);
  assert.deepEqual(await f.state(order.id), before);
  await f.transition(order.id, command).expect(200);
  const after = await f.state(order.id);
  assert.equal(after.order.status, 'CANCELLED');
  assert.equal(after.movements.length, 2);
  assert.equal(after.audits.length, 1);
});
