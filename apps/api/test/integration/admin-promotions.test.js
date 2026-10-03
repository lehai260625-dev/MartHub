import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import test from 'node:test';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { readAuthConfig } from '../../src/config/auth.js';
import { validateDatabaseUrl } from '../../src/config/env.js';
import { createDatabase } from '../../src/db/client.js';
import { createSessionService } from '../../src/modules/auth/sessions.js';
import { processDueMediaCleanup } from '../../src/modules/media/cleanup.js';

const authConfig = readAuthConfig({
  AUTH_JWT_SECRET: randomBytes(32).toString('hex'),
  WEB_ORIGIN: 'https://shop.example.test',
  NODE_ENV: 'production',
});
const bearer = (token) => 'Bearer ' + token;
function fakeMedia() {
  const resources = new Map();
  const failures = new Set();
  const destroyed = [];
  return {
    resources,
    failures,
    destroyed,
    createPromotionUploadContract(id, publicId, now = new Date()) {
      const timestamp = Math.floor(now.getTime() / 1000);
      return {
        cloudName: 'test',
        apiKey: 'key',
        uploadUrl: 'https://api.cloudinary.test/upload',
        expiresAt: new Date((timestamp + 300) * 1000).toISOString(),
        parameters: {
          allowed_formats: 'jpg,png,webp',
          folder: 'marthub/promotions/' + id,
          max_file_size: 4194304,
          public_id: publicId,
          timestamp,
          signature: 'a'.repeat(40),
        },
      };
    },
    verifyPromotionUploadContract(
      id,
      publicId,
      timestamp,
      signature,
      now = new Date(),
    ) {
      return (
        publicId.startsWith('marthub/promotions/' + id + '/') &&
        signature === 'a'.repeat(40) &&
        Math.floor(now.getTime() / 1000) < timestamp + 300
      );
    },
    async inspect(publicId) {
      return (
        resources.get(publicId) ?? {
          public_id: publicId,
          format: 'jpg',
          bytes: 4194304,
          width: 1200,
          height: 600,
          resource_type: 'image',
          type: 'upload',
        }
      );
    },
    deliveryUrl(publicId) {
      return (
        'https://res.cloudinary.test/image/upload/f_auto,q_auto,c_limit,w_1200/' +
        publicId
      );
    },
    async destroy(publicId) {
      destroyed.push(publicId);
      if (failures.has(publicId)) {
        const e = new Error('provider');
        e.code = 'CLOUDINARY_UNAVAILABLE';
        throw e;
      }
      return { alreadyMissing: false };
    },
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
          email: 'promo-' + role.toLowerCase() + '-' + suffix + '@example.test',
          passwordHash: 'x',
          firstName: role,
          lastName: 'Promo',
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
  const media = fakeMedia();
  const app = createApp({
    prisma,
    authConfig,
    mediaAdapter: media,
    origin: authConfig.origin,
    logger: () => {},
  });
  t.after(async () => {
    const owned = await prisma.promotion.findMany({
      where: { createdByUserId: users[1].id },
      select: { id: true },
    });
    await prisma.mediaCleanup.deleteMany({
      where: { promotionId: { in: owned.map(({ id }) => id) } },
    });
    await prisma.promotion.deleteMany({
      where: { id: { in: owned.map(({ id }) => id) } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: users.map(({ id }) => id) } },
    });
    await database.close();
  });
  return {
    prisma,
    media,
    app,
    admin: users[1],
    adminToken: sessions[1].data.accessToken,
    customerToken: sessions[0].data.accessToken,
  };
}
const valid = {
  title: 'Autumn table',
  subtitle: 'Warm pieces',
  internalHref: '/category/tabletop',
  placement: 'HERO_PRIMARY',
  sortOrder: 2,
  startsAt: '2026-09-21T00:00:00.000Z',
  endsAt: '2026-10-01T00:00:00.000Z',
};
const auth = (req, token) => req.set('Authorization', bearer(token));

test('promotion API enforces Admin RBAC, strict validation, and creator attribution', async (t) => {
  const c = await setup(t);
  await request(c.app).get('/api/v1/admin/promotions').expect(401);
  await auth(
    request(c.app).get('/api/v1/admin/promotions'),
    c.customerToken,
  ).expect(403);
  for (const body of [
    { ...valid, placement: 'SIDEBAR' },
    { ...valid, internalHref: 'https://evil.test' },
    { ...valid, internalHref: '//evil.test' },
    { ...valid, endsAt: valid.startsAt },
    { ...valid, status: 'ACTIVE' },
    { ...valid, sortOrder: -1 },
  ])
    assert.equal(
      (
        await auth(
          request(c.app).post('/api/v1/admin/promotions').send(body),
          c.adminToken,
        )
      ).status,
      422,
    );
  const created = await auth(
    request(c.app).post('/api/v1/admin/promotions').send(valid),
    c.adminToken,
  ).expect(201);
  assert.equal(created.body.data.status, 'DRAFT');
  assert.equal(created.body.data.createdBy.id, c.admin.id);
  await auth(
    request(c.app)
      .patch('/api/v1/admin/promotions/' + created.body.data.id)
      .send({ imageUrl: 'https://evil.test/a.jpg' }),
    c.adminToken,
  ).expect(422);
});

