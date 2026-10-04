import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import test from 'node:test';
import request from 'supertest';
import {
  adminOrderDetailResponseSchema,
  adminOrderListResponseSchema,
} from '@marthub/contracts';
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
const exactPrice = 9007199254740993n;

async function fixture(t) {
  const database = createDatabase(
    validateDatabaseUrl(process.env.DATABASE_URL),
  );
  t.after(() => database.close());
  const { prisma } = database;
  const suffix = randomUUID();
  const customer = await prisma.user.create({
    data: {
      email: `buyer-${suffix}@example.test`,
      passwordHash: 'unused',
      firstName: 'Current',
      lastName: 'Customer',
      phone: '+84 901 234 567',
    },
  });
  const otherCustomer = await prisma.user.create({
    data: {
      email: `other-${suffix}@example.test`,
      passwordHash: 'unused',
      firstName: 'Other',
      lastName: 'Customer',
    },
  });
  const admin = await prisma.user.create({
    data: {
      email: `admin-${suffix}@example.test`,
      passwordHash: 'unused',
      firstName: 'Order',
      lastName: 'Admin',
      role: 'ADMIN',
    },
  });
  const category = await prisma.category.create({
    data: { name: 'Admin order test', slug: `admin-order-${suffix}` },
  });
  const product = await prisma.product.create({
    data: {
      categoryId: category.id,
      sku: `CURRENT-${suffix}`,
      name: 'Current product name',
      slug: `admin-order-product-${suffix}`,
      sellingUnit: 'each',
    },
  });
  const sessions = createSessionService({ prisma, config });
  const customerToken = (await sessions.issue(customer.id)).data.accessToken;
  const adminToken = (await sessions.issue(admin.id)).data.accessToken;
  const app = createApp({
    prisma,
    authConfig: config,
    origin: config.origin,
    logger: () => {},
  });
  const get = (path, token = adminToken) =>
    request(app)
      .get('/api/v1' + path)
      .set('Authorization', `Bearer ${token}`);
  const createOrder = (overrides = {}) =>
    prisma.order.create({
      data: {
        orderNumber: `MH-${randomUUID()}`,
        userId: customer.id,
        idempotencyKey: randomUUID(),
        requestFingerprint: 'never-expose-this-fingerprint',
        subtotal: exactPrice * 2n,
        shippingFee: 30000n,
        discountTotal: 0n,
        total: exactPrice * 2n + 30000n,
        recipientName: 'Snapshot Recipient',
        recipientPhone: '0900000000',
        addressLine1: 'Snapshot address line',
        addressLine2: 'Snapshot unit',
        ward: 'Snapshot ward',
        district: 'Snapshot district',
        province: 'Snapshot province',
        postalCode: '700000',
        customerNote: 'Immutable note',
        items: {
          create: {
            productId: product.id,
            sku: 'SNAPSHOT-SKU',
            productName: 'Snapshot product name',
            imageUrl:
              'https://res.cloudinary.com/marthub/image/upload/snapshot.webp',
            sellingUnit: 'box',
            unitPrice: exactPrice,
            compareAtPrice: exactPrice + 100n,
            quantity: 2,
            lineTotal: exactPrice * 2n,
          },
        },
        ...overrides,
      },
    });
  return {
    prisma,
    app,
    get,
    createOrder,
    customer,
    otherCustomer,
    admin,
    customerToken,
    product,
    suffix,
  };
}

