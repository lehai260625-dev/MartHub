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
            'category-' + role.toLowerCase() + '-' + suffix + '@example.test',
          passwordHash: 'unused-test-hash',
          firstName: role === 'ADMIN' ? 'Admin' : 'Customer',
          lastName: 'Category',
          role,
        },
      }),
    ),
  );
  const sessions = createSessionService({ prisma, config });
  const [customerSession, adminSession] = await Promise.all(
    users.map((user) => sessions.issue(user.id)),
  );
  const app = createApp({
    prisma,
    authConfig: config,
    origin: config.origin,
    logger: () => {},
  });

  t.after(async () => {
    const categories = await prisma.category.findMany({
      where: { slug: { endsWith: suffix } },
      select: { id: true },
    });
    const categoryIds = categories.map(({ id }) => id);
    const products = await prisma.product.findMany({
      where: { categoryId: { in: categoryIds } },
      select: { id: true },
    });
    const productIds = products.map(({ id }) => id);
    if (productIds.length) {
      await prisma.productPriceHistory.deleteMany({
        where: { productId: { in: productIds } },
      });
      await prisma.inventory.deleteMany({
        where: { productId: { in: productIds } },
      });
      await prisma.product.deleteMany({ where: { id: { in: productIds } } });
    }
    if (categoryIds.length) {
      await prisma.category.updateMany({
        where: { id: { in: categoryIds } },
        data: { parentId: null },
      });
      await prisma.category.deleteMany({
        where: { id: { in: categoryIds } },
      });
    }
    await prisma.user.deleteMany({
      where: { id: { in: users.map(({ id }) => id) } },
    });
    await database.close();
  });

  return {
    app,
    prisma,
    suffix,
    customerToken: customerSession.data.accessToken,
    adminToken: adminSession.data.accessToken,
  };
}

function createCategory(app, token, data) {
  return request(app)
    .post('/api/v1/admin/categories')
    .set('Authorization', bearer(token))
    .send(data);
}

test('admin category API enforces RBAC, strict inputs, and slug conflicts', async (t) => {
  const { app, suffix, customerToken, adminToken } = await setup(t);
  await request(app).get('/api/v1/admin/categories').expect(401);
  await request(app)
    .get('/api/v1/admin/categories')
    .set('Authorization', bearer(customerToken))
    .expect(403);

  const slug = 'admin-root-' + suffix;
  const created = await createCategory(app, adminToken, {
    name: 'Admin root',
    slug,
    description: 'Managed category',
    parentId: null,
    sortOrder: 10,
  }).expect(201);
  assert.equal(created.body.data.slug, slug);
  assert.equal(created.body.data.status, 'ACTIVE');
  assert.match(created.headers['cache-control'], /no-store/);

  const conflict = await createCategory(app, adminToken, {
    name: 'Duplicate',
    slug,
  }).expect(409);
  assert.equal(conflict.body.error.code, 'SLUG_CONFLICT');

  await createCategory(app, adminToken, {
    name: 'Unknown field',
    slug: 'unknown-' + suffix,
    status: 'ARCHIVED',
  }).expect(422);
  await request(app)
    .patch('/api/v1/admin/categories/' + created.body.data.id)
    .set('Authorization', bearer(adminToken))
    .send({ slug: 'changed-' + suffix })
    .expect(422);
  await request(app)
    .get('/api/v1/admin/categories?status=ACTIVE')
    .set('Authorization', bearer(adminToken))
    .expect(422);
});

