import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
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

test('guest category endpoints expose only active tree branches and safe fields', async (t) => {
  const { app, prisma } = await setup(t);
  const hiddenSlug = `hidden-${randomUUID()}`;
  const parent = await prisma.category.findUniqueOrThrow({
    where: { slug: 'past-seasons' },
  });
  const hidden = await prisma.category.create({
    data: { name: 'Hidden child', slug: hiddenSlug, parentId: parent.id },
  });
  t.after(() => prisma.category.delete({ where: { id: hidden.id } }));
  const list = await request(app).get('/api/v1/categories').expect(200);
  assert.deepEqual(
    list.body.data.map(({ slug }) => slug),
    ['home-living', 'desk-paper', 'on-the-go'],
  );
  assert.deepEqual(
    list.body.data[0].children.map(({ slug }) => slug),
    ['tabletop'],
  );
  assert.equal(JSON.stringify(list.body).includes('past-seasons'), false);
  const detail = await request(app)
    .get('/api/v1/categories/tabletop')
    .expect(200);
  assert.equal(detail.body.data.parent.slug, 'home-living');
  assert.deepEqual(
    Object.keys(detail.body.data).sort(),
    ['id', 'name', 'slug', 'description', 'image', 'children', 'parent'].sort(),
  );
  await request(app).get('/api/v1/categories/past-seasons').expect(404);
  await request(app).get(`/api/v1/categories/${hiddenSlug}`).expect(404);
  await request(app).get('/api/v1/categories?status=ARCHIVED').expect(422);
});

test('guest product endpoints hide inactive records and serialize exact current VND', async (t) => {
  const { app } = await setup(t);
  const list = await request(app).get('/api/v1/products').expect(200);
  assert.equal(list.body.data.length, 8);
  assert.equal(
    list.body.data.some(({ slug }) => slug === 'harbor-felt-organizer'),
    false,
  );
  assert.equal(
    list.body.data.some(({ slug }) => slug === 'season-notes-planner'),
    false,
  );
  const mug = list.body.data.find(({ slug }) => slug === 'cove-stoneware-mug');
  assert.equal(mug.price, '149000');
  assert.equal(mug.compareAtPrice, '179000');
  assert.deepEqual(mug.badges, ['SALE']);
  assert.equal(mug.image, null);
  assert.deepEqual(
    Object.keys(mug).sort(),
    [
      'id',
      'slug',
      'sku',
      'name',
      'shortDescription',
      'image',
      'price',
      'compareAtPrice',
      'currency',
      'sellingUnit',
      'badges',
      'availability',
    ].sort(),
  );
  const pouch = list.body.data.find(({ slug }) => slug === 'pocket-zip-pouch');
  assert.deepEqual(pouch.availability, {
    status: 'OUT_OF_STOCK',
    canAddToCart: false,
  });
  const detail = await request(app)
    .get('/api/v1/products/cove-stoneware-mug')
    .expect(200);
  assert.equal(detail.body.data.category.slug, 'tabletop');
  assert.equal(detail.body.data.description?.length > 0, true);
  assert.deepEqual(detail.body.data.images, []);
  await request(app).get('/api/v1/products/harbor-felt-organizer').expect(404);
  await request(app).get('/api/v1/products/season-notes-planner').expect(404);
  await request(app).get('/api/v1/products?sort=price').expect(422);
});

test('public products need a current price and retain BIGINT precision without exposing stock counts', async (t) => {
  const { app, prisma } = await setup(t);
  const suffix = randomUUID();
  const category = await prisma.category.findUniqueOrThrow({
    where: { slug: 'desk-paper' },
  });
  const precise = await prisma.product.create({
    data: {
      categoryId: category.id,
      sku: `EXACT-${suffix}`,
      slug: `exact-${suffix}`,
      name: 'Exact price fixture',
      sellingUnit: 'each',
      status: 'ACTIVE',
    },
  });
  const unpriced = await prisma.product.create({
    data: {
      categoryId: category.id,
      sku: `NOPRICE-${suffix}`,
      slug: `unpriced-${suffix}`,
      name: 'Unpriced fixture',
      sellingUnit: 'each',
      status: 'ACTIVE',
    },
  });
  t.after(async () => {
    await prisma.productImage.deleteMany({ where: { productId: precise.id } });
    await prisma.productPriceHistory.deleteMany({
      where: { productId: precise.id },
    });
    await prisma.inventory.deleteMany({ where: { productId: precise.id } });
    await prisma.product.deleteMany({
      where: { id: { in: [precise.id, unpriced.id] } },
    });
  });
  await prisma.productPriceHistory.create({
    data: {
      productId: precise.id,
      price: 9007199254740993n,
      startsAt: new Date('2020-01-01T00:00:00Z'),
    },
  });
  await prisma.inventory.create({
    data: { productId: precise.id, quantityOnHand: 7 },
  });
  await prisma.productImage.create({
    data: {
      productId: precise.id,
      cloudinaryPublicId: `test/${suffix}`,
      url: 'https://images.example.test/exact.png',
      altText: 'Exact price fixture',
      width: 100,
      height: 80,
      sortOrder: 0,
      isPrimary: true,
    },
  });
  const list = await request(app).get('/api/v1/products').expect(200);
  assert.equal(
    list.body.data.some(({ slug }) => slug === unpriced.slug),
    false,
  );
  const card = list.body.data.find(({ slug }) => slug === precise.slug);
  assert.equal(card.price, '9007199254740993');
  assert.equal(card.availability.status, 'IN_STOCK');
  assert.equal(JSON.stringify(card).includes('quantityOnHand'), false);
  const detail = await request(app)
    .get(`/api/v1/products/${precise.slug}`)
    .expect(200);
  assert.equal(detail.body.data.price, '9007199254740993');
  assert.equal(detail.body.data.images[0].altText, 'Exact price fixture');
  assert.equal(
    JSON.stringify(detail.body).includes('cloudinaryPublicId'),
    false,
  );
  await prisma.product.update({
    where: { id: precise.id },
    data: { archivedAt: new Date() },
  });
  await request(app).get(`/api/v1/products/${precise.slug}`).expect(404);
  await request(app).get(`/api/v1/products/${unpriced.slug}`).expect(404);
});