test('promotion schedule, status, archive retention, ordering, and homepage visibility remain compatible', async (t) => {
  const c = await setup(t);
  const [{ now }] = await c.prisma
    .$queryRaw`SELECT transaction_timestamp() AS now`;
  const activeWindow = {
    startsAt: new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString(),
    endsAt: new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString(),
  };
  const create = async (data) =>
    (
      await auth(
        request(c.app).post('/api/v1/admin/promotions').send(data),
        c.adminToken,
      ).expect(201)
    ).body.data;
  const first = await create({
    ...valid,
    ...activeWindow,
    title: 'First',
    sortOrder: 0,
  });
  const second = await create({
    ...valid,
    ...activeWindow,
    title: 'Second',
    sortOrder: 0,
    startsAt: new Date(now.getTime() - 60 * 60 * 1000).toISOString(),
  });
  await auth(
    request(c.app).post('/api/v1/admin/promotions/' + first.id + '/publish'),
    c.adminToken,
  ).expect(200);
  await auth(
    request(c.app).post('/api/v1/admin/promotions/' + second.id + '/publish'),
    c.adminToken,
  ).expect(200);
  const list = await auth(
    request(c.app).get('/api/v1/admin/promotions?placement=HERO_PRIMARY'),
    c.adminToken,
  ).expect(200);
  const createdOrder = list.body.data
    .filter((row) => [first.id, second.id].includes(row.id))
    .map((row) => row.title);
  assert.deepEqual(createdOrder, ['Second', 'First']);
  const homepage = await request(c.app).get('/api/v1/homepage').expect(200);
  assert.equal(
    homepage.body.data.promotions.some((x) => x.id === first.id),
    true,
  );
  await c.prisma.promotion.update({
    where: { id: first.id },
    data: {
      imagePublicId: 'marthub/promotions/' + first.id + '/kept',
      imageUrl: 'https://res.cloudinary.test/kept',
    },
  });
  const before = await c.prisma.mediaCleanup.count({
    where: { promotionId: first.id },
  });
  const archived = await auth(
    request(c.app).post('/api/v1/admin/promotions/' + first.id + '/archive'),
    c.adminToken,
  ).expect(200);
  assert.equal(
    archived.body.data.image.publicId,
    'marthub/promotions/' + first.id + '/kept',
  );
  assert.equal(
    await c.prisma.mediaCleanup.count({ where: { promotionId: first.id } }),
    before,
  );
  const hidden = await request(c.app).get('/api/v1/homepage').expect(200);
  assert.equal(
    hidden.body.data.promotions.some((x) => x.id === first.id),
    false,
  );
});

test('promotion media signs, verifies exact policy, registers, replaces, removes, and retains durable failure truth', async (t) => {
  const c = await setup(t);
  const promotion = (
    await auth(
      request(c.app).post('/api/v1/admin/promotions').send(valid),
      c.adminToken,
    ).expect(201)
  ).body.data;
  await request(c.app)
    .post('/api/v1/admin/promotions/' + promotion.id + '/media/signature')
    .expect(401);
  const signed = (
    await auth(
      request(c.app).post(
        '/api/v1/admin/promotions/' + promotion.id + '/media/signature',
      ),
      c.adminToken,
    ).expect(200)
  ).body.data;
  assert.equal(signed.parameters.max_file_size, 4194304);
  assert.equal(signed.parameters.allowed_formats, 'jpg,png,webp');
  assert.equal('apiSecret' in signed, false);
  const register = {
    publicId: signed.parameters.public_id,
    uploadTimestamp: signed.parameters.timestamp,
    uploadSignature: signed.parameters.signature,
  };
  const attached = await auth(
    request(c.app)
      .post('/api/v1/admin/promotions/' + promotion.id + '/media')
      .send(register),
    c.adminToken,
  ).expect(201);
  assert.ok(
    attached.body.data.image.url.includes('f_auto,q_auto,c_limit,w_1200'),
  );
  const second = (
    await auth(
      request(c.app).post(
        '/api/v1/admin/promotions/' + promotion.id + '/media/signature',
      ),
      c.adminToken,
    ).expect(200)
  ).body.data;
  c.media.failures.add(register.publicId);
  await auth(
    request(c.app)
      .post('/api/v1/admin/promotions/' + promotion.id + '/media')
      .send({
        publicId: second.parameters.public_id,
        uploadTimestamp: second.parameters.timestamp,
        uploadSignature: second.parameters.signature,
      }),
    c.adminToken,
  ).expect(201);
  const cleanup = await c.prisma.mediaCleanup.findUniqueOrThrow({
    where: { cloudinaryPublicId: register.publicId },
  });
  assert.equal(cleanup.ownerType, 'PROMOTION_MEDIA');
  assert.equal(cleanup.status, 'PENDING');
  assert.equal(cleanup.attemptCount, 1);
  c.media.failures.add(second.parameters.public_id);
  const removed = await auth(
    request(c.app).delete(
      '/api/v1/admin/promotions/' + promotion.id + '/media',
    ),
    c.adminToken,
  ).expect(202);
  assert.equal(removed.body.data.status, 'PENDING');
  assert.equal(
    (
      await c.prisma.promotion.findUniqueOrThrow({
        where: { id: promotion.id },
      })
    ).imagePublicId,
    null,
  );
});

