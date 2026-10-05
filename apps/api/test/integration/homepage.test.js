import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
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

const homepage = (app) => request(app).get('/api/v1/homepage');

test('homepage returns bounded cacheable seeded modules with exact public projections', async (t) => {
  const { app } = await setup(t);
  const response = await homepage(app).expect(200);
  assert.equal(
    response.headers['cache-control'],
    'public, max-age=60, s-maxage=300, stale-while-revalidate=600',
  );
  assert.deepEqual(
    response.body.data.promotions.map(({ title }) => title),
    ['Make room for small rituals', 'A calmer workday', 'Carry what matters'],
  );
  assert.deepEqual(
    response.body.data.categories.map(({ slug }) => slug),
    ['home-living', 'desk-paper', 'on-the-go'],
  );
  assert.deepEqual(
    response.body.data.deals.map(({ slug }) => slug),
    ['cove-stoneware-mug'],
  );
  assert.deepEqual(
    response.body.data.newProducts.map(({ slug }) => slug),
    ['folio-dot-notebook', 'loom-canvas-tote'],
  );
  assert.deepEqual(
    response.body.data.popularProducts.map(({ slug }) => slug),
    ['cove-stoneware-mug', 'rill-glass-tumbler'],
  );
  assert.equal(response.body.data.deals[0].price, '149000');
  assert.equal(response.body.data.deals[0].compareAtPrice, '179000');
  assert.equal(JSON.stringify(response.body).includes('imagePublicId'), false);
  assert.equal(JSON.stringify(response.body).includes('quantityOnHand'), false);
  assert.ok(response.body.data.promotions.length <= 8);
  for (const name of ['deals', 'newProducts', 'popularProducts'])
    assert.ok(response.body.data[name].length <= 12);
});

test('homepage promotion scheduling includes only active current non-archived rows', async (t) => {
  const { app, prisma } = await setup(t);
  const [{ now }] = await prisma.$queryRaw`SELECT CURRENT_TIMESTAMP AS now`;
  const records = await Promise.all([
    prisma.promotion.create({
      data: {
        title: 'Visible now',
        internalHref: '/categories',
        placement: 'EDITORIAL',
        status: 'ACTIVE',
        sortOrder: -1,
        startsAt: new Date(now.getTime() - 3_600_000),
        endsAt: new Date(now.getTime() + 3_600_000),
      },
    }),
    prisma.promotion.create({
      data: {
        title: 'Future active',
        internalHref: '/categories',
        placement: 'EDITORIAL',
        status: 'ACTIVE',
        startsAt: new Date(now.getTime() + 3_600_000),
      },
    }),
    prisma.promotion.create({
      data: {
        title: 'Expired active',
        internalHref: '/categories',
        placement: 'EDITORIAL',
        status: 'ACTIVE',
        startsAt: new Date(now.getTime() - 7_200_000),
        endsAt: new Date(now.getTime() - 3_600_000),
      },
    }),
    prisma.promotion.create({
      data: {
        title: 'Archived active',
        internalHref: '/categories',
        placement: 'EDITORIAL',
        status: 'ACTIVE',
        startsAt: new Date(now.getTime() - 3_600_000),
        archivedAt: now,
      },
    }),
  ]);
  t.after(() =>
    prisma.promotion.deleteMany({
      where: { id: { in: records.map(({ id }) => id) } },
    }),
  );
  const response = await homepage(app).expect(200);
  const titles = response.body.data.promotions.map(({ title }) => title);
  assert.equal(titles.includes('Visible now'), true);
  assert.equal(titles.includes('Future active'), false);
  assert.equal(titles.includes('Expired active'), false);
  assert.equal(titles.includes('Archived active'), false);
});

