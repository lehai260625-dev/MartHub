import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import test from 'node:test';
import request from 'supertest';
import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  statisticsOverviewResponseSchema,
  statisticsTopProductsResponseSchema,
  statisticsLowStockResponseSchema,
} from '@marthub/contracts';
import { createDatabase } from '../../src/db/client.js';
import { validateDatabaseUrl } from '../../src/config/env.js';
import { createApp } from '../../src/app.js';
import { readAuthConfig } from '../../src/config/auth.js';
import { createSessionService } from '../../src/modules/auth/sessions.js';
import {
  createAdminStatisticsService,
  overviewSql,
  topProductsSql,
  lowStockSql,
} from '../../src/modules/admin/statistics.js';

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
  const customer = await prisma.user.create({
    data: {
      email: `stats-c-${suffix}@example.test`,
      passwordHash: 'private',
      firstName: 'Private',
      lastName: 'Customer',
    },
  });
  const admin = await prisma.user.create({
    data: {
      email: `stats-a-${suffix}@example.test`,
      passwordHash: 'private',
      firstName: 'Private',
      lastName: 'Admin',
      role: 'ADMIN',
    },
  });
  const category = await prisma.category.create({
    data: { name: 'Stats category', slug: `stats-${suffix}` },
  });
  const product = async (overrides = {}) =>
    prisma.product.create({
      data: {
        categoryId: category.id,
        sku: randomUUID(),
        slug: `stats-${randomUUID()}`,
        name: 'Current catalog name',
        sellingUnit: 'each',
        ...overrides,
      },
    });
  const p = await product();
  const orderData = (overrides = {}) => ({
    id: randomUUID(),
    orderNumber: `MH-${randomUUID()}`,
    userId: customer.id,
    idempotencyKey: randomUUID(),
    requestFingerprint: 'private',
    subtotal: 100n,
    shippingFee: 30n,
    discountTotal: 0n,
    total: 130n,
    recipientName: 'private',
    recipientPhone: 'private',
    addressLine1: 'private',
    ward: 'private',
    district: 'private',
    province: 'private',
    status: 'DELIVERED',
    deliveredAt: new Date('1998-01-01T17:00:00Z'),
    createdAt: new Date('1997-01-01T00:00:00Z'),
    ...overrides,
  });
  const order = (
    overrides = {},
    items = [{ productId: p.id, quantity: 1, unitPrice: 100n }],
  ) =>
    prisma.order.create({
      data: {
        ...orderData(overrides),
        items: {
          create: items.map((i) => ({
            sku: 'HISTORICAL',
            productName: 'Historical name',
            imageUrl: null,
            sellingUnit: 'box',
            lineTotal: i.unitPrice * BigInt(i.quantity),
            ...i,
          })),
        },
      },
    });
  const sessions = createSessionService({ prisma, config });
  const adminToken = (await sessions.issue(admin.id)).data.accessToken;
  const customerToken = (await sessions.issue(customer.id)).data.accessToken;
  const app = createApp({
    prisma,
    authConfig: config,
    origin: config.origin,
    logger: () => {},
  });
  const get = (path, token = adminToken) =>
    request(app)
      .get('/api/v1/admin/statistics/' + path)
      .set('Authorization', `Bearer ${token}`);
  return {
    prisma,
    suffix,
    customer,
    admin,
    category,
    p,
    product,
    orderData,
    order,
    get,
    app,
    customerToken,
  };
}
const zeros = {
  PENDING: '0',
  CONFIRMED: '0',
  PACKING: '0',
  SHIPPING: '0',
  DELIVERED: '0',
  CANCELLED: '0',
};

