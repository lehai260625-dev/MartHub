import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { validateDatabaseUrl } from '../../src/config/env.js';
import { createDatabase } from '../../src/db/client.js';

async function setup(t) {
  const database = createDatabase(
    validateDatabaseUrl(process.env.DATABASE_URL),
  );
  t.after(() => database.close());
  return {
    prisma: database.prisma,
    app: createApp({ prisma: database.prisma, logger: () => {} }),
  };
}

const get = (app, query = '') => request(app).get(`/api/v1/products${query}`);

test('searches name, brand, and SKU with normalized terms and public visibility', async (t) => {
  const { app } = await setup(t);
  for (const [query, slug] of [
    ['?q=stoneware', 'cove-stoneware-mug'],
    ['?q=MHB-DEMO-001', 'cove-stoneware-mug'],
    ['?q=desk%20tray', 'arc-desk-tray'],
    ['?q=%20%20CoVe%20%20mug%20%20', 'cove-stoneware-mug'],
  ]) {
    const response = await get(app, query).expect(200);
    assert.deepEqual(
      response.body.data.map(({ slug: value }) => value),
      [slug],
    );
    assert.equal(response.body.meta.totalItems, 1);
  }
  const brand = await get(app, '?q=MartHub').expect(200);
  assert.equal(brand.body.meta.totalItems, 8);
  assert.equal(
    brand.body.data.some(({ slug }) => slug === 'season-notes-planner'),
    false,
  );
  const scoped = await get(
    app,
    '?q=mug&category=home-living&availability=in-stock',
  ).expect(200);
  assert.deepEqual(
    scoped.body.data.map(({ slug }) => slug),
    ['cove-stoneware-mug'],
  );
});

test('combines category, exact VND price, availability, and curated flags', async (t) => {
  const { app, prisma } = await setup(t);
  assert.equal(
    (await get(app, '?category=tabletop').expect(200)).body.meta.totalItems,
    3,
  );
  assert.equal(
    (await get(app, '?category=home-living').expect(200)).body.meta.totalItems,
    3,
  );
  const range = await get(
    app,
    '?minPrice=100000&maxPrice=150000&availability=in-stock',
  ).expect(200);
  assert.deepEqual(range.body.data.map(({ price }) => price).sort(), [
    '119000',
    '139000',
    '149000',
  ]);
  assert.equal(
    (await get(app, '?featured=true').expect(200)).body.meta.totalItems,
    3,
  );
  assert.equal(
    (await get(app, '?category=home-living&featured=false').expect(200)).body
      .meta.totalItems,
    2,
  );
  assert.equal(
    (await get(app, '?new=true').expect(200)).body.meta.totalItems,
    2,
  );
  assert.equal(
    (await get(app, '?popular=true').expect(200)).body.meta.totalItems,
    2,
  );
  const suffix = randomUUID();
  const category = await prisma.category.findUniqueOrThrow({
    where: { slug: 'desk-paper' },
  });
  const exact = await prisma.product.create({
    data: {
      categoryId: category.id,
      name: 'Exact price query',
      slug: `exact-query-${suffix}`,
      sku: `EXACT-QUERY-${suffix}`,
      sellingUnit: 'each',
      status: 'ACTIVE',
    },
  });
  t.after(async () => {
    await prisma.productPriceHistory.deleteMany({
      where: { productId: exact.id },
    });
    await prisma.product.delete({ where: { id: exact.id } });
  });
  await prisma.productPriceHistory.create({
    data: {
      productId: exact.id,
      price: 9007199254740993n,
      startsAt: new Date('2020-01-01T00:00:00Z'),
    },
  });
  const high = await get(
    app,
    '?minPrice=9007199254740993&maxPrice=9007199254740993',
  ).expect(200);
  assert.deepEqual(
    high.body.data.map(({ price }) => price),
    ['9007199254740993'],
  );
  assert.equal(high.body.data[0].slug, exact.slug);
});

