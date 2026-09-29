import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import test from 'node:test';
import request from 'supertest';
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
const bearer = (token) => 'Bearer ' + token;

async function setup(t) {
  const database = createDatabase(
    validateDatabaseUrl(process.env.DATABASE_URL),
  );
  const { prisma } = database;
  const suffix = randomUUID();
  const users = await Promise.all(
    ['CUSTOMER', 'ADMIN'].map((role) =>
      prisma.user.create({
        data: {
          email:
            'product-' + role.toLowerCase() + '-' + suffix + '@example.test',
          passwordHash: 'unused-test-hash',
          firstName: role === 'ADMIN' ? 'Admin' : 'Customer',
          lastName: 'Product',
          role,
        },
      }),
    ),
  );
  const [customerSession, adminSession] = await Promise.all(
    users.map((user) =>
      createSessionService({ prisma, config }).issue(user.id),
    ),
  );
  const category = await prisma.category.create({
    data: { name: 'Product test', slug: 'product-test-' + suffix },
  });
  const archivedCategory = await prisma.category.create({
    data: {
      name: 'Archived product test',
      slug: 'archived-product-test-' + suffix,
      status: 'ARCHIVED',
      archivedAt: new Date(),
    },
  });
  const app = createApp({
    prisma,
    authConfig: config,
    origin: config.origin,
    logger: () => {},
  });

  t.after(async () => {
    const products = await prisma.product.findMany({
      where: {
        OR: [{ categoryId: category.id }, { categoryId: archivedCategory.id }],
      },
      select: { id: true },
    });
    const ids = products.map(({ id }) => id);
    if (ids.length) {
      await prisma.productPriceHistory.deleteMany({
        where: { productId: { in: ids } },
      });
      await prisma.inventory.deleteMany({ where: { productId: { in: ids } } });
      await prisma.product.deleteMany({ where: { id: { in: ids } } });
    }
    await prisma.category.deleteMany({
      where: { id: { in: [category.id, archivedCategory.id] } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: users.map(({ id }) => id) } },
    });
    await database.close();
  });

  return {
    app,
    prisma,
    suffix,
    category,
    archivedCategory,
    customerToken: customerSession.data.accessToken,
    adminToken: adminSession.data.accessToken,
    admin: users[1],
  };
}

function input(categoryId, suffix, changes = {}) {
  return {
    categoryId,
    sku: 'M43-' + suffix.toUpperCase(),
    slug: 'managed-product-' + suffix,
    name: 'Managed product',
    shortDescription: 'Admin managed catalog item.',
    description: 'A focused product record for management verification.',
    brand: 'MartHub Studio',
    sellingUnit: 'each',
    isFeatured: false,
    isNew: true,
    isPopular: false,
    price: '349000',
    compareAtPrice: '399000',
    ...changes,
  };
}

function createProduct(app, token, body) {
  return request(app)
    .post('/api/v1/admin/products')
    .set('Authorization', bearer(token))
    .send(body);
}

test('admin product create enforces RBAC, active category, exact price, and conflicts', async (t) => {
  const {
    app,
    prisma,
    suffix,
    category,
    archivedCategory,
    customerToken,
    adminToken,
    admin,
  } = await setup(t);
  await request(app).get('/api/v1/admin/products').expect(401);
  await request(app)
    .get('/api/v1/admin/products')
    .set('Authorization', bearer(customerToken))
    .expect(403);

  const created = await createProduct(
    app,
    adminToken,
    input(category.id, suffix),
  ).expect(201);
  assert.equal(created.body.data.status, 'DRAFT');
  assert.equal(created.body.data.price, '349000');
  assert.equal(created.body.data.compareAtPrice, '399000');
  assert.equal(created.body.data.quantityOnHand, 0);
  assert.equal(created.body.data.category.id, category.id);
  assert.match(created.headers['cache-control'], /no-store/);

  const persisted = await prisma.product.findUniqueOrThrow({
    where: { id: created.body.data.id },
    include: { prices: true, inventory: true },
  });
  assert.equal(persisted.prices[0].price, 349000n);
  assert.equal(persisted.prices[0].createdByUserId, admin.id);
  assert.equal(persisted.inventory.quantityOnHand, 0);

  const skuConflict = await createProduct(
    app,
    adminToken,
    input(category.id, randomUUID(), { sku: created.body.data.sku }),
  ).expect(409);
  assert.equal(skuConflict.body.error.code, 'SKU_CONFLICT');
  const slugConflict = await createProduct(
    app,
    adminToken,
    input(category.id, randomUUID(), { slug: created.body.data.slug }),
  ).expect(409);
  assert.equal(slugConflict.body.error.code, 'SLUG_CONFLICT');

  await createProduct(
    app,
    adminToken,
    input(archivedCategory.id, randomUUID()),
  ).expect(422);
  await createProduct(
    app,
    adminToken,
    input(category.id, randomUUID(), { price: '0' }),
  ).expect(422);
  await createProduct(
    app,
    adminToken,
    input(category.id, randomUUID(), { status: 'ACTIVE' }),
  ).expect(422);
});