test('Statistics endpoints are Admin-only, no-store, safe and read-only with exact empty responses', async (t) => {
  const f = await fixture(t);
  const auditBefore = await f.prisma.adminAuditLog.count();
  for (const [path, schema] of [
    [
      'overview?from=1901-01-01&to=1901-01-01',
      statisticsOverviewResponseSchema,
    ],
    [
      'top-products?from=1901-01-01&to=1901-01-01',
      statisticsTopProductsResponseSchema,
    ],
    ['low-stock?threshold=0', statisticsLowStockResponseSchema],
  ]) {
    await request(f.app)
      .get('/api/v1/admin/statistics/' + path)
      .expect(401);
    await f.get(path, f.customerToken).expect(403);
    const response = await f.get(path).expect(200);
    assert.match(response.headers['cache-control'], /no-store/);
    assert.ok(schema.safeParse(response.body).success);
    for (const field of [
      'userId',
      'email',
      'passwordHash',
      'requestFingerprint',
      'idempotencyKey',
      'recipientName',
      'InventoryMovement',
      'actorUserId',
    ])
      assert.equal(
        JSON.stringify(response.body).includes('"' + field + '"'),
        false,
      );
    if (path.startsWith('overview'))
      assert.deepEqual(
        { ...response.body.data, range: undefined },
        {
          range: undefined,
          revenue: '0',
          deliveredOrderCount: '0',
          unitsSold: '0',
          createdOrderCount: '0',
          statusCounts: zeros,
        },
      );
    if (path.startsWith('top-products')) {
      assert.deepEqual(response.body.data.items, []);
      assert.equal(response.body.data.totalProducts, '0');
    }
  }
  assert.equal(await f.prisma.adminAuditLog.count(), auditBefore);
});

test('Sales use deliveredAt half-open Vietnam boundaries and immutable totals; created/status counts are a separate population', async (t) => {
  const f = await fixture(t);
  const start = '1998-01-01T17:00:00.000Z',
    end = '1998-01-02T17:00:00.000Z';
  const exact = 9007199254740993n;
  const secondProduct = await f.product();
  await f.order(
    {
      deliveredAt: new Date(start),
      subtotal: exact * 2n,
      total: exact * 2n + 30n,
      createdAt: new Date('1998-01-01T16:59:59.999Z'),
    },
    [
      { productId: f.p.id, quantity: 1, unitPrice: exact },
      { productId: secondProduct.id, quantity: 1, unitPrice: exact },
    ],
  );
  await f.order({
    deliveredAt: new Date('1998-01-02T16:59:59.999Z'),
    createdAt: new Date(start),
  });
  await f.order({ deliveredAt: new Date(end), createdAt: new Date(end) });
  await f.order({
    deliveredAt: new Date('1998-01-01T16:59:59.999Z'),
    createdAt: new Date('1998-01-02T16:59:59.999Z'),
  });
  for (const status of [
    'PENDING',
    'CONFIRMED',
    'PACKING',
    'SHIPPING',
    'CANCELLED',
  ])
    await f.order({
      status,
      createdAt: new Date(start),
      deliveredAt: new Date(start),
    });
  // A DELIVERED row without authoritative deliveredAt is not inferred from history/creation.
  await f.order({ deliveredAt: null });
  const response = (
    await f.get('overview?from=1998-01-02&to=1998-01-02').expect(200)
  ).body.data;
  assert.deepEqual(response.range, {
    from: '1998-01-02',
    to: '1998-01-02',
    timezone: 'Asia/Ho_Chi_Minh',
    startInclusive: start,
    endExclusive: end,
  });
  assert.equal(response.revenue, (exact * 2n + 160n).toString());
  assert.equal(response.deliveredOrderCount, '2');
  assert.equal(response.unitsSold, '3');
  assert.equal(response.createdOrderCount, '7');
  assert.deepEqual(response.statusCounts, {
    PENDING: '1',
    CONFIRMED: '1',
    PACKING: '1',
    SHIPPING: '1',
    DELIVERED: '2',
    CANCELLED: '1',
  });
});