test('homepage collections preserve public visibility, inventory state, and BIGINT precision', async (t) => {
  const { app, prisma } = await setup(t);
  const suffix = randomUUID();
  const category = await prisma.category.create({
    data: {
      name: 'Homepage fixture',
      slug: `homepage-${suffix}`,
      sortOrder: 99,
    },
  });
  const product = await prisma.product.create({
    data: {
      categoryId: category.id,
      name: 'Homepage exact fixture',
      slug: `homepage-exact-${suffix}`,
      sku: `HOME-${suffix}`,
      sellingUnit: 'each',
      status: 'ACTIVE',
      isNew: true,
      isPopular: true,
      publishedAt: new Date(),
    },
  });
  await prisma.productPriceHistory.create({
    data: {
      productId: product.id,
      price: 9007199254740993n,
      compareAtPrice: 9007199254740994n,
      startsAt: new Date('2020-01-01T00:00:00Z'),
    },
  });
  await prisma.inventory.create({
    data: { productId: product.id, quantityOnHand: 0 },
  });
  t.after(async () => {
    await prisma.productPriceHistory.deleteMany({
      where: { productId: product.id },
    });
    await prisma.inventory.deleteMany({ where: { productId: product.id } });
    await prisma.product.delete({ where: { id: product.id } });
    await prisma.category.delete({ where: { id: category.id } });
  });
  const visible = await homepage(app).expect(200);
  assert.ok(visible.body.data.categories.some(({ id }) => id === category.id));
  for (const name of ['deals', 'newProducts', 'popularProducts']) {
    const card = visible.body.data[name].find(({ id }) => id === product.id);
    assert.equal(card.price, '9007199254740993');
    assert.deepEqual(card.availability, {
      status: 'OUT_OF_STOCK',
      canAddToCart: false,
    });
  }
  await prisma.category.update({
    where: { id: category.id },
    data: { status: 'ARCHIVED', archivedAt: new Date() },
  });
  const hidden = await homepage(app).expect(200);
  assert.equal(
    hidden.body.data.categories.some(({ id }) => id === category.id),
    false,
  );
  for (const name of ['deals', 'newProducts', 'popularProducts'])
    assert.equal(
      hidden.body.data[name].some(({ id }) => id === product.id),
      false,
    );
});

test('homepage category shortcuts retain root ordering and exclude archived roots/children', async (t) => {
  const { app, prisma } = await setup(t);
  const suffix = randomUUID();
  const roots = [];
  t.after(async () => {
    await prisma.category.deleteMany({
      where: { parentId: { in: roots.map((r) => r.id) } },
    });
    await prisma.category.deleteMany({
      where: { id: { in: roots.map((r) => r.id) } },
    });
  });
  for (const name of ['Z order fixture', 'A order fixture'])
    roots.push(
      await prisma.category.create({
        data: {
          name,
          slug: `m93-${name[0].toLowerCase()}-${suffix}`,
          status: 'ACTIVE',
          sortOrder: -100,
        },
      }),
    );
  const child = await prisma.category.create({
    data: {
      name: 'Child fixture',
      slug: `m93-child-${suffix}`,
      status: 'ACTIVE',
      parentId: roots[1].id,
    },
  });
  const current = await homepage(app).expect(200);
  assert.deepEqual(
    current.body.data.categories.slice(0, 2).map((r) => r.id),
    [roots[1].id, roots[0].id],
  );
  assert.equal(
    current.body.data.categories.some((r) => r.id === child.id),
    false,
  );
  assert.ok(
    current.body.data.categories[0].children.some((r) => r.id === child.id),
  );
  await prisma.category.update({
    where: { id: child.id },
    data: { status: 'ARCHIVED', archivedAt: new Date() },
  });
  await prisma.category.update({
    where: { id: roots[0].id },
    data: { status: 'ARCHIVED', archivedAt: new Date() },
  });
  const archived = await homepage(app).expect(200);
  assert.equal(
    archived.body.data.categories.some((r) => r.id === roots[0].id),
    false,
  );
  assert.equal(
    archived.body.data.categories
      .find((r) => r.id === roots[1].id)
      .children.some((r) => r.id === child.id),
    false,
  );
  assert.ok(archived.body.data.categories.length <= 8);
});

test('homepage rejects query parameters', async (t) => {
  const { app } = await setup(t);
  const response = await request(app)
    .get('/api/v1/homepage?preview=true')
    .expect(422);
  assert.equal(response.body.error.code, 'VALIDATION_ERROR');
});

test('homepage aggregation has a bounded SQL query count', async (t) => {
  const adapter = new PrismaPg({
    connectionString: validateDatabaseUrl(process.env.DATABASE_URL),
    connectionTimeoutMillis: 3000,
    max: 10,
  });
  const prisma = new PrismaClient({
    adapter,
    log: [{ emit: 'event', level: 'query' }],
  });
  const queries = [];
  prisma.$on('query', ({ query }) => queries.push(query));
  t.after(() => prisma.$disconnect());
  const app = createApp({ prisma, logger: () => {} });
  await homepage(app).expect(200);
  assert.ok(queries.length > 0);
  assert.ok(
    queries.length <= 20,
    `Expected at most 20 SQL statements, received ${queries.length}.`,
  );
});
