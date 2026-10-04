import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import test from 'node:test';
import request from 'supertest';
import { recommendationsResponseSchema } from '@marthub/contracts';
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
          email: `items-${randomUUID()}@example.test`,
          passwordHash: 'unused',
          firstName: 'Items',
          lastName: 'Test',
          role,
        },
      }),
    );
  const category = await prisma.category.create({
    data: { name: 'My Items', slug: `items-${randomUUID()}` },
  });
  const products = [];
  const product = async (options = {}) => {
    const suffix = randomUUID();
    const row = await prisma.product.create({
      data: {
        categoryId: category.id,
        sku: `ITEMS-${suffix}`,
        slug: `items-${suffix}`,
        name: 'Current catalog',
        sellingUnit: 'each',
        status: 'ACTIVE',
        inventory: { create: { quantityOnHand: 8 } },
        prices: { create: { price, startsAt: new Date('2020-01-01') } },
        ...options,
      },
    });
    products.push(row);
    return row;
  };
  const order = async (
    items,
    {
      userId = users[0].id,
      status = 'DELIVERED',
      delivered = '2022-01-01T00:00:00.000Z',
      name = 'Original name',
      id = randomUUID(),
    } = {},
  ) =>
    prisma.order.create({
      data: {
        id,
        orderNumber: `MH-${randomUUID()}`,
        userId,
        status,
        idempotencyKey: randomUUID(),
        requestFingerprint: 'private fingerprint',
        subtotal:
          price * BigInt(items.reduce((sum, item) => sum + item.quantity, 0)),
        shippingFee: 0n,
        discountTotal: 0n,
        total:
          price * BigInt(items.reduce((sum, item) => sum + item.quantity, 0)),
        recipientName: 'Private recipient',
        recipientPhone: '0900000000',
        addressLine1: 'Private address',
        ward: 'Ward',
        district: 'District',
        province: 'Province',
        createdAt: new Date('2020-01-01'),
        placedAt: new Date('2020-01-02'),
        deliveredAt: status === 'DELIVERED' ? new Date('2021-01-01') : null,
        items: {
          create: items.map((item) => ({
            productId: item.product.id,
            sku: 'SNAPSHOT-SKU',
            productName: name,
            imageUrl:
              'https://res.cloudinary.com/marthub/image/upload/history.webp',
            sellingUnit: 'original box',
            quantity: item.quantity,
            unitPrice: price,
            lineTotal: price * BigInt(item.quantity),
          })),
        },
        statusHistory: {
          create: [
            {
              fromStatus: null,
              toStatus: 'PENDING',
              createdAt: new Date('2020-01-02'),
              actorUserId: userId,
            },
            ...(status === 'DELIVERED'
              ? [
                  {
                    fromStatus: 'SHIPPING',
                    toStatus: 'DELIVERED',
                    createdAt: new Date(delivered),
                    actorUserId: users[2].id,
                  },
                ]
              : []),
          ],
        },
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
  const get = (query = {}, index = 0, target = app) =>
    request(target)
      .get('/api/v1/users/me/recommendations')
      .set('Authorization', `Bearer ${tokens[index]}`)
      .query(query);
  return {
    prisma,
    users,
    category,
    products,
    product,
    order,
    app,
    makeApp,
    get,
  };
}

test('recommendations enforce Customer ownership/role, no-store, strict queries and safe popular fallback', async (t) => {
  const f = await fixture(t);
  const popular = await f.product({
    isPopular: true,
    publishedAt: new Date('2050-01-01'),
  });
  const res = await f.get().expect(200);
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.ok(recommendationsResponseSchema.safeParse(res.body).success);
  assert.equal(res.body.data.label, 'POPULAR');
  assert.equal(res.body.data.products[0].id, popular.id);
  assert.equal(res.body.data.products[0].price, price.toString());
  assert.ok(res.body.data.products.length <= 8);
  await request(f.app).get('/api/v1/users/me/recommendations').expect(401);
  await f.get({}, 2).expect(403);
  for (const query of [
    { userId: f.users[1].id },
    { limit: '9' },
    { page: '1' },
    { sort: 'frequent' },
    { label: 'PERSONALIZED' },
    { page: ['1', '2'] },
  ])
    await f.get(query).expect(422);
  assert.equal(
    await f.prisma.order.count({ where: { userId: f.users[0].id } }),
    0,
  );
  await f.prisma.user.update({
    where: { id: f.users[0].id },
    data: { role: 'ADMIN' },
  });
  await f.get().expect(403);
});

test('all-time quantity affinity, popular flag, creation and ID ties determine ranking without other Customer data', async (t) => {
  const f = await fixture(t);
  const categoryB = await f.prisma.category.create({
    data: { name: 'B', slug: 'b-' + randomUUID() },
  });
  const categoryC = await f.prisma.category.create({
    data: { name: 'C', slug: 'c-' + randomUUID() },
  });
  const boughtA = await f.product();
  const boughtB = await f.product({ categoryId: categoryB.id });
  const boughtC = await f.product({ categoryId: categoryC.id });
  await f.order(
    [
      { product: boughtA, quantity: 6 },
      { product: boughtB, quantity: 2 },
      { product: boughtC, quantity: 10 },
    ],
    { delivered: '2001-01-01T00:00:00.000Z' },
  );
  await f.order([{ product: boughtA, quantity: 4 }]);
  await f.order([{ product: boughtB, quantity: 99 }], {
    userId: f.users[1].id,
  });
  for (const status of [
    'PENDING',
    'CONFIRMED',
    'PACKING',
    'SHIPPING',
    'CANCELLED',
  ])
    await f.order([{ product: boughtB, quantity: 99 }], { status });
  const base = randomUUID().slice(0, -12);
  const first = await f.product({
    id: base + '000000000001',
    isPopular: true,
    createdAt: new Date('2025-01-01'),
  });
  const second = await f.product({
    id: base + '000000000002',
    categoryId: categoryC.id,
    isPopular: true,
    createdAt: new Date('2025-01-01'),
  });
  const third = await f.product({
    isPopular: true,
    createdAt: new Date('2024-01-01'),
  });
  const fourth = await f.product({ createdAt: new Date('2026-01-01') });
  const fifth = await f.product({
    categoryId: categoryB.id,
    isPopular: true,
    createdAt: new Date('2099-01-01'),
  });
  const data = (await f.get().expect(200)).body.data;
  assert.equal(data.label, 'PERSONALIZED');
  assert.deepEqual(
    data.products.map(({ id }) => id),
    [first.id, second.id, third.id, fourth.id, fifth.id],
  );
  assert.deepEqual((await f.get().expect(200)).body.data, data);
  for (const secret of [
    'Private recipient',
    'Private address',
    'private fingerprint',
    'categoryAffinity',
    'actorUserId',
    f.users[1].id,
  ])
    assert.ok(!JSON.stringify(data).includes(secret));
});

test('one delivered product is sufficient, partial personalization is not padded, result caps at eight', async (t) => {
  const f = await fixture(t);
  const bought = await f.product();
  await f.order([{ product: bought, quantity: 1 }]);
  const candidate = await f.product();
  let data = (await f.get().expect(200)).body.data;
  assert.equal(data.label, 'PERSONALIZED');
  assert.deepEqual(
    data.products.map(({ id }) => id),
    [candidate.id],
  );
  const rows = [candidate];
  for (let i = 0; i < 10; i++)
    rows.push(
      await f.product({ createdAt: new Date('2026-01-01T00:00:00.000Z') }),
    );
  data = (await f.get().expect(200)).body.data;
  rows.sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));
  assert.equal(data.products.length, 8);
  assert.deepEqual(
    data.products.map(({ id }) => id),
    rows.slice(0, 8).map(({ id }) => id),
  );
});