test('Admin order reads enforce RBAC, no-store, strict query allowlists, and no writes', async (t) => {
  const f = await fixture(t);
  const orderCountBefore = await f.prisma.order.count();
  const historyCountBefore = await f.prisma.orderStatusHistory.count();
  const order = await f.createOrder();
  const paths = ['/admin/orders', `/admin/orders/${order.id}`];
  for (const path of paths) {
    const unauthenticated = await request(f.app)
      .get('/api/v1' + path)
      .expect(401);
    assert.match(unauthenticated.headers['cache-control'], /no-store/);
    await f.get(path, f.customerToken).expect(403);
    const allowed = await f.get(path).expect(200);
    assert.match(allowed.headers['cache-control'], /no-store/);
  }
  for (const query of [
    'unknown=true',
    'q=first&q=second',
    'status=PENDING&status=DELIVERED',
    'status=UNKNOWN',
    'page=0',
    'page=1&page=2',
    'page=2147483647&perPage=50',
    'perPage=51',
    'sort=total',
    'dateFrom=2026-01-01',
    'q=' + 'x'.repeat(101),
  ]) {
    const response = await f.get('/admin/orders?' + query).expect(422);
    assert.equal(response.body.error.code, 'VALIDATION_ERROR');
  }
  await f.get(`/admin/orders/${order.id}?actor=true`).expect(422);
  await f.get('/admin/orders/not-a-uuid').expect(404);
  assert.equal(await f.prisma.order.count(), orderCountBefore + 1);
  assert.equal(await f.prisma.orderStatusHistory.count(), historyCountBefore);
});

test('Admin queue searches approved fields only and applies status, stable sort, and pagination', async (t) => {
  const f = await fixture(t);
  const tied = new Date('2026-01-01T00:00:00.000Z');
  const created = [];
  for (let index = 0; index < 22; index += 1)
    created.push(
      await f.createOrder({
        createdAt: tied,
        status: index === 0 ? 'DELIVERED' : 'PENDING',
        recipientName:
          index === 1 ? `Nguyen ${f.suffix} Van Minh` : 'Snapshot Recipient',
      }),
    );
  await f.prisma.order.create({
    data: {
      orderNumber: `MH-${randomUUID()}`,
      userId: f.otherCustomer.id,
      idempotencyKey: randomUUID(),
      requestFingerprint: 'other',
      subtotal: 1n,
      shippingFee: 0n,
      total: 1n,
      recipientName: 'Other recipient',
      recipientPhone: '0900000000',
      addressLine1: 'Other address',
      ward: 'Ward',
      district: 'District',
      province: 'Province',
      createdAt: tied,
    },
  });

  const scope = encodeURIComponent(f.suffix);
  const newest = (await f.get(`/admin/orders?q=${scope}`).expect(200)).body;
  assert.ok(adminOrderListResponseSchema.safeParse(newest).success);
  assert.deepEqual(newest.meta, {
    page: 1,
    perPage: 20,
    totalItems: 23,
    totalPages: 2,
  });
  const ids = [
    ...created.map(({ id }) => id),
    (await f.prisma.order.findFirst({ where: { userId: f.otherCustomer.id } }))
      .id,
  ].sort();
  assert.deepEqual(
    newest.data.map(({ id }) => id),
    [...ids].reverse().slice(0, 20),
  );
  assert.deepEqual(
    (await f.get(`/admin/orders?q=${scope}&page=2`).expect(200)).body.data.map(
      ({ id }) => id,
    ),
    [...ids].reverse().slice(20),
  );
  assert.deepEqual(
    (
      await f.get(`/admin/orders?q=${scope}&sort=oldest&perPage=50`).expect(200)
    ).body.data.map(({ id }) => id),
    ids,
  );
  assert.equal(
    (await f.get(`/admin/orders?q=${scope}&status=DELIVERED`).expect(200)).body
      .meta.totalItems,
    1,
  );
  const allOrders = (await f.get('/admin/orders?perPage=1').expect(200)).body
    .meta.totalItems;
  assert.equal(
    (await f.get('/admin/orders?q=%20%20%20&perPage=1').expect(200)).body.meta
      .totalItems,
    allOrders,
  );
  assert.equal(
    (
      await f
        .get(
          `/admin/orders?q=${encodeURIComponent(`NGUYEN   ${f.suffix}   VAN MINH`)}`,
        )
        .expect(200)
    ).body.meta.totalItems,
    1,
  );
  assert.equal(
    (
      await f
        .get(
          `/admin/orders?q=${encodeURIComponent(f.customer.email.toUpperCase())}`,
        )
        .expect(200)
    ).body.meta.totalItems,
    22,
  );
  assert.equal(
    (
      await f
        .get(
          `/admin/orders?q=${created[0].orderNumber.slice(3, 15).toUpperCase()}`,
        )
        .expect(200)
    ).body.meta.totalItems,
    1,
  );
  assert.equal(
    (await f.get('/admin/orders?q=SNAPSHOT-SKU').expect(200)).body.meta
      .totalItems,
    0,
  );
  const row = newest.data[0];
  assert.deepEqual(
    Object.keys(row).sort(),
    [
      'id',
      'orderNumber',
      'status',
      'createdAt',
      'subtotal',
      'shippingFee',
      'discountTotal',
      'total',
      'currency',
      'paymentMethod',
      'itemCount',
      'customer',
    ].sort(),
  );
  assert.deepEqual(Object.keys(row.customer).sort(), ['email', 'userId']);
  assert.equal(row.itemCount >= 0, true);
});

