import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import test from 'node:test';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { readAuthConfig } from '../../src/config/auth.js';
import { validateDatabaseUrl } from '../../src/config/env.js';
import { createDatabase } from '../../src/db/client.js';
import { createCloudinaryAdapter } from '../../src/modules/media/cloudinary.js';
import { processDueMediaCleanup } from '../../src/modules/media/cleanup.js';
import { createSessionService } from '../../src/modules/auth/sessions.js';

const authConfig = readAuthConfig({
  AUTH_JWT_SECRET: randomBytes(32).toString('hex'),
  WEB_ORIGIN: 'https://shop.example.test',
  NODE_ENV: 'production',
});
const cloudinaryConfig = {
  cloudName: 'marthub-test',
  apiKey: '123456789',
  apiSecret: 'integration-secret-123',
};
const bearer = (token) => 'Bearer ' + token;

function createProvider() {
  const resources = new Map();
  const destroyed = [];
  let failDeletes = 0;
  const fetchImpl = async (url, options = {}) => {
    if (url.includes('/resources/image/upload/')) {
      const publicId = decodeURIComponent(
        url.split('/resources/image/upload/')[1],
      );
      const resource = resources.get(publicId);
      return new Response(
        JSON.stringify(resource ?? { error: { message: 'missing' } }),
        { status: resource ? 200 : 404 },
      );
    }
    if (url.endsWith('/destroy')) {
      const publicId = new URLSearchParams(String(options.body)).get(
        'public_id',
      );
      if (failDeletes > 0) {
        failDeletes -= 1;
        return new Response(
          JSON.stringify({ error: { message: 'temporary' } }),
          { status: 503 },
        );
      }
      destroyed.push(publicId);
      const existed = resources.delete(publicId);
      return new Response(
        JSON.stringify({ result: existed ? 'ok' : 'not found' }),
        { status: 200 },
      );
    }
    throw new Error('Unexpected provider URL: ' + url);
  };
  return {
    resources,
    destroyed,
    fail(count) {
      failDeletes = count;
    },
    media: createCloudinaryAdapter({ config: cloudinaryConfig, fetchImpl }),
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
          email: `media-${role.toLowerCase()}-${suffix}@example.test`,
          passwordHash: 'unused-test-hash',
          firstName: role === 'ADMIN' ? 'Admin' : 'Customer',
          lastName: 'Media',
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
    data: { name: 'Media test', slug: 'media-test-' + suffix },
  });
  const product = await prisma.product.create({
    data: {
      categoryId: category.id,
      sku: 'MEDIA-' + suffix.toUpperCase(),
      name: 'Media product',
      slug: 'media-product-' + suffix,
      sellingUnit: 'each',
      status: 'ACTIVE',
      publishedAt: new Date(),
      prices: {
        create: {
          price: 100000n,
          startsAt: new Date('2020-01-01T00:00:00Z'),
          createdByUserId: users[1].id,
        },
      },
      inventory: { create: { quantityOnHand: 1 } },
    },
  });
  const provider = createProvider();
  const app = createApp({
    prisma,
    authConfig,
    mediaAdapter: provider.media,
    origin: authConfig.origin,
    logger: () => {},
  });
  t.after(async () => {
    await prisma.mediaCleanup.deleteMany({ where: { productId: product.id } });
    await prisma.productImage.deleteMany({ where: { productId: product.id } });
    await prisma.productPriceHistory.deleteMany({
      where: { productId: product.id },
    });
    await prisma.inventory.deleteMany({ where: { productId: product.id } });
    await prisma.product.delete({ where: { id: product.id } });
    await prisma.category.delete({ where: { id: category.id } });
    await prisma.user.deleteMany({
      where: { id: { in: users.map(({ id }) => id) } },
    });
    await database.close();
  });
  return {
    app,
    prisma,
    product,
    provider,
    customerToken: customerSession.data.accessToken,
    adminToken: adminSession.data.accessToken,
  };
}

async function signature(app, productId, token) {
  return request(app)
    .post(`/api/v1/admin/products/${productId}/images/signature`)
    .set('Authorization', bearer(token))
    .expect(200);
}

async function register(context, name, overrides = {}) {
  const signed = await signature(
    context.app,
    context.product.id,
    context.adminToken,
  );
  const publicId = signed.body.data.parameters.public_id;
  context.provider.resources.set(publicId, {
    public_id: publicId,
    resource_type: 'image',
    type: 'upload',
    format: 'jpg',
    bytes: 4096,
    width: 1200,
    height: 900,
    ...overrides.resource,
  });
  const response = await request(context.app)
    .post(`/api/v1/admin/products/${context.product.id}/images`)
    .set('Authorization', bearer(context.adminToken))
    .send({
      publicId,
      uploadTimestamp: signed.body.data.parameters.timestamp,
      uploadSignature: signed.body.data.parameters.signature,
      altText: overrides.altText ?? 'Product front view',
      sortOrder: overrides.sortOrder ?? 0,
      isPrimary: overrides.isPrimary ?? false,
    })
    .expect(overrides.expectedStatus ?? 201);
  response.publicId = publicId;
  response.label = name;
  return response;
}

test('media signature and mutation routes inherit database-authoritative Admin RBAC', async (t) => {
  const context = await setup(t);
  await request(context.app)
    .post(`/api/v1/admin/products/${context.product.id}/images/signature`)
    .expect(401);
  await request(context.app)
    .post(`/api/v1/admin/products/${context.product.id}/images/signature`)
    .set('Authorization', bearer(context.customerToken))
    .expect(403);
  const signed = await signature(
    context.app,
    context.product.id,
    context.adminToken,
  );
  assert.equal(signed.body.data.parameters.allowed_formats, 'jpg,png,webp');
  assert.equal(signed.body.data.parameters.max_file_size, 4_194_304);
  assert.equal(
    JSON.stringify(signed.body).includes(cloudinaryConfig.apiSecret),
    false,
  );
  assert.match(signed.headers['cache-control'], /no-store/u);
});