test('affinity follows current taxonomy after reassignment, including archived purchased products', async (t) => {
  const f = await fixture(t);
  const next = await f.prisma.category.create({
    data: { name: 'New category', slug: 'next-' + randomUUID() },
  });
  const bought = await f.product();
  await f.order([{ product: bought, quantity: 3 }]);
  const oldCandidate = await f.product();
  const newCandidate = await f.product({ categoryId: next.id });
  assert.deepEqual(
    (await f.get().expect(200)).body.data.products.map(({ id }) => id),
    [oldCandidate.id],
  );
  await f.prisma.product.update({
    where: { id: bought.id },
    data: { categoryId: next.id, status: 'ARCHIVED', archivedAt: new Date() },
  });
  assert.deepEqual(
    (await f.get().expect(200)).body.data.products.map(({ id }) => id),
    [newCandidate.id],
  );
});

test('personalized candidates exclude purchased, hidden, archived, hidden ancestry, missing/future prices and zero stock', async (t) => {
  const f = await fixture(t);
  const bought = await f.product({ isPopular: true });
  await f.order([{ product: bought, quantity: 1 }]);
  const good = await f.product();
  await f.product({ status: 'DRAFT' });
  await f.product({ status: 'ARCHIVED', archivedAt: new Date() });
  await f.product({ prices: undefined });
  await f.product({
    prices: { create: { price, startsAt: new Date('2099-01-01') } },
  });
  await f.product({ inventory: { create: { quantityOnHand: 0 } } });
  assert.deepEqual(
    (await f.get().expect(200)).body.data.products.map(({ id }) => id),
    [good.id],
  );
  const parent = await f.prisma.category.create({
    data: {
      name: 'Hidden parent',
      slug: 'parent-' + randomUUID(),
      status: 'ARCHIVED',
      archivedAt: new Date(),
    },
  });
  await f.prisma.category.update({
    where: { id: f.category.id },
    data: { parentId: parent.id },
  });
  const fallback = (await f.get().expect(200)).body.data;
  assert.equal(fallback.label, 'POPULAR');
  assert.ok(
    !fallback.products.some(({ id }) =>
      f.products.some((product) => product.id === id),
    ),
  );
});

