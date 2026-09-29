import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import test from 'node:test';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { readAuthConfig } from '../../src/config/auth.js';
import { validateDatabaseUrl } from '../../src/config/env.js';
import { createDatabase } from '../../src/db/client.js';
import { createSessionService } from '../../src/modules/auth/sessions.js';
import { createAdminPriceService } from '../../src/modules/admin/prices.js';

const authConfig = readAuthConfig({
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
          email: `price-${role.toLowerCase()}-${suffix}@example.test`,
          passwordHash: 'unused-test-hash',
          firstName: role === 'ADMIN' ? 'Admin' : 'Customer',
          lastName: 'Price',
          role,
        },
      }),
    ),
  );
  const [customerSession, adminSession] = await Promise.all(
    users.map((user) =>
      createSessionService({ prisma, config: authConfig }).issue(user.id),
    ),
  );
  const category = await prisma.category.create({
    data: { name: 'Price test', slug: 'price-test-' + suffix },
  });
  const product = await prisma.product.create({
    data: {
      categoryId: category.id,
      sku: 'PRICE-' + suffix.toUpperCase(),
      name: 'Price product',
      slug: 'price-product-' + suffix,
      sellingUnit: 'each',
      status: 'ACTIVE',
      publishedAt: new Date('2026-09-01T00:00:00.000Z'),
      prices: {
        create: {
          price: 100000n,
          compareAtPrice: 120000n,
          startsAt: new Date('2026-09-01T00:00:00.000Z'),
          createdByUserId: users[1].id,
        },
      },
      inventory: { create: { quantityOnHand: 1 } },
    },
  });
  const app = createApp({
    prisma,
    authConfig,
    origin: authConfig.origin,
    logger: () => {},
  });
  t.after(async () => {
    await prisma.productPriceHistory.deleteMany({
      where: { productId: product.id },
    });
    await prisma.inventory.deleteMany({ where: { productId: product.id } });
    await prisma.product.delete({ where: { id: product.id } });
    await prisma.category.delete({ where: { id: category.id } });
    await prisma.user.deleteMany({
      where: { id: { in: users.map((row) => row.id) } },
    });
    await database.close();
  });
  return {
    app,
    prisma,
    product,
    admin: users[1],
    adminToken: adminSession.data.accessToken,
    customerToken: customerSession.data.accessToken,
  };
}
function postPrice(context, body, token = context.adminToken) {
  return request(context.app)
    .post(`/api/v1/admin/products/${context.product.id}/prices`)
    .set('Authorization', bearer(token))
    .send(body);
}

const immediate = {
  price: '110000',
  compareAtPrice: '130000',
  startsAt: '2026-09-21T00:00:00.000Z',
};

test('price API enforces Admin RBAC and strict exact-VND invariants', async (t) => {
  const context = await setup(t);
  await request(context.app)
    .get(`/api/v1/admin/products/${context.product.id}/prices`)
    .expect(401);
  await request(context.app)
    .get(`/api/v1/admin/products/${context.product.id}/prices`)
    .set('Authorization', bearer(context.customerToken))
    .expect(403);
  const history = await request(context.app)
    .get(`/api/v1/admin/products/${context.product.id}/prices`)
    .set('Authorization', bearer(context.adminToken))
    .expect('Cache-Control', 'no-store')
    .expect(200);
  assert.equal(history.body.data.length, 1);
  for (const body of [
    { ...immediate, price: '0' },
    { ...immediate, price: '10.5' },
    { ...immediate, compareAtPrice: '110000' },
    { ...immediate, endsAt: '2026-10-01T00:00:00.000Z' },
  ])
    assert.equal((await postPrice(context, body)).status, 422);
  assert.equal(
    await context.prisma.productPriceHistory.count({
      where: { productId: context.product.id },
    }),
    1,
  );
});

test('immediate successor closes its predecessor exactly and persists actor audit history', async (t) => {
  const context = await setup(t);
  const created = await postPrice(context, immediate).expect(201);
  assert.equal(created.body.data.price, '110000');
  assert.equal(created.body.data.compareAtPrice, '130000');
  assert.equal(created.body.data.startsAt, immediate.startsAt);
  assert.equal(created.body.data.endsAt, null);
  assert.equal(created.body.data.isCurrent, true);
  assert.deepEqual(created.body.data.createdBy, {
    id: context.admin.id,
    email: context.admin.email,
    firstName: context.admin.firstName,
    lastName: context.admin.lastName,
  });
  const rows = await context.prisma.productPriceHistory.findMany({
    where: { productId: context.product.id },
    orderBy: { startsAt: 'asc' },
  });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].endsAt.toISOString(), immediate.startsAt);
  assert.equal(rows[1].startsAt.toISOString(), immediate.startsAt);
  assert.equal(rows[1].createdByUserId, context.admin.id);
  const product = await request(context.app)
    .get(`/api/v1/admin/products/${context.product.id}`)
    .set('Authorization', bearer(context.adminToken))
    .expect(200);
  assert.equal(product.body.data.price, '110000');
});