test('registration verifies provider format, 4 MB boundary, ownership, and optimized metadata', async (t) => {
  const context = await setup(t);
  const accepted = await register(context, 'max-size', {
    resource: { format: 'webp', bytes: 4_194_304, width: 1800, height: 1200 },
  });
  assert.equal(accepted.body.data.isPrimary, true);
  assert.equal(accepted.body.data.width, 1800);
  assert.match(accepted.body.data.url, /f_auto,q_auto,c_limit,w_1200/u);

  const rejected = await register(context, 'too-large', {
    resource: { bytes: 4_194_305 },
    sortOrder: 1,
    expectedStatus: 422,
  });
  assert.equal(rejected.body.error.code, 'INVALID_MEDIA');
  assert.ok(context.provider.destroyed.includes(rejected.publicId));
  const wrongFolder = await signature(
    context.app,
    context.product.id,
    context.adminToken,
  );
  await request(context.app)
    .post(`/api/v1/admin/products/${context.product.id}/images`)
    .set('Authorization', bearer(context.adminToken))
    .send({
      publicId: 'marthub/products/0e7b73b7-9db0-4ae0-80b5-08e4049162cf/foreign',
      uploadTimestamp: wrongFolder.body.data.parameters.timestamp,
      uploadSignature: wrongFolder.body.data.parameters.signature,
      altText: 'Foreign',
      sortOrder: 2,
    })
    .expect(422);
});

test('image ordering, primary selection, removal, and provider-failure recovery are consistent', async (t) => {
  const context = await setup(t);
  const first = (await register(context, 'first', { sortOrder: 0 })).body.data;
  const second = (await register(context, 'second', { sortOrder: 1 })).body
    .data;
  assert.equal(first.isPrimary, true);
  assert.equal(second.isPrimary, false);

  const reordered = await request(context.app)
    .patch(`/api/v1/admin/products/${context.product.id}/images/${second.id}`)
    .set('Authorization', bearer(context.adminToken))
    .send({ sortOrder: 0, isPrimary: true, altText: 'Primary product view' })
    .expect(200);
  assert.equal(reordered.body.data.sortOrder, 0);
  assert.equal(reordered.body.data.isPrimary, true);
  const rows = await context.prisma.productImage.findMany({
    where: { productId: context.product.id },
    orderBy: { sortOrder: 'asc' },
  });
  assert.deepEqual(
    rows.map(({ id }) => id),
    [second.id, first.id],
  );
  assert.equal(rows.filter(({ isPrimary }) => isPrimary).length, 1);

  context.provider.fail(1);
  const pending = await request(context.app)
    .delete(`/api/v1/admin/products/${context.product.id}/images/${second.id}`)
    .set('Authorization', bearer(context.adminToken))
    .expect(202);
  assert.equal(pending.body.data.status, 'PENDING');
  assert.equal(pending.body.data.attemptCount, 1);
  assert.equal(
    await context.prisma.productImage.findUnique({ where: { id: second.id } }),
    null,
  );
  const promoted = await context.prisma.productImage.findUniqueOrThrow({
    where: { id: first.id },
  });
  assert.equal(promoted.isPrimary, true);

  const completed = await request(context.app)
    .delete(`/api/v1/admin/products/${context.product.id}/images/${second.id}`)
    .set('Authorization', bearer(context.adminToken))
    .expect(200);
  assert.equal(completed.body.data.status, 'COMPLETED');
  assert.equal(completed.body.data.attemptCount, 2);
});

test('cleanup retry state survives requests, stops at five failures, and supports explicit operator restart', async (t) => {
  const context = await setup(t);
  const image = (await register(context, 'retry', { sortOrder: 0 })).body.data;
  context.provider.fail(10);
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const response = await request(context.app)
      .delete(`/api/v1/admin/products/${context.product.id}/images/${image.id}`)
      .set('Authorization', bearer(context.adminToken))
      .expect(202);
    assert.equal(response.body.data.attemptCount, attempt);
    assert.equal(
      response.body.data.status,
      attempt === 5 ? 'FAILED' : 'PENDING',
    );
  }
  const failed = await context.prisma.mediaCleanup.findUniqueOrThrow({
    where: { productImageId: image.id },
  });
  assert.equal(failed.status, 'FAILED');
  assert.equal(failed.lastErrorCode, 'CLOUDINARY_ERROR');

  context.provider.fail(0);
  const recovered = await processDueMediaCleanup({
    prisma: context.prisma,
    media: context.provider.media,
    retryFailed: true,
    now: new Date(Date.now() + 3_600_000),
  });
  assert.equal(recovered.length, 1);
  assert.equal(recovered[0].status, 'COMPLETED');
  assert.equal(recovered[0].attemptCount, 1);
});

test('abandoned signed uploads remain durable and are cleaned after expiry', async (t) => {
  const context = await setup(t);
  const signed = await signature(
    context.app,
    context.product.id,
    context.adminToken,
  );
  const publicId = signed.body.data.parameters.public_id;
  const intent = await context.prisma.mediaCleanup.findUniqueOrThrow({
    where: { cloudinaryPublicId: publicId },
  });
  assert.equal(intent.status, 'PENDING');
  assert.equal(intent.attemptCount, 0);

  const processed = await processDueMediaCleanup({
    prisma: context.prisma,
    media: context.provider.media,
    now: new Date(signed.body.data.expiresAt),
  });
  assert.equal(processed.length, 1);
  assert.equal(processed[0].status, 'COMPLETED');
  assert.ok(context.provider.destroyed.includes(publicId));
});