test('DB calendar default is 30 inclusive days, max span is 366; invalid/repeated/future inputs are 422', async (t) => {
  const f = await fixture(t);
  const [clock] = await f.prisma
    .$queryRaw`SELECT to_char((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,'YYYY-MM-DD') AS today,
    to_char((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Ho_Chi_Minh')::date-29,'YYYY-MM-DD') AS first,
    to_char((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Ho_Chi_Minh')::date+1,'YYYY-MM-DD') AS future`;
  for (const path of ['overview', 'top-products']) {
    const data = (await f.get(path).expect(200)).body.data;
    assert.equal(data.range.to, clock.today);
    assert.equal(data.range.from, clock.first);
    assert.equal(
      Date.parse(data.range.endExclusive) -
        Date.parse(data.range.startInclusive),
      30 * 86400000,
    );
    assert.deepEqual(
      (await f.get(path + '?timezone=Asia%2FHo_Chi_Minh').expect(200)).body.data
        .range,
      data.range,
    );
    await f.get(path + '?from=2024-01-01&to=2024-12-31').expect(200);
    for (const query of [
      'from=2024-01-01',
      'to=2024-01-01',
      'from=2024-01-02&to=2024-01-01',
      'from=2024-01-01&to=2025-01-01',
      'from=2023-02-29&to=2023-03-01',
      'from=2024-13-01&to=2024-13-01',
      'from=0000-01-01&to=0000-01-01',
      `from=${clock.future}&to=${clock.future}`,
      'timezone=UTC',
      'timezone=Asia/Ho_Chi_Minh&timezone=Asia/Ho_Chi_Minh',
      'from=2024-01-01&from=2024-01-02&to=2024-01-02',
      'preset=month',
      'page=1',
    ])
      await f.get(path + '?' + query).expect(422);
  }
  for (const query of [
    'threshold=-1',
    'threshold=1001',
    'threshold=1.5',
    'threshold=0&threshold=5',
    'limit=0',
    'limit=51',
    'limit=2&limit=3',
    'from=2024-01-01',
    'timezone=Asia/Ho_Chi_Minh',
  ])
    await f.get('low-stock?' + query).expect(422);
  for (const query of [
    'limit=0',
    'limit=51',
    'limit=1.5',
    'limit=2&limit=3',
    'threshold=5',
  ])
    await f.get('top-products?' + query).expect(422);
});

test('Top-products sum exact quantities/revenue, rank all ties and choose latest immutable delivered snapshot despite archived catalog', async (t) => {
  const f = await fixture(t);
  const products = await Promise.all([f.product(), f.product(), f.product()]);
  const [a, b, c] = products.sort((a, b) => a.id.localeCompare(b.id));
  const when = new Date('1999-01-01T18:00:00Z');
  const [oldId, newId, olderId] = [
    randomUUID(),
    randomUUID(),
    randomUUID(),
  ].sort();
  await f.order({ id: oldId, deliveredAt: when, subtotal: 200n, total: 230n }, [
    {
      productId: a.id,
      quantity: 2,
      unitPrice: 100n,
      sku: 'Old',
      productName: 'Old identity',
    },
  ]);
  // A higher order ID with an older delivery cannot beat a newer delivery.
  await f.order(
    { id: olderId, deliveredAt: new Date('1999-01-01T17:59:00Z') },
    [
      {
        productId: a.id,
        quantity: 1,
        unitPrice: 100n,
        productName: 'Older delivery, higher ID',
      },
    ],
  );
  const newer = await f.order(
    { id: newId, deliveredAt: when, subtotal: 200n, total: 230n },
    [
      {
        productId: a.id,
        quantity: 2,
        unitPrice: 100n,
        sku: 'Latest tie',
        productName: 'Latest snapshot',
        imageUrl: 'https://example.test/historical.webp',
        sellingUnit: 'bag',
      },
    ],
  );
  await f.order({ deliveredAt: when, subtotal: 500n, total: 530n }, [
    { productId: b.id, quantity: 5, unitPrice: 100n },
  ]);
  await f.order({ deliveredAt: when, subtotal: 600n, total: 630n }, [
    { productId: c.id, quantity: 5, unitPrice: 120n },
  ]);
  await f.order(
    {
      deliveredAt: new Date('1999-01-01T17:30:00Z'),
      subtotal: 100n,
      total: 130n,
    },
    [{ productId: f.p.id, quantity: 1, unitPrice: 100n }],
  );
  // Ineligible later snapshot must not replace identification or contribute sales.
  await f.order(
    {
      status: 'CANCELLED',
      deliveredAt: new Date('1999-01-01T20:00:00Z'),
      subtotal: 900n,
      total: 930n,
    },
    [
      {
        productId: a.id,
        quantity: 9,
        unitPrice: 100n,
        productName: 'Cancelled identity',
      },
    ],
  );
  await f.prisma.product.update({
    where: { id: a.id },
    data: {
      status: 'ARCHIVED',
      archivedAt: new Date(),
      name: 'Replaced current name',
    },
  });
  const data = (
    await f
      .get('top-products?from=1999-01-02&to=1999-01-02&limit=2')
      .expect(200)
  ).body.data;
  assert.equal(data.totalProducts, '4');
  assert.equal(data.limit, 2);
  assert.deepEqual(
    data.items.map((r) => r.productId),
    [c.id, a.id],
  );
  assert.deepEqual(data.items[1], {
    productId: a.id,
    sku: 'Latest tie',
    productName: 'Latest snapshot',
    imageUrl: 'https://example.test/historical.webp',
    sellingUnit: 'bag',
    soldQuantity: '5',
    revenue: '500',
  });
  assert.ok(newer.id);
  const all = (
    await f
      .get('top-products?from=1999-01-02&to=1999-01-02&limit=50')
      .expect(200)
  ).body.data;
  assert.deepEqual(
    all.items.map((r) => r.productId),
    [c.id, a.id, b.id, f.p.id],
  );
});

