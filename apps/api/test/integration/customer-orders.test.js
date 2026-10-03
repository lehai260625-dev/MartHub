import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import test from 'node:test';
import request from 'supertest';
import {
  customerOrderDetailResponseSchema,
  customerOrderListResponseSchema,
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
const price = 9007199254740993n;
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
          email: `read-order-${suffix}-${role.toLowerCase()}-${users.length}@example.test`,
          passwordHash: 'unused',
          firstName: 'Order',
          lastName: 'Reader',
          role,
        },
      }),
    );
  const category = await prisma.category.create({
    data: { name: 'Snapshot category', slug: `read-orders-${suffix}` },
  });
  const product = await prisma.product.create({
    data: {
      categoryId: category.id,
      sku: `READ-${suffix}`,
      name: 'Current catalog name',
      slug: `read-order-${suffix}`,
      sellingUnit: 'each',
    },
  });
  const address = await prisma.address.create({
    data: {
      userId: users[0].id,
      label: 'Home',
      recipientName: 'Current recipient',
      phone: '0901234567',
      line1: 'Current address',
      ward: 'Ward',
      district: 'District',
      province: 'Province',
    },
  });
  const tokens = [];
  const sessions = createSessionService({ prisma, config });
  for (const user of users)
    tokens.push((await sessions.issue(user.id)).data.accessToken);
  const app = createApp({
    prisma,
    authConfig: config,
    origin: config.origin,
    logger: () => {},
  });
  const get = (path = '/orders', token = tokens[0], target = app) =>
    request(target)
      .get('/api/v1' + path)
      .set('Authorization', `Bearer ${token}`);
  const create = (userId = users[0].id, overrides = {}) =>
    prisma.order.create({
      data: {
        orderNumber: `MH-${randomUUID()}`,
        userId,
        idempotencyKey: randomUUID(),
        requestFingerprint: 'private-fingerprint',
        subtotal: price * 3n,
        shippingFee: 0n,
        discountTotal: 0n,
        total: price * 3n,
        recipientName: 'Snapshot recipient',
        recipientPhone: '0900000000',
        addressLine1: 'Immutable address',
        addressLine2: null,
        ward: 'Original ward',
        district: 'Original district',
        province: 'Original province',
        postalCode: null,
        customerNote: 'Stored customer note',
        items: {
          create: {
            productId: product.id,
            sku: 'ORIGINAL-SKU',
            productName: 'Immutable product',
            imageUrl:
              'https://res.cloudinary.com/marthub/image/upload/original.webp',
            sellingUnit: 'box',
            unitPrice: price,
            compareAtPrice: price + 100n,
            quantity: 3,
            lineTotal: price * 3n,
          },
        },
        ...overrides,
      },
    });
  return {
    prisma,
    users,
    tokens,
    category,
    product,
    address,
    app,
    get,
    create,
  };
}

test('Customer order reads enforce database role, ownership, concealed IDs and no-store without writes', async (t) => {
  const f = await fixture(t);
  assert.deepEqual((await f.get().expect(200)).body, {
    data: [],
    meta: { page: 1, perPage: 20, totalItems: 0, totalPages: 0 },
  });
  const owned = await f.create();
  const foreign = await f.create(f.users[1].id);
  for (const path of ['/orders', `/orders/${owned.id}`]) {
    const unauthenticated = await request(f.app)
      .get('/api/v1' + path)
      .expect(401);
    assert.match(unauthenticated.headers['cache-control'], /no-store/);
    await f.get(path, f.tokens[2]).expect(403);
    assert.match(
      (await f.get(path).expect(200)).headers['cache-control'],
      /no-store/,
    );
  }
  const denied = [];
  for (const id of [foreign.id, randomUUID(), 'malformed'])
    denied.push((await f.get(`/orders/${id}`).expect(404)).body.error);
  assert.deepEqual(
    denied.map(({ code, message }) => ({ code, message })),
    Array(3).fill({ code: 'NOT_FOUND', message: 'Resource not found.' }),
  );
  assert.equal((await f.get().expect(200)).body.meta.totalItems, 1);
  await f.prisma.user.update({
    where: { id: f.users[0].id },
    data: { role: 'ADMIN' },
  });
  await f.get().expect(403);
  assert.equal(
    await f.prisma.order.count({ where: { userId: f.users[0].id } }),
    1,
  );
  assert.equal(
    await f.prisma.inventoryMovement.count({
      where: { productId: f.product.id },
    }),
    0,
  );
});

