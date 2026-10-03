import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import test from 'node:test';
import request from 'supertest';
import { myItemsResponseSchema } from '@marthub/contracts';
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
      .get('/api/v1/users/me/items')
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

test('My Items is Customer-only, no-store, empty without writes, and strictly validates query ownership inputs', async (t) => {
  const f = await fixture(t);
  const before = await f.prisma.order.count({
    where: { userId: f.users[0].id },
  });
  const guest = await request(f.app).get('/api/v1/users/me/items').expect(401);
  assert.match(guest.headers['cache-control'], /no-store/);
  await f.get({}, 2).expect(403);
  assert.deepEqual((await f.get().expect(200)).body, {
    data: [],
    meta: { page: 1, perPage: 20, totalItems: 0, totalPages: 0 },
  });
  const p = await f.product();
  await f.order([{ product: p, quantity: 8 }], { userId: f.users[1].id });
  assert.equal((await f.get().expect(200)).body.data.length, 0);
  for (const query of [
    { userId: f.users[1].id },
    { status: 'DELIVERED' },
    { perPage: '51' },
    { page: '0' },
    { sort: 'newest' },
    { page: ['1', '2'] },
    { page: '2147483649', perPage: '2' },
  ])
    await f.get(query).expect(422);
  await f.get().query('page=1&page=2').expect(422);
  assert.equal(
    await f.prisma.order.count({ where: { userId: f.users[0].id } }),
    before,
  );
  await f.prisma.user.update({
    where: { id: f.users[0].id },
    data: { role: 'ADMIN' },
  });
  await f.get().expect(403);
});

test('My Items sums only owned delivered quantities, selects history recency and deterministic source snapshots', async (t) => {
  const f = await fixture(t);
  const a = await f.product(),
    b = await f.product();
  const older = await f.order(
    [
      { product: a, quantity: 2 },
      { product: b, quantity: 12 },
    ],
    { delivered: '2022-01-01T00:00:00.000Z' },
  );
  const sources = [];
  for (const [quantity, name] of [
    [3, 'Tied source one'],
    [4, 'Tied source two'],
  ])
    sources.push(
      await f.order([{ product: a, quantity }], {
        name,
        delivered: '2022-02-01T00:00:00.000Z',
      }),
    );
  await f.order([{ product: a, quantity: 99 }], { userId: f.users[1].id });
  for (const status of [
    'PENDING',
    'CONFIRMED',
    'PACKING',
    'SHIPPING',
    'CANCELLED',
  ])
    await f.order([{ product: a, quantity: 50 }], { status });
  const winning = sources.sort((x, y) => y.id.localeCompare(x.id))[0];
  const result = await f.get().expect(200);
  myItemsResponseSchema.parse(result.body);
  const entries = result.body.data;
  assert.deepEqual(
    entries.map((e) => e.productId),
    [a.id, b.id],
  );
  assert.equal(entries[0].purchaseCount, 9);
  assert.equal(entries[1].purchaseCount, 12);
  assert.equal(entries[0].lastPurchasedAt, '2022-02-01T00:00:00.000Z');
  assert.equal(entries[0].orderId, winning.id);
  const snapshot = await f.prisma.orderItem.findFirst({
    where: { orderId: winning.id },
  });
  assert.deepEqual(entries[0].snapshot, {
    sku: snapshot.sku,
    productName: snapshot.productName,
    imageUrl: snapshot.imageUrl,
    sellingUnit: snapshot.sellingUnit,
  });
  assert.equal(entries[1].orderId, older.id);
  assert.equal(entries[0].currentProduct.name, 'Current catalog');
  assert.equal(entries[0].currentPrice, price.toString());
  assert.equal(entries[0].availability, 'IN_STOCK');
  assert.deepEqual(
    (await f.get({ sort: 'frequent' }).expect(200)).body.data.map(
      (e) => e.productId,
    ),
    [b.id, a.id],
  );
  assert.deepEqual(
    Object.keys(entries[0]).sort(),
    [
      'productId',
      'purchaseCount',
      'lastPurchasedAt',
      'orderId',
      'snapshot',
      'currentProduct',
      'currentPrice',
      'availability',
    ].sort(),
  );
  assert.ok(!JSON.stringify(result.body).includes('Private recipient'));
  assert.ok(!JSON.stringify(result.body).includes('private fingerprint'));
});

test('frequent sort breaks equal quantity counts by delivery recency before product ID', async (t) => {
  const f = await fixture(t);
  const pair = [await f.product(), await f.product()].sort((a, b) =>
    a.id.localeCompare(b.id),
  );
  await f.order([{ product: pair[0], quantity: 5 }], {
    delivered: '2022-01-01T00:00:00.000Z',
  });
  await f.order([{ product: pair[1], quantity: 5 }], {
    delivered: '2022-02-01T00:00:00.000Z',
  });
  const result = await f.get({ sort: 'frequent' }).expect(200);
  assert.deepEqual(
    result.body.data.map((entry) => entry.productId),
    [pair[1].id, pair[0].id],
  );
  assert.deepEqual(
    result.body.data.map((entry) => entry.purchaseCount),
    [5, 5],
  );
});