test('Aggregate money can exceed both JS safe integer and BIGINT without rounding', async (t) => {
  const f = await fixture(t);
  const price = 9223372036854775807n;
  for (let i = 0; i < 2; i++)
    await f.order(
      {
        deliveredAt: new Date('2000-01-01T18:00:00Z'),
        subtotal: price,
        shippingFee: 0n,
        total: price,
      },
      [{ productId: f.p.id, quantity: 1, unitPrice: price }],
    );
  const overview = (
    await f.get('overview?from=2000-01-02&to=2000-01-02').expect(200)
  ).body.data;
  assert.equal(overview.revenue, '18446744073709551614');
  const top = (
    await f.get('top-products?from=2000-01-02&to=2000-01-02').expect(200)
  ).body.data;
  assert.equal(top.items[0].revenue, overview.revenue);
  assert.equal(top.items[0].soldQuantity, '2');
});

test('Low-stock uses current public eligibility, price, inclusive threshold/zero, stable ties and pre-limit total', async (t) => {
  const f = await fixture(t);
  const base0 = (await f.get('low-stock?threshold=0&limit=50').expect(200)).body
    .data;
  const base5 = (await f.get('low-stock?threshold=5&limit=50').expect(200)).body
    .data;
  const base1000 = (
    await f.get('low-stock?threshold=1000&limit=50').expect(200)
  ).body.data;
  const current = async (quantity, overrides = {}, priceOptions = {}) => {
    const p = await f.product({
      status: 'ACTIVE',
      name: '000 Statistics tie',
      ...overrides,
    });
    await f.prisma.inventory.create({
      data: { productId: p.id, quantityOnHand: quantity },
    });
    await f.prisma.productPriceHistory.create({
      data: {
        productId: p.id,
        price: 9007199254740993n,
        startsAt: new Date('2020-01-01T00:00:00Z'),
        ...priceOptions,
      },
    });
    return p;
  };
  const p0 = await current(0);
  const tie = await current(0);
  const p5 = await current(5);
  await current(6);
  await current(1000);
  await current(1001);
  await current(0, { status: 'DRAFT' });
  await current(0, { status: 'ARCHIVED', archivedAt: new Date() });
  await current(0, {}, { startsAt: new Date('2099-01-01T00:00:00Z') });
  await current(0, {}, { endsAt: new Date('2020-02-01T00:00:00Z') });
  const missing = await f.product({ status: 'ACTIVE' });
  await f.prisma.inventory.create({
    data: { productId: missing.id, quantityOnHand: 0 },
  });
  const hiddenParent = await f.prisma.category.create({
    data: {
      slug: `hidden-${f.suffix}`,
      name: 'Hidden',
      status: 'ARCHIVED',
      archivedAt: new Date(),
    },
  });
  const child = await f.prisma.category.create({
    data: {
      slug: `child-${f.suffix}`,
      name: 'Child',
      parentId: hiddenParent.id,
    },
  });
  await current(0, { categoryId: child.id });
  await current(0, { categoryId: hiddenParent.id });
  const zeros = (await f.get('low-stock?threshold=0&limit=2').expect(200)).body
    .data;
  assert.equal(
    zeros.totalProducts,
    (BigInt(base0.totalProducts) + 2n).toString(),
  );
  assert.equal(zeros.items.length, 2);
  assert.deepEqual(
    zeros.items.map((r) => r.productId),
    [p0.id, tie.id].sort(),
  );
  assert.deepEqual(zeros.items[0].availability, {
    status: 'OUT_OF_STOCK',
    canAddToCart: false,
  });
  assert.equal(zeros.items[0].currentPrice, '9007199254740993');
  const defaults = (await f.get('low-stock').expect(200)).body.data;
  assert.equal(defaults.threshold, 5);
  assert.equal(defaults.limit, 10);
  assert.equal(
    defaults.totalProducts,
    (BigInt(base5.totalProducts) + 3n).toString(),
  );
  const matching = (await f.get('low-stock?threshold=5&limit=50').expect(200))
    .body.data;
  assert.ok(matching.items.some((p) => p.productId === p5.id));
  const max = (await f.get('low-stock?threshold=1000&limit=50').expect(200))
    .body.data;
  assert.equal(
    max.totalProducts,
    (BigInt(base1000.totalProducts) + 5n).toString(),
  );
});