test('list uses approved defaults, status filter and both stable sort directions across page boundaries', async (t) => {
  const f = await fixture(t);
  const tied = new Date('2026-01-01T00:00:00.000Z');
  const ids = [];
  for (let i = 0; i < 23; i++)
    ids.push(
      (
        await f.create(undefined, {
          createdAt: tied,
          status: i === 0 ? 'DELIVERED' : 'PENDING',
        })
      ).id,
    );
  await f.create(f.users[1].id, { createdAt: new Date('2026-02-01') });
  const newest = (await f.get().expect(200)).body;
  assert.ok(customerOrderListResponseSchema.safeParse(newest).success);
  assert.deepEqual(newest.meta, {
    page: 1,
    perPage: 20,
    totalItems: 23,
    totalPages: 2,
  });
  const sorted = [...ids].sort();
  assert.deepEqual(
    newest.data.map((row) => row.id),
    [...sorted].reverse().slice(0, 20),
  );
  const second = (await f.get('/orders?page=2').expect(200)).body;
  assert.deepEqual(
    second.data.map((row) => row.id),
    [...sorted].reverse().slice(20),
  );
  const oldest = (await f.get('/orders?sort=oldest&perPage=50').expect(200))
    .body;
  assert.deepEqual(
    oldest.data.map((row) => row.id),
    sorted,
  );
  const pending = (
    await f.get('/orders?status=PENDING&sort=oldest&perPage=50').expect(200)
  ).body;
  assert.equal(pending.meta.totalItems, 22);
  assert.ok(pending.data.every((row) => row.status === 'PENDING'));
  const empty = (await f.get('/orders?status=CANCELLED').expect(200)).body;
  assert.deepEqual(empty, {
    data: [],
    meta: { page: 1, perPage: 20, totalItems: 0, totalPages: 0 },
  });
  assert.deepEqual((await f.get('/orders?page=3').expect(200)).body.data, []);
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
    ].sort(),
  );
  assert.equal(row.itemCount, 3);
  assert.equal(row.total, (price * 3n).toString());
  const earlier = await f.create(undefined, {
    createdAt: new Date('2025-01-01'),
  });
  const later = await f.create(undefined, {
    createdAt: new Date('2027-01-01'),
  });
  assert.equal(
    (await f.get('/orders?perPage=1').expect(200)).body.data[0].id,
    later.id,
  );
  assert.equal(
    (await f.get('/orders?perPage=1&sort=oldest').expect(200)).body.data[0].id,
    earlier.id,
  );
});

test('strict list/detail queries reject unsupported, repeated, malformed and overflowing inputs', async (t) => {
  const f = await fixture(t);
  const order = await f.create();
  for (const query of [
    'page=0',
    'page=-1',
    'page=1.5',
    'page=1e2',
    'page=9007199254740992',
    'page=2147483647&perPage=50',
    'perPage=0',
    'perPage=51',
    'perPage=2.5',
    'status=UNKNOWN',
    'sort=createdAt',
    'sort=NEWEST',
    'page=1&page=2',
    'status=PENDING&status=DELIVERED',
    'userId=' + f.users[1].id,
    'startsAt=2020-01-01',
    'q=anything',
  ]) {
    const res = await f.get('/orders?' + query).expect(422);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
  }
  await f.get(`/orders/${order.id}?include=actor`).expect(422);
  assert.equal(
    await f.prisma.order.count({ where: { userId: f.users[0].id } }),
    1,
  );
});

test('detail uses immutable exact snapshots and complete deterministic redacted history after mutable data changes', async (t) => {
  const f = await fixture(t);
  const base = randomUUID().slice(0, -12);
  const time = new Date('2026-01-02T00:00:00.000Z');
  const order = await f.create(undefined, {
    status: 'PACKING',
    statusHistory: {
      create: [
        {
          id: base + '000000000003',
          fromStatus: 'CONFIRMED',
          toStatus: 'PACKING',
          actorUserId: f.users[2].id,
          reason: 'Preparing package',
          createdAt: time,
        },
        {
          id: base + '000000000002',
          fromStatus: 'PENDING',
          toStatus: 'CONFIRMED',
          actorUserId: f.users[2].id,
          reason: 'Confirmed by store',
          createdAt: time,
        },
        {
          id: base + '000000000001',
          fromStatus: null,
          toStatus: 'PENDING',
          actorUserId: f.users[0].id,
          reason: null,
          createdAt: new Date('2026-01-01'),
        },
      ],
    },
  });
  const original = (await f.get('/orders/' + order.id).expect(200)).body;
  assert.ok(customerOrderDetailResponseSchema.safeParse(original).success);
  assert.deepEqual(
    original.data.statusHistory.map((row) => row.toStatus),
    ['PENDING', 'CONFIRMED', 'PACKING'],
  );
  assert.deepEqual(
    original.data.statusHistory.map((row) => row.reason),
    [null, 'Confirmed by store', 'Preparing package'],
  );
  for (const row of original.data.statusHistory)
    assert.deepEqual(
      Object.keys(row).sort(),
      ['fromStatus', 'toStatus', 'reason', 'createdAt'].sort(),
    );
  await f.prisma.product.update({
    where: { id: f.product.id },
    data: {
      name: 'Replacement catalog name',
      sku: `NEW-${randomUUID()}`,
      sellingUnit: 'each',
      status: 'ARCHIVED',
      archivedAt: new Date(),
    },
  });
  await f.prisma.productPriceHistory.create({
    data: {
      productId: f.product.id,
      price: 100n,
      startsAt: new Date('2020-01-01'),
    },
  });
  await f.prisma.inventory.create({
    data: { productId: f.product.id, quantityOnHand: 0 },
  });
  await f.prisma.address.update({
    where: { id: f.address.id },
    data: { line1: 'Changed live address', archivedAt: new Date() },
  });
  await f.prisma.user.update({
    where: { id: f.users[2].id },
    data: { email: `changed-actor-${randomUUID()}@example.test` },
  });
  assert.deepEqual(
    (await f.get('/orders/' + order.id).expect(200)).body,
    original,
  );
  assert.equal(original.data.items[0].productName, 'Immutable product');
  assert.equal(original.data.items[0].unitPrice, price.toString());
  assert.equal(
    original.data.items[0].compareAtPrice,
    (price + 100n).toString(),
  );
  assert.equal(original.data.address.line1, 'Immutable address');
  assert.equal(original.data.customerNote, 'Stored customer note');
  assert.equal(original.data.status, 'PACKING');
  for (const hidden of [
    'actorUserId',
    'email',
    'passwordHash',
    'userId',
    'requestFingerprint',
    'idempotencyKey',
  ])
    assert.equal(JSON.stringify(original).includes(`"${hidden}"`), false);
});