test('provider metadata and cleanup ownership constraints reject unsafe states', async (t) => {
  const c = await setup(t);
  const promotion = (
    await auth(
      request(c.app).post('/api/v1/admin/promotions').send(valid),
      c.adminToken,
    ).expect(201)
  ).body.data;
  const signed = (
    await auth(
      request(c.app).post(
        '/api/v1/admin/promotions/' + promotion.id + '/media/signature',
      ),
      c.adminToken,
    ).expect(200)
  ).body.data;
  c.media.resources.set(signed.parameters.public_id, {
    public_id: signed.parameters.public_id,
    format: 'gif',
    bytes: 1,
    width: 1,
    height: 1,
    resource_type: 'image',
    type: 'upload',
  });
  await auth(
    request(c.app)
      .post('/api/v1/admin/promotions/' + promotion.id + '/media')
      .send({
        publicId: signed.parameters.public_id,
        uploadTimestamp: signed.parameters.timestamp,
        uploadSignature: signed.parameters.signature,
      }),
    c.adminToken,
  ).expect(422);
  assert.equal(
    (
      await c.prisma.promotion.findUniqueOrThrow({
        where: { id: promotion.id },
      })
    ).imagePublicId,
    null,
  );
  const oversized = (
    await auth(
      request(c.app).post(
        '/api/v1/admin/promotions/' + promotion.id + '/media/signature',
      ),
      c.adminToken,
    ).expect(200)
  ).body.data;
  c.media.resources.set(oversized.parameters.public_id, {
    public_id: oversized.parameters.public_id,
    format: 'webp',
    bytes: 4194305,
    width: 1200,
    height: 600,
    resource_type: 'image',
    type: 'upload',
  });
  await auth(
    request(c.app)
      .post('/api/v1/admin/promotions/' + promotion.id + '/media')
      .send({
        publicId: oversized.parameters.public_id,
        uploadTimestamp: oversized.parameters.timestamp,
        uploadSignature: oversized.parameters.signature,
      }),
    c.adminToken,
  ).expect(422);
  await assert.rejects(
    c.prisma.mediaCleanup.create({
      data: {
        ownerType: 'PROMOTION_MEDIA',
        promotionId: promotion.id,
        productId: randomUUID(),
        productImageId: randomUUID(),
        cloudinaryPublicId: 'bad/' + randomUUID(),
      },
    }),
  );
});
test('promotion cleanup applies bounded durable retries and explicit operator restart', async (t) => {
  const context = await setup(t);
  const promotion = await context.prisma.promotion.create({
    data: {
      title: 'Cleanup',
      internalHref: '/categories',
      placement: 'EDITORIAL',
      startsAt: new Date(),
      createdByUserId: context.admin.id,
    },
  });
  const publicId = 'marthub/promotions/' + promotion.id + '/retry';
  context.media.failures.add(publicId);
  await context.prisma.mediaCleanup.create({
    data: {
      ownerType: 'PROMOTION_MEDIA',
      promotionId: promotion.id,
      cloudinaryPublicId: publicId,
      nextAttemptAt: new Date(0),
    },
  });
  for (let attempt = 0; attempt < 5; attempt += 1)
    await processDueMediaCleanup({
      prisma: context.prisma,
      media: context.media,
      now: new Date(Date.now() + attempt * 4_000_000),
    });
  let task = await context.prisma.mediaCleanup.findUniqueOrThrow({
    where: { cloudinaryPublicId: publicId },
  });
  assert.equal(task.status, 'FAILED');
  assert.equal(task.attemptCount, 5);
  context.media.failures.delete(publicId);
  await processDueMediaCleanup({
    prisma: context.prisma,
    media: context.media,
    now: new Date(Date.now() + 30_000_000),
    retryFailed: true,
  });
  task = await context.prisma.mediaCleanup.findUniqueOrThrow({
    where: { cloudinaryPublicId: publicId },
  });
  assert.equal(task.status, 'COMPLETED');
  assert.equal(task.attemptCount, 1);
});