test('A concurrent delivery after range resolution cannot mix repeatable-read KPI populations', async (t) => {
  const f = await fixture(t);
  const order = await f.order({
    status: 'PENDING',
    deliveredAt: null,
    createdAt: new Date('2002-01-01T18:00:00Z'),
  });
  let changed = false;
  const observed = new Proxy(f.prisma, {
    get(target, key) {
      if (key !== '$transaction') return target[key];
      return (run, options) =>
        target.$transaction(
          (tx) =>
            run(
              new Proxy(tx, {
                get(inner, op) {
                  if (op !== '$queryRaw') return inner[op];
                  return async (...args) => {
                    const result = await inner.$queryRaw(...args);
                    if (!changed) {
                      changed = true;
                      await f.prisma.order.update({
                        where: { id: order.id },
                        data: {
                          status: 'DELIVERED',
                          deliveredAt: new Date('2002-01-01T18:00:00Z'),
                        },
                      });
                    }
                    return result;
                  };
                },
              }),
            ),
          options,
        );
    },
  });
  const service = createAdminStatisticsService({ prisma: observed });
  const query = { from: '2002-01-02', to: '2002-01-02' };
  const consistent = await service.overview(query);
  assert.equal(consistent.deliveredOrderCount, '0');
  assert.equal(consistent.statusCounts.PENDING, '1');
  assert.equal(consistent.statusCounts.DELIVERED, '0');
  const fresh = await createAdminStatisticsService({
    prisma: f.prisma,
  }).overview(query);
  assert.equal(fresh.deliveredOrderCount, '1');
  assert.equal(fresh.statusCounts.PENDING, '0');
  assert.equal(fresh.revenue, '130');
});

test('Empty low-stock population returns zero text count and empty items without persisting fixture changes', async (t) => {
  const f = await fixture(t);
  const rollback = new Error('Rollback temporary fixture');
  let response;
  await assert.rejects(
    f.prisma.$transaction(async (tx) => {
      await tx.inventory.updateMany({ data: { quantityOnHand: 1001 } });
      const service = createAdminStatisticsService({
        prisma: { $transaction: (run) => run(tx) },
      });
      response = await service.lowStock({ threshold: '1000' });
      throw rollback;
    }),
    (error) => error === rollback,
  );
  assert.deepEqual(response, {
    threshold: 1000,
    limit: 10,
    totalProducts: '0',
    items: [],
  });
  assert.ok(
    statisticsLowStockResponseSchema.safeParse({ data: response }).success,
  );
});