test('category tree rejects cycles and third levels while preserving stable order', async (t) => {
  const { app, suffix, adminToken } = await setup(t);
  const later = (
    await createCategory(app, adminToken, {
      name: 'Later root',
      slug: 'later-' + suffix,
      sortOrder: 20,
    }).expect(201)
  ).body.data;
  const earlier = (
    await createCategory(app, adminToken, {
      name: 'Earlier root',
      slug: 'earlier-' + suffix,
      sortOrder: 5,
    }).expect(201)
  ).body.data;
  const child = (
    await createCategory(app, adminToken, {
      name: 'Child',
      slug: 'child-' + suffix,
      parentId: later.id,
      sortOrder: 1,
    }).expect(201)
  ).body.data;

  const cycle = await request(app)
    .patch('/api/v1/admin/categories/' + later.id)
    .set('Authorization', bearer(adminToken))
    .send({ parentId: child.id })
    .expect(409);
  assert.equal(cycle.body.error.code, 'CATEGORY_CYCLE');

  const selfCycle = await request(app)
    .patch('/api/v1/admin/categories/' + child.id)
    .set('Authorization', bearer(adminToken))
    .send({ parentId: child.id })
    .expect(409);
  assert.equal(selfCycle.body.error.code, 'CATEGORY_CYCLE');

  const thirdLevel = await createCategory(app, adminToken, {
    name: 'Grandchild',
    slug: 'grandchild-' + suffix,
    parentId: child.id,
  }).expect(422);
  assert.equal(thirdLevel.body.error.code, 'INVALID_CATEGORY_TREE');

  await request(app)
    .patch('/api/v1/admin/categories/' + later.id)
    .set('Authorization', bearer(adminToken))
    .send({ name: 'First root', sortOrder: 1 })
    .expect(200);
  const listed = await request(app)
    .get('/api/v1/admin/categories')
    .set('Authorization', bearer(adminToken))
    .expect(200);
  const roots = listed.body.data.filter(
    (category) =>
      category.parentId === null &&
      [later.id, earlier.id].includes(category.id),
  );
  assert.deepEqual(
    roots.map(({ id }) => id),
    [later.id, earlier.id],
  );
  assert.equal(
    listed.body.data.find(({ id }) => id === child.id).parent.id,
    later.id,
  );
});

test('archiving validates active children and preserves public visibility rules', async (t) => {
  const { app, prisma, suffix, adminToken } = await setup(t);
  const root = (
    await createCategory(app, adminToken, {
      name: 'Public root',
      slug: 'public-root-' + suffix,
    }).expect(201)
  ).body.data;
  const child = (
    await createCategory(app, adminToken, {
      name: 'Public child',
      slug: 'public-child-' + suffix,
      parentId: root.id,
    }).expect(201)
  ).body.data;
  const product = await prisma.product.create({
    data: {
      categoryId: child.id,
      sku: 'CATEGORY-' + suffix,
      name: 'Category visibility product',
      slug: 'category-product-' + suffix,
      sellingUnit: 'each',
      status: 'ACTIVE',
      publishedAt: new Date(),
    },
  });
  await prisma.productPriceHistory.create({
    data: {
      productId: product.id,
      price: 125000n,
      startsAt: new Date('2020-01-01T00:00:00Z'),
    },
  });

  await request(app)
    .get('/api/v1/categories/' + child.slug)
    .expect(200);
  await request(app)
    .get('/api/v1/products/' + product.slug)
    .expect(200);

  const blocked = await request(app)
    .post('/api/v1/admin/categories/' + root.id + '/archive')
    .set('Authorization', bearer(adminToken))
    .expect(409);
  assert.equal(blocked.body.error.code, 'CATEGORY_HAS_ACTIVE_CHILDREN');

  const archivedChild = await request(app)
    .post('/api/v1/admin/categories/' + child.id + '/archive')
    .set('Authorization', bearer(adminToken))
    .expect(200);
  assert.equal(archivedChild.body.data.status, 'ARCHIVED');
  assert.ok(archivedChild.body.data.archivedAt);
  await request(app)
    .get('/api/v1/categories/' + child.slug)
    .expect(404);
  await request(app)
    .get('/api/v1/products/' + product.slug)
    .expect(404);

  await request(app)
    .post('/api/v1/admin/categories/' + root.id + '/archive')
    .set('Authorization', bearer(adminToken))
    .expect(200);
  const repeated = await request(app)
    .post('/api/v1/admin/categories/' + root.id + '/archive')
    .set('Authorization', bearer(adminToken))
    .expect(200);
  assert.equal(repeated.body.data.status, 'ARCHIVED');
  await request(app)
    .get('/api/v1/categories/' + root.slug)
    .expect(404);

  const list = await request(app)
    .get('/api/v1/admin/categories')
    .set('Authorization', bearer(adminToken))
    .expect(200);
  assert.equal(
    list.body.data.filter(({ id }) => [root.id, child.id].includes(id)).length,
    2,
  );
});