test('sorts and paginates deterministically with bounded metadata', async (t) => {
  const { app } = await setup(t);
  const prices = [];
  const ids = [];
  for (let page = 1; page <= 3; page++) {
    const response = await get(
      app,
      `?category=home-living&sort=price-asc&page=${page}&perPage=1`,
    ).expect(200);
    assert.deepEqual(response.body.meta, {
      page,
      perPage: 1,
      totalItems: 3,
      totalPages: 3,
    });
    prices.push(...response.body.data.map(({ price }) => BigInt(price)));
    ids.push(...response.body.data.map(({ id }) => id));
  }
  assert.deepEqual(
    prices,
    [...prices].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
  );
  assert.equal(new Set(ids).size, 3);
  const repeat = await get(
    app,
    '?category=home-living&sort=price-asc&page=2&perPage=1',
  ).expect(200);
  assert.deepEqual(
    repeat.body.data.map(({ id }) => id),
    ids.slice(1, 2),
  );
  const empty = await get(
    app,
    '?category=home-living&sort=price-asc&page=4&perPage=1',
  ).expect(200);
  assert.deepEqual(empty.body.data, []);
  assert.deepEqual(empty.body.meta, {
    page: 4,
    perPage: 1,
    totalItems: 3,
    totalPages: 3,
  });
  const desc = await get(
    app,
    '?category=home-living&sort=price-desc&perPage=2',
  ).expect(200);
  assert.deepEqual(
    desc.body.data.map(({ price }) => price),
    ['149000', '119000'],
  );
  const popular = await get(
    app,
    '?category=home-living&sort=popular&perPage=2',
  ).expect(200);
  assert.equal(
    popular.body.data.every(({ slug }) =>
      ['cove-stoneware-mug', 'rill-glass-tumbler'].includes(slug),
    ),
    true,
  );
});
test('price ties use product ID as a stable pagination tie breaker', async (t) => {
  const { app, prisma } = await setup(t);
  const suffix = randomUUID();
  const category = await prisma.category.findUniqueOrThrow({
    where: { slug: 'desk-paper' },
  });
  const products = await Promise.all(
    [1, 2].map((number) =>
      prisma.product.create({
        data: {
          categoryId: category.id,
          sku: `TIE-${suffix}-${number}`,
          slug: `tie-${suffix}-${number}`,
          name: `Tie fixture ${number}`,
          sellingUnit: 'each',
          status: 'ACTIVE',
        },
      }),
    ),
  );
  t.after(async () => {
    await prisma.productPriceHistory.deleteMany({
      where: { productId: { in: products.map(({ id }) => id) } },
    });
    await prisma.product.deleteMany({
      where: { id: { in: products.map(({ id }) => id) } },
    });
  });
  await prisma.productPriceHistory.createMany({
    data: products.map(({ id }) => ({
      productId: id,
      price: 150000n,
      startsAt: new Date('2020-01-01T00:00:00Z'),
    })),
  });
  const first = await get(
    app,
    '?minPrice=150000&maxPrice=150000&sort=price-asc&perPage=1&page=1',
  ).expect(200);
  const second = await get(
    app,
    '?minPrice=150000&maxPrice=150000&sort=price-asc&perPage=1&page=2',
  ).expect(200);
  assert.deepEqual(
    [first.body.data[0].id, second.body.data[0].id],
    products.map(({ id }) => id).sort(),
  );
  assert.equal(first.body.meta.totalItems, 2);
  assert.equal(second.body.meta.totalPages, 2);
});
test('rejects unknown, repeated, malformed, excessive, and conflicting query options', async (t) => {
  const { app } = await setup(t);
  for (const query of [
    '?status=ACTIVE',
    '?q=mug&q=tray',
    '?q=m',
    '?q=%25',
    '?q=' + 'a'.repeat(81),
    '?category=Home-Living',
    '?availability=out-of-stock',
    '?featured=1',
    '?sort=price',
    '?sort=relevance',
    '?page=0',
    '?page=01',
    '?page=1001',
    '?perPage=0',
    '?perPage=61',
    '?minPrice=1.5',
    '?maxPrice=9223372036854775808',
    '?minPrice=150000&maxPrice=100000',
  ]) {
    const response = await get(app, query).expect(422);
    assert.equal(response.body.error.code, 'VALIDATION_ERROR', query);
  }
});

test('trigram search indexes are present and eligible in a PostgreSQL query plan', async () => {
  const client = new pg.Client({
    connectionString: validateDatabaseUrl(process.env.DATABASE_URL),
  });
  await client.connect();
  let inTransaction = false;
  try {
    const indexes = await client.query(
      "SELECT indexname FROM pg_indexes WHERE tablename = 'products' AND indexname LIKE 'products_active_%_trgm_idx'",
    );
    assert.deepEqual(indexes.rows.map(({ indexname }) => indexname).sort(), [
      'products_active_brand_trgm_idx',
      'products_active_name_trgm_idx',
      'products_active_sku_trgm_idx',
    ]);
    const category = await client.query(
      "SELECT id FROM categories WHERE slug = 'desk-paper'",
    );
    await client.query('BEGIN');
    inTransaction = true;
    await client.query(
      `INSERT INTO products (id, category_id, sku, name, slug, selling_unit, updated_at)
      SELECT gen_random_uuid(), $1::uuid, 'PLAN-' || $2::text || '-' || n,
        'Plain item ' || n, 'plan-' || $2::text || '-' || n, 'each', CURRENT_TIMESTAMP
      FROM generate_series(1, 1000) n`,
      [category.rows[0].id, randomUUID()],
    );
    await client.query('ANALYZE products');
    const plan = await client.query(
      "EXPLAIN (COSTS OFF) SELECT id FROM products WHERE status = 'ACTIVE' AND archived_at IS NULL AND name ILIKE '%Mug%'",
    );
    assert.match(
      plan.rows.map((row) => row['QUERY PLAN']).join('\n'),
      /products_active_name_trgm_idx/,
    );
  } finally {
    if (inTransaction) await client.query('ROLLBACK');
    await client.end();
  }
});