test('Representative query plans and SQL counts stay bounded with no application N+1 aggregation', async (t) => {
  const f = await fixture(t);
  const orders = [];
  for (let i = 0; i < 4000; i++)
    orders.push(
      f.orderData({
        deliveredAt: new Date(Date.UTC(1990, 0, 1 + (i % 100), 18)),
        createdAt: new Date(Date.UTC(1990, 0, 1 + (i % 100), 18)),
      }),
    );
  for (let i = 0; i < orders.length; i += 500)
    await f.prisma.order.createMany({ data: orders.slice(i, i + 500) });
  for (let i = 0; i < orders.length; i += 1000)
    await f.prisma.orderItem.createMany({
      data: orders.slice(i, i + 1000).map((o) => ({
        orderId: o.id,
        productId: f.p.id,
        sku: 'History',
        productName: 'Snapshot',
        sellingUnit: 'each',
        quantity: 1,
        unitPrice: 100n,
        lineTotal: 100n,
      })),
    });
  const products = Array.from({ length: 1000 }, (_, i) => ({
    id: randomUUID(),
    categoryId: f.category.id,
    sku: randomUUID(),
    slug: `plan-${randomUUID()}`,
    name: `Plan ${i}`,
    sellingUnit: 'each',
    status: 'ACTIVE',
  }));
  await f.prisma.product.createMany({ data: products });
  await f.prisma.inventory.createMany({
    data: products.map((p, i) => ({
      productId: p.id,
      quantityOnHand: i % 1001,
    })),
  });
  await f.prisma.productPriceHistory.createMany({
    data: products.map((p) => ({
      productId: p.id,
      price: 100n,
      startsAt: new Date('2020-01-01T00:00:00Z'),
    })),
  });
  for (const table of [
    'orders',
    'order_items',
    'products',
    'inventory',
    'categories',
    'product_price_history',
  ])
    await f.prisma.$executeRawUnsafe(`ANALYZE ${table}`);
  const range = {
    startInclusive: '1990-01-01T17:00:00.000Z',
    endExclusive: '1990-01-02T17:00:00.000Z',
  };
  for (const [name, query] of [
    ['overview', overviewSql(range)],
    ['top', topProductsSql(range, 10)],
    ['low', lowStockSql(5, 10)],
  ]) {
    const [row] = await f.prisma.$queryRaw(
      Prisma.sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${query}`,
    );
    const plan = row['QUERY PLAN'][0];
    assert.ok(plan['Execution Time'] >= 0);
    const scans = [];
    const visit = (node) => {
      if (node['Node Type'].includes('Scan'))
        scans.push(
          `${node['Node Type']}:${node['Index Name'] ?? node['Relation Name'] ?? 'CTE'}`,
        );
      for (const child of node.Plans ?? []) visit(child);
    };
    visit(plan.Plan);
    t.diagnostic(
      `${name} representative plan: ${scans.join(', ')}; execution ${plan['Execution Time']}ms`,
    );
    if (name !== 'low')
      assert.ok(
        scans.some((s) => s.includes('orders_delivered_at_idx')),
        JSON.stringify(scans),
      );
    else
      assert.ok(
        scans.some((s) => s.includes('inventory_quantity_on_hand_idx')),
        JSON.stringify(scans),
      );
  }
  const prisma = new PrismaClient({
    adapter: new PrismaPg({
      connectionString: validateDatabaseUrl(process.env.DATABASE_URL),
    }),
    log: [{ emit: 'event', level: 'query' }],
  });
  t.after(() => prisma.$disconnect());
  const sql = [];
  prisma.$on('query', ({ query }) => sql.push(query));
  const service = createAdminStatisticsService({ prisma });
  for (const [method, input, max] of [
    ['overview', { from: '1990-01-02', to: '1990-01-02' }, 5],
    ['topProducts', { from: '1990-01-02', to: '1990-01-02' }, 5],
    ['lowStock', {}, 4],
  ]) {
    sql.length = 0;
    await service[method](input);
    assert.ok(sql.length <= max, `${method} statements ${sql.length}`);
    assert.equal(
      sql.filter(
        (s) => s.startsWith('SELECT') || s.trimStart().startsWith('WITH'),
      ).length,
      method === 'lowStock' ? 1 : 2,
    );
    t.diagnostic(
      `${method}: ${sql.length} SQL statements including transaction control`,
    );
  }
});