test('future successors preserve current price and reject destructive middle insertion', async (t) => {
  const context = await setup(t);
  const future = {
    price: '115000',
    compareAtPrice: null,
    startsAt: '2026-09-25T00:00:00.000Z',
  };
  await postPrice(context, future).expect(201);
  const current = await request(context.app)
    .get(`/api/v1/admin/products/${context.product.id}`)
    .set('Authorization', bearer(context.adminToken))
    .expect(200);
  assert.equal(current.body.data.price, '100000');
  await postPrice(context, {
    price: '125000',
    compareAtPrice: '140000',
    startsAt: '2026-10-01T00:00:00.000Z',
  }).expect(201);
  const before = await context.prisma.productPriceHistory.findMany({
    where: { productId: context.product.id },
    orderBy: { startsAt: 'asc' },
  });
  const conflict = await postPrice(context, {
    price: '119000',
    compareAtPrice: null,
    startsAt: '2026-09-28T00:00:00.000Z',
  }).expect(409);
  assert.equal(conflict.body.error.code, 'PRICE_TIMELINE_CONFLICT');
  const after = await context.prisma.productPriceHistory.findMany({
    where: { productId: context.product.id },
    orderBy: { startsAt: 'asc' },
  });
  assert.deepEqual(
    after.map((row) => [
      row.startsAt.toISOString(),
      row.endsAt?.toISOString() ?? null,
    ]),
    before.map((row) => [
      row.startsAt.toISOString(),
      row.endsAt?.toISOString() ?? null,
    ]),
  );
  assert.deepEqual(
    after.map((row) => row.endsAt?.toISOString() ?? null),
    ['2026-09-25T00:00:00.000Z', '2026-10-01T00:00:00.000Z', null],
  );
});

test('database protects immutable price fields and rolls back a failed actor audit insert', async (t) => {
  const context = await setup(t);
  const original = await context.prisma.productPriceHistory.findFirstOrThrow({
    where: { productId: context.product.id },
  });
  for (const data of [
    { price: 99999n },
    { compareAtPrice: 140000n },
    { startsAt: new Date('2026-09-02T00:00:00.000Z') },
    { createdByUserId: null },
    { createdAt: new Date('2026-09-02T00:00:00.000Z') },
  ])
    await assert.rejects(
      context.prisma.productPriceHistory.update({
        where: { id: original.id },
        data,
      }),
    );
  await assert.rejects(
    context.prisma.productPriceHistory.update({
      where: { id: original.id },
      data: { endsAt: new Date(immediate.startsAt) },
    }),
  );
  const service = createAdminPriceService({ prisma: context.prisma });
  await assert.rejects(
    service.create(context.product.id, immediate, randomUUID()),
  );
  const unchanged = await context.prisma.productPriceHistory.findUniqueOrThrow({
    where: { id: original.id },
  });
  assert.equal(unchanged.endsAt, null);
  assert.equal(
    await context.prisma.productPriceHistory.count({
      where: { productId: context.product.id },
    }),
    1,
  );
  await service.create(context.product.id, immediate, context.admin.id, {
    actorUserId: context.admin.id,
    requestId: randomUUID(),
  });
  for (const endsAt of [null, new Date('2026-09-22T00:00:00.000Z')])
    await assert.rejects(
      context.prisma.productPriceHistory.update({
        where: { id: original.id },
        data: { endsAt },
      }),
    );
  await request(context.app)
    .patch(`/api/v1/admin/products/${context.product.id}/prices/${original.id}`)
    .set('Authorization', bearer(context.adminToken))
    .send({ price: '1' })
    .expect(404);
});

test('concurrent same-product successors serialize to one valid winner', async (t) => {
  const context = await setup(t);
  const responses = await Promise.all([
    postPrice(context, immediate),
    postPrice(context, { ...immediate, price: '111000', compareAtPrice: null }),
  ]);
  assert.deepEqual(
    responses.map((response) => response.status).sort(),
    [201, 409],
  );
  const rows = await context.prisma.productPriceHistory.findMany({
    where: { productId: context.product.id },
    orderBy: { startsAt: 'asc' },
  });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].endsAt.toISOString(), immediate.startsAt);
  assert.equal(rows[1].startsAt.toISOString(), immediate.startsAt);
  assert.equal(rows[1].endsAt, null);
});
