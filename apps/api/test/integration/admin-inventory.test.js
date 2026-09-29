import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import test from 'node:test';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { readAuthConfig } from '../../src/config/auth.js';
import { validateDatabaseUrl } from '../../src/config/env.js';
import { createDatabase } from '../../src/db/client.js';
import { createSessionService } from '../../src/modules/auth/sessions.js';
import { createAdminInventoryService } from '../../src/modules/admin/inventory.js';

const authConfig = readAuthConfig({
  AUTH_JWT_SECRET: randomBytes(32).toString('hex'),
  WEB_ORIGIN: 'https://shop.example.test',
  NODE_ENV: 'production',
});
const bearer = (token) => 'Bearer ' + token;

async function setup(t, quantityOnHand = 5) {
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
            'inventory-' + role.toLowerCase() + '-' + suffix + '@example.test',
          passwordHash: 'unused-test-hash',
          firstName: role === 'ADMIN' ? 'Admin' : 'Customer',
          lastName: 'Inventory',
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
    data: { name: 'Inventory test', slug: 'inventory-test-' + suffix },
  });
  const product = await prisma.product.create({
    data: {
      categoryId: category.id,
      sku: 'INVENTORY-' + suffix.toUpperCase(),
      name: 'Inventory product ' + suffix,
      slug: 'inventory-product-' + suffix,
      sellingUnit: 'each',
      status: 'ACTIVE',
      publishedAt: new Date(),
      prices: {
        create: {
          price: 100000n,
          startsAt: new Date('2026-09-01T00:00:00.000Z'),
          createdByUserId: users[1].id,
        },
      },
      inventory: { create: { quantityOnHand } },
    },
  });
  const app = createApp({
    prisma,
    authConfig,
    origin: authConfig.origin,
    logger: () => {},
  });
  t.after(() => database.close());
  return {
    app,
    prisma,
    product,
    admin: users[1],
    adminToken: adminSession.data.accessToken,
    customerToken: customerSession.data.accessToken,
  };
}
function adjust(context, body, token = context.adminToken) {
  return request(context.app)
    .post('/api/v1/admin/inventory/' + context.product.id + '/adjustments')
    .set('Authorization', bearer(token))
    .send(body);
}

test('inventory API is Admin-only, strict, filterable, and exposes empty history', async (t) => {
  const context = await setup(t);
  await request(context.app).get('/api/v1/admin/inventory').expect(401);
  await request(context.app)
    .get('/api/v1/admin/inventory')
    .set('Authorization', bearer(context.customerToken))
    .expect(403);
  const list = await request(context.app)
    .get('/api/v1/admin/inventory?maxQuantity=5&q=Inventory')
    .set('Authorization', bearer(context.adminToken))
    .expect('Cache-Control', 'no-store')
    .expect(200);
  assert.ok(list.body.data.some((row) => row.productId === context.product.id));
  await request(context.app)
    .get('/api/v1/admin/inventory?unknown=true')
    .set('Authorization', bearer(context.adminToken))
    .expect(422);
  const history = await request(context.app)
    .get('/api/v1/admin/inventory/' + context.product.id + '/movements')
    .set('Authorization', bearer(context.adminToken))
    .expect(200);
  assert.deepEqual(history.body.data, []);
  for (const body of [
    { adjustment: 0, reason: 'Counted' },
    { adjustment: 1.5, reason: 'Counted' },
    { adjustment: 1, reason: '' },
    { adjustment: 1, reason: 'Counted', quantityBefore: 5 },
    { adjustment: 1, reason: 'Counted', actorUserId: context.admin.id },
  ])
    assert.equal((await adjust(context, body)).status, 422);
  assert.equal(
    await context.prisma.inventoryMovement.count({
      where: { productId: context.product.id },
    }),
    0,
  );
});

test('positive and negative adjustments persist authoritative boundaries, actor, and reason', async (t) => {
  const context = await setup(t);
  const decreased = await adjust(context, {
    adjustment: -2,
    reason: 'Damaged during cycle count',
  }).expect(201);
  assert.equal(decreased.body.data.inventory.quantityOnHand, 3);
  assert.deepEqual(
    {
      adjustment: decreased.body.data.movement.adjustment,
      quantityBefore: decreased.body.data.movement.quantityBefore,
      quantityAfter: decreased.body.data.movement.quantityAfter,
      reason: decreased.body.data.movement.reason,
      actorId: decreased.body.data.movement.actor.id,
    },
    {
      adjustment: -2,
      quantityBefore: 5,
      quantityAfter: 3,
      reason: 'Damaged during cycle count',
      actorId: context.admin.id,
    },
  );
  await context.prisma.product.update({
    where: { id: context.product.id },
    data: { status: 'ARCHIVED', archivedAt: new Date() },
  });
  const increased = await adjust(context, {
    adjustment: 4,
    reason: 'Returned after archived item reconciliation',
  }).expect(201);
  assert.equal(increased.body.data.movement.quantityBefore, 3);
  assert.equal(increased.body.data.movement.quantityAfter, 7);
  const history = await request(context.app)
    .get(
      '/api/v1/admin/inventory/' + context.product.id + '/movements?perPage=1',
    )
    .set('Authorization', bearer(context.adminToken))
    .expect(200);
  assert.equal(history.body.data.length, 1);
  assert.equal(history.body.meta.totalItems, 2);
  assert.equal(history.body.data[0].quantityAfter, 7);
});

