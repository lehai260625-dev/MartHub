import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import test from 'node:test';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { readAuthConfig } from '../../src/config/auth.js';
import { validateDatabaseUrl } from '../../src/config/env.js';
import { createDatabase } from '../../src/db/client.js';
import { createAdminCategoryService } from '../../src/modules/admin/categories.js';
import { createSessionService } from '../../src/modules/auth/sessions.js';
import { createCloudinaryAdapter } from '../../src/modules/media/cloudinary.js';

const authConfig = readAuthConfig({
  AUTH_JWT_SECRET: randomBytes(32).toString('hex'),
  WEB_ORIGIN: 'https://shop.example.test',
  NODE_ENV: 'production',
});
const cloudinaryConfig = {
  cloudName: 'marthub-audit-test',
  apiKey: 'audit-api-key',
  apiSecret: 'audit-provider-secret-123',
};
const bearer = (token) => 'Bearer ' + token;

function provider() {
  const resources = new Map();
  return {
    resources,
    media: createCloudinaryAdapter({
      config: cloudinaryConfig,
      fetchImpl: async (url, options = {}) => {
        if (url.includes('/resources/image/upload/')) {
          const publicId = decodeURIComponent(
            url.split('/resources/image/upload/')[1],
          );
          const found = resources.get(publicId);
          return new Response(
            JSON.stringify(found ?? { error: { message: 'missing' } }),
            { status: found ? 200 : 404 },
          );
        }
        if (url.endsWith('/destroy')) {
          const publicId = new URLSearchParams(String(options.body)).get(
            'public_id',
          );
          resources.delete(publicId);
          return new Response(JSON.stringify({ result: 'ok' }), {
            status: 200,
          });
        }
        throw new Error('Unexpected provider request.');
      },
    }),
  };
}

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
          email: 'audit-' + role.toLowerCase() + '-' + suffix + '@example.test',
          passwordHash: 'not-a-real-password-hash',
          firstName: role,
          lastName: 'Audit',
          role,
        },
      }),
    ),
  );
  const sessions = await Promise.all(
    users.map((user) =>
      createSessionService({ prisma, config: authConfig }).issue(user.id),
    ),
  );
  const fake = provider();
  const app = createApp({
    prisma,
    authConfig,
    mediaAdapter: fake.media,
    origin: authConfig.origin,
    logger: () => {},
  });
  t.after(() => database.close());
  return {
    app,
    prisma,
    suffix,
    customerToken: sessions[0].data.accessToken,
    adminToken: sessions[1].data.accessToken,
    admin: users[1],
    provider: fake,
  };
}

function adminCall(context, method, path, body, requestId = randomUUID()) {
  const client = request(context.app);
  let operation = client[method](path)
    .set('Authorization', bearer(context.adminToken))
    .set('X-Request-Id', requestId);
  if (body !== undefined) operation = operation.send(body);
  return { operation, requestId };
}

function resource(publicId, changes = {}) {
  return {
    public_id: publicId,
    resource_type: 'image',
    type: 'upload',
    format: 'jpg',
    bytes: 4096,
    width: 1200,
    height: 800,
    ...changes,
  };
}