test('admin product edit and list preserve stable identity and validate status fields', async (t) => {
  const { app, suffix, category, adminToken } = await setup(t);
  const created = (
    await createProduct(app, adminToken, input(category.id, suffix)).expect(201)
  ).body.data;

  await request(app)
    .patch('/api/v1/admin/products/' + created.id)
    .set('Authorization', bearer(adminToken))
    .send({ name: 'Updated product', brand: null, isPopular: true })
    .expect(200)
    .expect(({ body }) => {
      assert.equal(body.data.name, 'Updated product');
      assert.equal(body.data.brand, null);
      assert.equal(body.data.isPopular, true);
      assert.equal(body.data.sku, created.sku);
      assert.equal(body.data.price, '349000');
    });

  for (const invalid of [
    { sku: 'M43-CHANGED' },
    { slug: 'changed' },
    { price: '1' },
    { status: 'ACTIVE' },
  ])
    await request(app)
      .patch('/api/v1/admin/products/' + created.id)
      .set('Authorization', bearer(adminToken))
      .send(invalid)
      .expect(422);

  const list = await request(app)
    .get('/api/v1/admin/products')
    .query({
      q: created.sku,
      status: 'DRAFT',
      categoryId: category.id,
      page: 1,
      perPage: 1,
    })
    .set('Authorization', bearer(adminToken))
    .expect(200);
  assert.equal(list.body.data.length, 1);
  assert.equal(list.body.data[0].id, created.id);
  assert.deepEqual(list.body.meta, {
    page: 1,
    perPage: 1,
    totalItems: 1,
    totalPages: 1,
  });
  await request(app)
    .get('/api/v1/admin/products?unknown=true')
    .set('Authorization', bearer(adminToken))
    .expect(422);
});

test('publish and archive enforce product status and public visibility', async (t) => {
  const { app, suffix, category, archivedCategory, adminToken } =
    await setup(t);
  const created = (
    await createProduct(app, adminToken, input(category.id, suffix)).expect(201)
  ).body.data;
  await request(app)
    .get('/api/v1/products/' + created.slug)
    .expect(404);

  const published = await request(app)
    .post('/api/v1/admin/products/' + created.id + '/publish')
    .set('Authorization', bearer(adminToken))
    .expect(200);
  assert.equal(published.body.data.status, 'ACTIVE');
  assert.ok(published.body.data.publishedAt);
  const publicProduct = await request(app)
    .get('/api/v1/products/' + created.slug)
    .expect(200);
  assert.equal(publicProduct.body.data.price, '349000');

  await request(app)
    .patch('/api/v1/admin/products/' + created.id)
    .set('Authorization', bearer(adminToken))
    .send({ categoryId: archivedCategory.id })
    .expect(422);

  const archived = await request(app)
    .post('/api/v1/admin/products/' + created.id + '/archive')
    .set('Authorization', bearer(adminToken))
    .expect(200);
  assert.equal(archived.body.data.status, 'ARCHIVED');
  assert.ok(archived.body.data.archivedAt);
  await request(app)
    .get('/api/v1/products/' + created.slug)
    .expect(404);
  await request(app)
    .post('/api/v1/admin/products/' + created.id + '/archive')
    .set('Authorization', bearer(adminToken))
    .expect(200);
  await request(app)
    .patch('/api/v1/admin/products/' + created.id)
    .set('Authorization', bearer(adminToken))
    .send({ name: 'Cannot change' })
    .expect(409);
  await request(app)
    .post('/api/v1/admin/products/' + created.id + '/publish')
    .set('Authorization', bearer(adminToken))
    .expect(409);
});