test('Admin detail returns exact immutable snapshots and complete deterministic operational history', async (t) => {
  const f = await fixture(t);
  const base = randomUUID().slice(0, -12);
  const tied = new Date('2026-02-01T00:00:00.000Z');
  const order = await f.createOrder({
    status: 'PACKING',
    statusHistory: {
      create: [
        {
          id: base + '000000000003',
          fromStatus: 'CONFIRMED',
          toStatus: 'PACKING',
          actorUserId: f.admin.id,
          reason: 'Packing',
          createdAt: tied,
        },
        {
          id: base + '000000000002',
          fromStatus: 'PENDING',
          toStatus: 'CONFIRMED',
          actorUserId: f.admin.id,
          reason: 'Confirmed',
          createdAt: tied,
        },
        {
          id: base + '000000000001',
          fromStatus: null,
          toStatus: 'PENDING',
          actorUserId: f.customer.id,
          reason: null,
          createdAt: new Date('2026-01-01'),
        },
      ],
    },
  });
  const original = (await f.get('/admin/orders/' + order.id).expect(200)).body;
  assert.ok(adminOrderDetailResponseSchema.safeParse(original).success);
  assert.deepEqual(
    original.data.statusHistory.map(({ status }) => status),
    ['PENDING', 'CONFIRMED', 'PACKING'],
  );
  assert.deepEqual(
    Object.keys(original.data.statusHistory[0]).sort(),
    ['id', 'status', 'reason', 'createdAt', 'actorUserId'].sort(),
  );
  assert.equal(original.data.statusHistory[1].actorUserId, f.admin.id);
  await f.prisma.product.update({
    where: { id: f.product.id },
    data: {
      name: 'Changed catalog name',
      sku: `CHANGED-${randomUUID()}`,
      sellingUnit: 'each',
    },
  });
  await f.prisma.user.update({
    where: { id: f.customer.id },
    data: {
      email: `updated-${randomUUID()}@example.test`,
      firstName: 'Updated',
    },
  });
  const current = (await f.get('/admin/orders/' + order.id).expect(200)).body;
  assert.equal(current.data.customer.email.startsWith('updated-'), true);
  assert.equal(current.data.customer.firstName, 'Updated');
  assert.equal(current.data.items[0].productName, 'Snapshot product name');
  assert.equal(current.data.items[0].sku, 'SNAPSHOT-SKU');
  assert.equal(current.data.items[0].unitPrice, exactPrice.toString());
  assert.equal(current.data.address.line1, 'Snapshot address line');
  assert.equal(current.data.total, (exactPrice * 2n + 30000n).toString());
  for (const hidden of [
    'passwordHash',
    'refreshSessions',
    'idempotencyKey',
    'requestFingerprint',
    'actorEmail',
    'actorType',
  ])
    assert.equal(JSON.stringify(current).includes(`"${hidden}"`), false);
});