test('all M4.2-M4.7 Admin commands create one stable safe audit event', async (t) => {
  const context = await setup(t);
  const requestIds = [];
  const call = async (method, path, body, status) => {
    const { operation, requestId } = adminCall(context, method, path, body);
    const response = await operation.expect(status);
    requestIds.push(requestId);
    return response;
  };

  const category = (
    await call(
      'post',
      '/api/v1/admin/categories',
      {
        name: 'Audit category',
        slug: 'audit-category-' + context.suffix,
        description: 'Safe catalog copy',
        parentId: null,
        sortOrder: 4,
      },
      201,
    )
  ).body.data;
  await call(
    'patch',
    '/api/v1/admin/categories/' + category.id,
    { sortOrder: 5, description: 'Updated safe catalog copy' },
    200,
  );

  const product = (
    await call(
      'post',
      '/api/v1/admin/products',
      {
        categoryId: category.id,
        sku: 'AUDIT-' + context.suffix.toUpperCase(),
        slug: 'audit-product-' + context.suffix,
        name: 'Audit product',
        shortDescription: 'Safe short copy.',
        description: 'Safe product description.',
        brand: 'MartHub',
        sellingUnit: 'each',
        isFeatured: false,
        isNew: true,
        isPopular: false,
        price: '9007199254740993',
        compareAtPrice: '9007199254741993',
      },
      201,
    )
  ).body.data;
  await call(
    'patch',
    '/api/v1/admin/products/' + product.id,
    { name: 'Audited product' },
    200,
  );
  await call(
    'post',
    '/api/v1/admin/products/' + product.id + '/publish',
    undefined,
    200,
  );

  const productSignature = (
    await call(
      'post',
      '/api/v1/admin/products/' + product.id + '/images/signature',
      undefined,
      200,
    )
  ).body.data;
  const productPublicId = productSignature.parameters.public_id;
  context.provider.resources.set(productPublicId, resource(productPublicId));
  const image = (
    await call(
      'post',
      '/api/v1/admin/products/' + product.id + '/images',
      {
        publicId: productPublicId,
        uploadTimestamp: productSignature.parameters.timestamp,
        uploadSignature: productSignature.parameters.signature,
        altText: 'Audit product on a neutral background',
        sortOrder: 0,
        isPrimary: true,
      },
      201,
    )
  ).body.data;
  await call(
    'patch',
    '/api/v1/admin/products/' + product.id + '/images/' + image.id,
    { altText: 'Updated safe product image text', sortOrder: 1 },
    200,
  );
  await call(
    'delete',
    '/api/v1/admin/products/' + product.id + '/images/' + image.id,
    undefined,
    200,
  );

  const price = (
    await call(
      'post',
      '/api/v1/admin/products/' + product.id + '/prices',
      {
        price: '9007199254742993',
        compareAtPrice: '9007199254743993',
        startsAt: new Date(Date.now() + 86_400_000).toISOString(),
      },
      201,
    )
  ).body.data;
  const adjustment = (
    await call(
      'post',
      '/api/v1/admin/inventory/' + product.id + '/adjustments',
      { adjustment: 7, reason: 'Verified audit cycle count' },
      201,
    )
  ).body.data;
  await call(
    'post',
    '/api/v1/admin/products/' + product.id + '/archive',
    undefined,
    200,
  );
  await call(
    'post',
    '/api/v1/admin/categories/' + category.id + '/archive',
    undefined,
    200,
  );

  const promotion = (
    await call(
      'post',
      '/api/v1/admin/promotions',
      {
        title: 'Audited promotion',
        subtitle: 'Safe campaign copy',
        internalHref: '/category/audit',
        placement: 'HERO_PRIMARY',
        sortOrder: 2,
        startsAt: new Date(Date.now() - 60_000).toISOString(),
        endsAt: new Date(Date.now() + 86_400_000).toISOString(),
      },
      201,
    )
  ).body.data;
  await call(
    'patch',
    '/api/v1/admin/promotions/' + promotion.id,
    { sortOrder: 3, subtitle: 'Updated safe campaign copy' },
    200,
  );
  const promotionSignature = (
    await call(
      'post',
      '/api/v1/admin/promotions/' + promotion.id + '/media/signature',
      undefined,
      200,
    )
  ).body.data;
  const promotionPublicId = promotionSignature.parameters.public_id;
  context.provider.resources.set(
    promotionPublicId,
    resource(promotionPublicId, { width: 1600, height: 700 }),
  );
  await call(
    'post',
    '/api/v1/admin/promotions/' + promotion.id + '/media',
    {
      publicId: promotionPublicId,
      uploadTimestamp: promotionSignature.parameters.timestamp,
      uploadSignature: promotionSignature.parameters.signature,
    },
    201,
  );
  await call(
    'delete',
    '/api/v1/admin/promotions/' + promotion.id + '/media',
    undefined,
    200,
  );
  await call(
    'post',
    '/api/v1/admin/promotions/' + promotion.id + '/publish',
    undefined,
    200,
  );
  await call(
    'post',
    '/api/v1/admin/promotions/' + promotion.id + '/archive',
    undefined,
    200,
  );

  const logs = await context.prisma.adminAuditLog.findMany({
    where: { requestId: { in: requestIds } },
    orderBy: { createdAt: 'asc' },
  });
  const expectedActions = [
    'CATEGORY_ARCHIVE',
    'CATEGORY_CREATE',
    'CATEGORY_UPDATE',
    'INVENTORY_ADJUST',
    'PRICE_CREATE',
    'PRODUCT_ARCHIVE',
    'PRODUCT_CREATE',
    'PRODUCT_MEDIA_REGISTER',
    'PRODUCT_MEDIA_REMOVE',
    'PRODUCT_MEDIA_SIGNATURE',
    'PRODUCT_MEDIA_UPDATE',
    'PRODUCT_PUBLISH',
    'PRODUCT_UPDATE',
    'PROMOTION_ARCHIVE',
    'PROMOTION_CREATE',
    'PROMOTION_MEDIA_REGISTER',
    'PROMOTION_MEDIA_REMOVE',
    'PROMOTION_MEDIA_SIGNATURE',
    'PROMOTION_PUBLISH',
    'PROMOTION_UPDATE',
  ];
  assert.equal(logs.length, 20);
  assert.deepEqual(
    logs.map((log) => log.action).sort(),
    expectedActions.sort(),
  );
  assert.ok(logs.every((log) => log.actorUserId === context.admin.id));
  assert.deepEqual(
    new Set(logs.map((log) => log.requestId)),
    new Set(requestIds),
  );

  const byAction = Object.fromEntries(logs.map((log) => [log.action, log]));
  assert.equal(byAction.CATEGORY_CREATE.entityId, category.id);
  assert.equal(byAction.PRODUCT_CREATE.entityId, product.id);
  assert.equal(byAction.PRODUCT_MEDIA_SIGNATURE.entityId, product.id);
  assert.equal(byAction.PRODUCT_MEDIA_REGISTER.entityId, image.id);
  assert.equal(byAction.PRODUCT_MEDIA_UPDATE.entityId, image.id);
  assert.equal(byAction.PRODUCT_MEDIA_REMOVE.entityId, image.id);
  assert.equal(byAction.PRICE_CREATE.entityId, price.id);
  const inventory = await context.prisma.inventory.findUniqueOrThrow({
    where: { productId: product.id },
  });
  assert.equal(byAction.INVENTORY_ADJUST.entityId, inventory.id);
  assert.equal(adjustment.inventory.productId, product.id);
  assert.equal(byAction.PROMOTION_CREATE.entityId, promotion.id);
  assert.equal(byAction.PROMOTION_MEDIA_SIGNATURE.entityId, promotion.id);
  assert.equal(byAction.PROMOTION_MEDIA_REGISTER.entityId, promotion.id);
  assert.equal(byAction.PROMOTION_MEDIA_REMOVE.entityId, promotion.id);

  assert.equal(byAction.PRODUCT_CREATE.beforeJson, null);
  assert.equal(byAction.PRODUCT_CREATE.afterJson.name, 'Audit product');
  assert.equal(byAction.PRICE_CREATE.afterJson.price, '9007199254742993');
  assert.equal(
    byAction.PRICE_CREATE.afterJson.compareAtPrice,
    '9007199254743993',
  );
  assert.deepEqual(byAction.INVENTORY_ADJUST.beforeJson, {
    inventoryId: inventory.id,
    productId: product.id,
    quantityOnHand: 0,
  });
  assert.deepEqual(byAction.INVENTORY_ADJUST.afterJson, {
    inventoryId: inventory.id,
    productId: product.id,
    adjustment: 7,
    quantityBefore: 0,
    quantityAfter: 7,
    reason: 'Verified audit cycle count',
  });
  assert.equal(byAction.PRODUCT_MEDIA_REMOVE.afterJson, null);
  assert.equal(byAction.PROMOTION_MEDIA_REMOVE.afterJson.imagePublicId, null);

  const serialized = JSON.stringify(logs);
  for (const forbidden of [
    productSignature.parameters.signature,
    promotionSignature.parameters.signature,
    cloudinaryConfig.apiSecret,
    cloudinaryConfig.apiKey,
    'not-a-real-password-hash',
    'authorization',
    'uploadSignature',
  ])
    assert.equal(serialized.includes(forbidden), false);
});