test('negative stock and movement failures roll back inventory and history together', async (t) => {
  const context = await setup(t, 2);
  const insufficient = await adjust(context, {
    adjustment: -3,
    reason: 'Count correction',
  }).expect(409);
  assert.equal(insufficient.body.error.code, 'INSUFFICIENT_STOCK');
  let inventory = await context.prisma.inventory.findUniqueOrThrow({
    where: { productId: context.product.id },
  });
  assert.equal(inventory.quantityOnHand, 2);
  assert.equal(
    await context.prisma.inventoryMovement.count({
      where: { productId: context.product.id },
    }),
    0,
  );

  const service = createAdminInventoryService({ prisma: context.prisma });
  await assert.rejects(
    service.adjust(
      context.product.id,
      { adjustment: 1, reason: 'Actor rollback check' },
      randomUUID(),
    ),
  );
  inventory = await context.prisma.inventory.findUniqueOrThrow({
    where: { productId: context.product.id },
  });
  assert.equal(inventory.quantityOnHand, 2);
  assert.equal(
    await context.prisma.inventoryMovement.count({
      where: { productId: context.product.id },
    }),
    0,
  );
});

test('PostgreSQL constraints protect quantity, movement consistency, and append-only history', async (t) => {
  const context = await setup(t, 1);
  await assert.rejects(
    context.prisma.$executeRawUnsafe(
      'UPDATE "inventory" SET "quantity_on_hand" = -1 WHERE "product_id" = $1::uuid',
      context.product.id,
    ),
  );
  await assert.rejects(
    context.prisma.inventoryMovement.create({
      data: {
        productId: context.product.id,
        type: 'ADJUSTMENT',
        quantityDelta: 2,
        quantityAfter: 1,
        actorUserId: context.admin.id,
        reason: 'Invalid boundary',
      },
    }),
  );
  const created = await adjust(context, {
    adjustment: 1,
    reason: 'Valid cycle count',
  }).expect(201);
  await assert.rejects(
    context.prisma.inventoryMovement.update({
      where: { id: created.body.data.movement.id },
      data: { reason: 'Rewritten history' },
    }),
  );
  await assert.rejects(
    context.prisma.inventoryMovement.delete({
      where: { id: created.body.data.movement.id },
    }),
  );
});

test('concurrent same-product adjustments serialize without oversell or lost updates', async (t) => {
  const context = await setup(t, 5);
  const decrements = await Promise.all([
    adjust(context, { adjustment: -4, reason: 'Concurrent decrement A' }),
    adjust(context, { adjustment: -4, reason: 'Concurrent decrement B' }),
  ]);
  assert.deepEqual(
    decrements.map((response) => response.status).sort(),
    [201, 409],
  );
  let inventory = await context.prisma.inventory.findUniqueOrThrow({
    where: { productId: context.product.id },
  });
  assert.equal(inventory.quantityOnHand, 1);

  const additions = await Promise.all([
    adjust(context, { adjustment: 2, reason: 'Concurrent addition A' }),
    adjust(context, { adjustment: 3, reason: 'Concurrent addition B' }),
  ]);
  assert.deepEqual(
    additions.map((response) => response.status).sort(),
    [201, 201],
  );
  inventory = await context.prisma.inventory.findUniqueOrThrow({
    where: { productId: context.product.id },
  });
  assert.equal(inventory.quantityOnHand, 6);
  const rows = await context.prisma.inventoryMovement.findMany({
    where: { productId: context.product.id },
    orderBy: { createdAt: 'asc' },
  });
  assert.equal(rows.length, 3);
  const successfulBoundaries = rows.map((row) => [
    row.quantityAfter - row.quantityDelta,
    row.quantityAfter,
  ]);
  assert.deepEqual(successfulBoundaries[0], [5, 1]);
  assert.ok(
    JSON.stringify(successfulBoundaries.slice(1)) ===
      JSON.stringify([
        [1, 3],
        [3, 6],
      ]) ||
      JSON.stringify(successfulBoundaries.slice(1)) ===
        JSON.stringify([
          [1, 4],
          [4, 6],
        ]),
  );
});