test('popular fallback uses M3.5 ordering, filters before limiting and can be empty with history', async (t) => {
  const f = await fixture(t);
  const bought = await f.product({
    isPopular: true,
    publishedAt: new Date('2099-01-01'),
  });
  await f.order([{ product: bought, quantity: 1 }]);
  const other = await f.prisma.category.create({
    data: { name: 'Popular category', slug: 'popular-' + randomUUID() },
  });
  // These newer popular rows must not consume any eligible result slots.
  for (let i = 0; i < 9; i++)
    await f.product({
      categoryId: other.id,
      isPopular: true,
      publishedAt: new Date('2099-01-01'),
      inventory: { create: { quantityOnHand: 0 } },
    });
  const older = await f.product({
    categoryId: other.id,
    isPopular: true,
    publishedAt: new Date('2097-01-01'),
  });
  const newer = await f.product({
    categoryId: other.id,
    isPopular: true,
    publishedAt: new Date('2098-01-01'),
  });
  let data = (await f.get().expect(200)).body.data;
  assert.equal(data.label, 'POPULAR');
  assert.deepEqual(
    data.products.slice(0, 2).map(({ id }) => id),
    [newer.id, older.id],
  );
  assert.ok(
    data.products.every(
      (product) =>
        product.id !== bought.id && product.availability.canAddToCart,
    ),
  );
  // Buy every current curated popular source. No seed rows are mutated.
  const popular = await f.prisma.product.findMany({
    where: { isPopular: true },
  });
  await f.order(popular.map((product) => ({ product, quantity: 1 })));
  // All remaining products in represented categories are now bought or zero-stock.
  const represented = new Set(popular.map((product) => product.categoryId));
  const otherCandidates = await f.prisma.product.findMany({
    where: { categoryId: { in: [...represented] }, isPopular: false },
  });
  if (otherCandidates.length)
    await f.order(otherCandidates.map((product) => ({ product, quantity: 1 })));
  data = (await f.get().expect(200)).body.data;
  assert.deepEqual(data, { label: 'POPULAR', products: [] });
});

test('history, taxonomy and catalog eligibility share a consistent PostgreSQL snapshot', async (t) => {
  const f = await fixture(t);
  const bought = await f.product();
  const candidate = await f.product();
  await f.order([{ product: bought, quantity: 1 }]);
  const expected = (await f.get().expect(200)).body;
  let changed = false;
  const db = new Proxy(f.prisma, {
    get(target, field) {
      if (field !== '$transaction') return target[field];
      return (callback, options) =>
        f.prisma.$transaction(
          (tx) =>
            callback(
              new Proxy(tx, {
                get(transaction, key) {
                  if (key !== '$queryRaw') return transaction[key];
                  return async (...args) => {
                    const rows = await tx.$queryRaw(...args);
                    if (!changed) {
                      changed = true;
                      await f.prisma.inventory.update({
                        where: { productId: candidate.id },
                        data: { quantityOnHand: 0 },
                      });
                    }
                    return rows;
                  };
                },
              }),
            ),
          options,
        );
    },
  });
  assert.deepEqual(
    (await f.get({}, 0, f.makeApp(db)).expect(200)).body,
    expected,
  );
  const refreshed = (await f.get().expect(200)).body.data;
  assert.equal(refreshed.label, 'POPULAR');
  assert.ok(!refreshed.products.some(({ id }) => id === candidate.id));
});