test('failed, unauthorized, and no-op commands create no committed audit row', async (t) => {
  const context = await setup(t);
  const unauthorizedId = randomUUID();
  await request(context.app)
    .post('/api/v1/admin/categories')
    .set('Authorization', bearer(context.customerToken))
    .set('X-Request-Id', unauthorizedId)
    .send({ name: 'Denied', slug: 'denied-' + context.suffix })
    .expect(403);

  const invalidId = randomUUID();
  await adminCall(
    context,
    'post',
    '/api/v1/admin/categories',
    { name: 'Invalid', slug: 'INVALID SLUG' },
    invalidId,
  ).operation.expect(422);

  const created = await adminCall(context, 'post', '/api/v1/admin/categories', {
    name: 'No-op category',
    slug: 'noop-' + context.suffix,
  }).operation.expect(201);
  const conflictId = randomUUID();
  await adminCall(
    context,
    'post',
    '/api/v1/admin/categories',
    { name: 'Duplicate', slug: 'noop-' + context.suffix },
    conflictId,
  ).operation.expect(409);

  const product = await adminCall(context, 'post', '/api/v1/admin/products', {
    categoryId: created.body.data.id,
    sku: 'AUDIT-FAIL-' + context.suffix.toUpperCase(),
    slug: 'audit-failure-product-' + context.suffix,
    name: 'Audit failure product',
    shortDescription: 'Provider failure fixture.',
    description: 'Provider failure fixture.',
    brand: 'MartHub',
    sellingUnit: 'each',
    isFeatured: false,
    isNew: false,
    isPopular: false,
    price: '100000',
    compareAtPrice: null,
  }).operation.expect(201);
  const signed = await adminCall(
    context,
    'post',
    '/api/v1/admin/products/' + product.body.data.id + '/images/signature',
  ).operation.expect(200);
  const providerFailureId = randomUUID();
  await adminCall(
    context,
    'post',
    '/api/v1/admin/products/' + product.body.data.id + '/images',
    {
      publicId: signed.body.data.parameters.public_id,
      uploadTimestamp: signed.body.data.parameters.timestamp,
      uploadSignature: signed.body.data.parameters.signature,
      altText: 'Missing provider asset',
      sortOrder: 0,
      isPrimary: true,
    },
    providerFailureId,
  ).operation.expect(422);

  const firstArchiveId = randomUUID();
  await adminCall(
    context,
    'post',
    '/api/v1/admin/categories/' + created.body.data.id + '/archive',
    undefined,
    firstArchiveId,
  ).operation.expect(200);
  const noOpId = randomUUID();
  await adminCall(
    context,
    'post',
    '/api/v1/admin/categories/' + created.body.data.id + '/archive',
    undefined,
    noOpId,
  ).operation.expect(200);

  assert.equal(
    await context.prisma.adminAuditLog.count({
      where: {
        requestId: {
          in: [
            unauthorizedId,
            invalidId,
            conflictId,
            providerFailureId,
            noOpId,
          ],
        },
      },
    }),
    0,
  );
  assert.equal(
    await context.prisma.adminAuditLog.count({
      where: { requestId: firstArchiveId },
    }),
    1,
  );
});