test('My Items paginates deduplicated products with stable recent/frequent ties and accurate empty-page counts', async (t) => {
  const f = await fixture(t);
  for (let i = 0; i < 23; i++) {
    const p = await f.product();
    await f.order([{ product: p, quantity: (i % 3) + 1 }]);
    await f.order([{ product: p, quantity: (i % 3) + 1 }]);
  }
  assert.equal((await f.get().expect(200)).body.data.length, 20);
  for (const sort of ['recent', 'frequent']) {
    const expected = f.products
      .map((p, i) => ({ id: p.id, count: 2 * ((i % 3) + 1) }))
      .sort(
        (a, b) =>
          (sort === 'frequent' ? b.count - a.count : 0) ||
          a.id.localeCompare(b.id),
      );
    const actual = [];
    for (let page = 1; page <= 5; page++) {
      const result = await f
        .get({ page: String(page), perPage: '5', sort })
        .expect(200);
      assert.deepEqual(result.body.meta, {
        page,
        perPage: 5,
        totalItems: 23,
        totalPages: 5,
      });
      actual.push(...result.body.data.map((e) => e.productId));
    }
    assert.deepEqual(
      actual,
      expected.map((p) => p.id),
    );
    assert.equal(new Set(actual).size, 23);
  }
  const beyond = await f.get({ page: '99', perPage: '50' }).expect(200);
  assert.deepEqual(beyond.body, {
    data: [],
    meta: { page: 99, perPage: 50, totalItems: 23, totalPages: 1 },
  });
});

test('current price/stock refresh while archived, hidden, missing-price and hidden-category products retain historical identity without leaks', async (t) => {
  const f = await fixture(t);
  const publicProduct = await f.product();
  const archived = await f.product(),
    hidden = await f.product();
  await f.product({
    prices: { create: { price, startsAt: new Date('2099-01-01') } },
  });
  const parent = await f.prisma.category.create({
    data: { name: 'Hidden ancestor', slug: `ancestor-${randomUUID()}` },
  });
  const child = await f.prisma.category.create({
    data: {
      name: 'Visible child',
      slug: `child-${randomUUID()}`,
      parentId: parent.id,
    },
  });
  await f.product({ categoryId: child.id });
  await f.order(f.products.map((p) => ({ product: p, quantity: 3 })));
  const original = (await f.get().expect(200)).body.data;
  await f.prisma.$transaction(async (tx) => {
    await tx.productPriceHistory.updateMany({
      where: { productId: publicProduct.id, endsAt: null },
      data: { endsAt: new Date('2021-01-01') },
    });
    await tx.productPriceHistory.create({
      data: {
        productId: publicProduct.id,
        price: price + 100n,
        compareAtPrice: price + 200n,
        startsAt: new Date('2021-01-01'),
        createdByUserId: f.users[2].id,
      },
    });
  });
  await f.prisma.inventory.update({
    where: { productId: publicProduct.id },
    data: { quantityOnHand: 0 },
  });
  await f.prisma.product.update({
    where: { id: publicProduct.id },
    data: { name: 'Updated public name' },
  });
  await f.prisma.product.update({
    where: { id: archived.id },
    data: {
      name: 'SECRET ARCHIVED NAME',
      status: 'ARCHIVED',
      archivedAt: new Date(),
    },
  });
  await f.prisma.product.update({
    where: { id: hidden.id },
    data: { name: 'SECRET DRAFT NAME', status: 'DRAFT' },
  });
  await f.prisma.category.update({
    where: { id: parent.id },
    data: { status: 'ARCHIVED', archivedAt: new Date() },
  });
  const response = await f.get().expect(200);
  myItemsResponseSchema.parse(response.body);
  assert.equal(response.body.meta.totalItems, 5);
  for (const entry of response.body.data) {
    const before = original.find((e) => e.productId === entry.productId);
    for (const field of [
      'snapshot',
      'purchaseCount',
      'lastPurchasedAt',
      'orderId',
    ])
      assert.deepEqual(entry[field], before[field]);
    if (entry.productId === publicProduct.id) {
      assert.equal(entry.currentProduct.name, 'Updated public name');
      assert.equal(entry.currentPrice, (price + 100n).toString());
      assert.equal(
        entry.currentProduct.compareAtPrice,
        (price + 200n).toString(),
      );
      assert.equal(entry.availability, 'OUT_OF_STOCK');
      assert.equal(entry.currentProduct.availability.canAddToCart, false);
    } else {
      assert.equal(entry.availability, 'UNAVAILABLE');
      assert.equal(entry.currentProduct, null);
      assert.equal(entry.currentPrice, null);
    }
  }
  assert.ok(!JSON.stringify(response.body).includes('SECRET'));
});

test('aggregation, snapshot count and current catalog projection share one consistent read transaction', async (t) => {
  const f = await fixture(t);
  const p = await f.product();
  await f.order([{ product: p, quantity: 2 }]);
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
                        where: { productId: p.id },
                        data: { quantityOnHand: 0 },
                      });
                      const extra = await f.product();
                      await f.order([{ product: extra, quantity: 8 }]);
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
  const refreshed = await f.get().expect(200);
  assert.equal(refreshed.body.meta.totalItems, 2);
  assert.equal(
    refreshed.body.data.find((e) => e.productId === p.id).availability,
    'OUT_OF_STOCK',
  );
});