test('audit insertion failure rolls back the business mutation', async (t) => {
  const context = await setup(t);
  const categories = createAdminCategoryService({ prisma: context.prisma });
  const slug = 'rollback-audit-' + context.suffix;
  await assert.rejects(
    categories.create(
      { name: 'Rollback audit', slug },
      {
        actorUserId: context.admin.id,
        requestId: 'x'.repeat(129),
      },
    ),
  );
  assert.equal(await context.prisma.category.count({ where: { slug } }), 0);
});

test('audit rows are append-only, indexed, and survive target deletion', async (t) => {
  const context = await setup(t);
  const requestId = randomUUID();
  const created = await adminCall(
    context,
    'post',
    '/api/v1/admin/categories',
    {
      name: 'Disposable audit target',
      slug: 'disposable-audit-' + context.suffix,
    },
    requestId,
  ).operation.expect(201);
  const log = await context.prisma.adminAuditLog.findFirstOrThrow({
    where: { requestId },
  });
  await assert.rejects(
    context.prisma.adminAuditLog.update({
      where: { id: log.id },
      data: { action: 'CATEGORY_UPDATE' },
    }),
  );
  await assert.rejects(
    context.prisma.adminAuditLog.delete({ where: { id: log.id } }),
  );
  await context.prisma.category.delete({
    where: { id: created.body.data.id },
  });
  assert.equal(
    await context.prisma.adminAuditLog.count({ where: { id: log.id } }),
    1,
  );

  const indexes = await context.prisma.$queryRawUnsafe(
    "SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'admin_audit_logs'",
  );
  const definitions = indexes.map(({ indexdef }) => indexdef).join('\n');
  assert.match(definitions, /actor_user_id.*created_at DESC/);
  assert.match(definitions, /entity_type.*entity_id.*created_at DESC/);
  assert.match(definitions, /request_id/);
});
