import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import test from 'node:test';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { createDatabase } from '../../src/db/client.js';
import { validateDatabaseUrl } from '../../src/config/env.js';
import { readAuthConfig } from '../../src/config/auth.js';
import {
  createSessionService,
  hashRefreshToken,
} from '../../src/modules/auth/sessions.js';
import {
  signAccessToken,
  verifyAccessToken,
} from '../../src/modules/auth/tokens.js';
import {
  requireAuthentication,
  requireRoles,
  ownedWhere,
  ownedResourceId,
  requireOwnedResource,
} from '../../src/modules/auth/authorization.js';

const config = readAuthConfig({
  AUTH_JWT_SECRET: randomBytes(32).toString('hex'),
  WEB_ORIGIN: 'https://shop.example.test',
  NODE_ENV: 'production',
});
async function setup(t) {
  const database = createDatabase(
    validateDatabaseUrl(process.env.DATABASE_URL),
  );
  const { prisma } = database;
  const users = await Promise.all(
    ['CUSTOMER', 'ADMIN'].map((role) =>
      prisma.user.create({
        data: {
          email: `authorization-${randomUUID()}@example.test`,
          passwordHash: 'unused-test-hash',
          firstName: 'Authorization',
          lastName: 'Test',
          role,
        },
      }),
    ),
  );
  t.after(async () => {
    await prisma.user.deleteMany({
      where: { id: { in: users.map((u) => u.id) } },
    });
    await database.close();
  });
  const authenticate = requireAuthentication({ prisma, config });
  const app = createApp({
    prisma,
    authConfig: config,
    origin: config.origin,
    logger: () => {},
    configureRouter(router) {
      router.get('/test/protected', authenticate, (req, res) =>
        res.json({ data: req.auth.user }),
      );
      router.get(
        '/test/admin',
        authenticate,
        requireRoles('ADMIN'),
        (req, res) => res.json({ data: { id: req.auth.user.id } }),
      );
      router.get('/test/owned/:id', authenticate, async (req, res) => {
        const row = requireOwnedResource(
          await prisma.refreshSession.findFirst({
            where: ownedWhere(req.auth, {
              id: ownedResourceId(req.params.id),
              ...(req.query.userId ? { userId: req.query.userId } : {}),
            }),
            select: { id: true },
          }),
        );
        res.json({ data: row });
      });
    },
  });
  return {
    prisma,
    users,
    app,
    sessions: createSessionService({ prisma, config }),
  };
}
const bearer = (token) => 'Bearer ' + token;
const cookie = (token) => 'mh_refresh=' + token;

test('authorization matrix enforces database session ownership, expiry, status and current role', async (t) => {
  const {
    prisma,
    users: [customer, admin],
    app,
    sessions,
  } = await setup(t);
  const customerSession = await sessions.issue(customer.id);
  const adminSession = await sessions.issue(admin.id);
  const customerClaims = await verifyAccessToken(
    customerSession.data.accessToken,
    config,
  );
  await request(app).get('/api/v1/test/protected').expect(401);
  await request(app)
    .get('/api/v1/test/protected')
    .set('Authorization', 'Bearer invalid')
    .expect(401);
  const read = await request(app)
    .get('/api/v1/test/protected')
    .set('Authorization', bearer(customerSession.data.accessToken))
    .expect(200);
  assert.match(read.headers['cache-control'], /no-store/);
  assert.equal(read.body.data.id, customer.id);
  assert.equal(Object.hasOwn(read.body.data, 'passwordHash'), false);
  await request(app)
    .get('/api/v1/test/admin')
    .set('Authorization', bearer(customerSession.data.accessToken))
    .expect(403);
  await request(app)
    .get('/api/v1/test/admin')
    .set('Authorization', bearer(adminSession.data.accessToken))
    .expect(200);
  await prisma.user.update({
    where: { id: admin.id },
    data: { role: 'CUSTOMER' },
  });
  await request(app)
    .get('/api/v1/test/admin')
    .set('Authorization', bearer(adminSession.data.accessToken))
    .expect(403);
  const forged = await signAccessToken(admin, customerClaims.sid, config);
  await request(app)
    .get('/api/v1/test/protected')
    .set('Authorization', bearer(forged))
    .expect(401);
  const expired = await signAccessToken(
    customer,
    customerClaims.sid,
    config,
    new Date(Date.now() - 901000),
  );
  await request(app)
    .get('/api/v1/test/protected')
    .set('Authorization', bearer(expired))
    .expect(401);
  for (const status of ['SUSPENDED', 'ARCHIVED']) {
    await prisma.user.update({ where: { id: customer.id }, data: { status } });
    await request(app)
      .get('/api/v1/test/protected')
      .set('Authorization', bearer(customerSession.data.accessToken))
      .expect(401);
  }
  await prisma.user.update({
    where: { id: customer.id },
    data: { status: 'ACTIVE', archivedAt: new Date() },
  });
  await request(app)
    .get('/api/v1/test/protected')
    .set('Authorization', bearer(customerSession.data.accessToken))
    .expect(401);
  await prisma.user.update({
    where: { id: customer.id },
    data: { archivedAt: null },
  });
  await prisma.refreshSession.update({
    where: { id: customerClaims.sid },
    data: { expiresAt: new Date(0) },
  });
  await request(app)
    .get('/api/v1/test/protected')
    .set('Authorization', bearer(customerSession.data.accessToken))
    .expect(401);
  await prisma.refreshSession.update({
    where: { id: customerClaims.sid },
    data: { expiresAt: new Date(Date.now() + 60000), revokedAt: new Date() },
  });
  await request(app)
    .get('/api/v1/test/protected')
    .set('Authorization', bearer(customerSession.data.accessToken))
    .expect(401);
});

test('owned queries conceal foreign resources and cannot be widened by a supplied user ID', async (t) => {
  const {
    users: [customer, other],
    app,
    sessions,
  } = await setup(t);
  const own = await sessions.issue(customer.id),
    foreign = await sessions.issue(other.id);
  const ownId = (await verifyAccessToken(own.data.accessToken, config)).sid;
  const foreignId = (await verifyAccessToken(foreign.data.accessToken, config))
    .sid;
  await request(app)
    .get('/api/v1/test/owned/' + ownId)
    .set('Authorization', bearer(own.data.accessToken))
    .expect(200);
  for (const id of [foreignId, randomUUID(), 'not-a-uuid'])
    await request(app)
      .get('/api/v1/test/owned/' + id)
      .set('Authorization', bearer(own.data.accessToken))
      .expect(404);
  await request(app)
    .get('/api/v1/test/owned/' + foreignId)
    .query({ userId: other.id })
    .set('Authorization', bearer(own.data.accessToken))
    .expect(404);
});

test('logout is origin-protected, strict, idempotent and revokes the entire cookie family only', async (t) => {
  const {
    prisma,
    users: [user],
    app,
    sessions,
  } = await setup(t);
  const original = await sessions.issue(user.id),
    other = await sessions.issue(user.id);
  const rotated = await sessions.rotate(original.refreshToken);
  await request(app)
    .post('/api/v1/auth/logout')
    .set('Cookie', cookie(original.refreshToken))
    .expect(403);
  for (const body of [[], { userId: user.id }])
    await request(app)
      .post('/api/v1/auth/logout')
      .set('Origin', config.origin)
      .send(body)
      .expect(422);
  for (let i = 0; i < 2; i++) {
    const out = await request(app)
      .post('/api/v1/auth/logout')
      .set('Origin', config.origin)
      .set('Cookie', cookie(original.refreshToken))
      .expect(204);
    assert.match(out.headers['cache-control'], /no-store/);
    assert.ok(
      out.headers['set-cookie'].some(
        (value) =>
          /mh_refresh=;/.test(value) &&
          /HttpOnly/.test(value) &&
          /Secure/.test(value) &&
          /SameSite=Lax/.test(value) &&
          /Path=\/api\/v1\/auth/.test(value),
      ),
    );
  }
  await request(app)
    .get('/api/v1/test/protected')
    .set('Authorization', bearer(rotated.data.accessToken))
    .expect(401);
  await assert.rejects(sessions.rotate(rotated.refreshToken), { status: 401 });
  assert.ok(await sessions.rotate(other.refreshToken));
  await request(app)
    .post('/api/v1/auth/logout')
    .set('Origin', config.origin)
    .expect(204);
  const current = await prisma.refreshSession.findUnique({
    where: { tokenHash: hashRefreshToken(rotated.refreshToken) },
  });
  assert.equal(current.revokeReason, 'LOGOUT');
});

test('logout-all revokes every own family, denies missing bearer and preserves other users', async (t) => {
  const {
    prisma,
    users: [user, other],
    app,
    sessions,
  } = await setup(t);
  const first = await sessions.issue(user.id),
    second = await sessions.issue(user.id),
    foreign = await sessions.issue(other.id);
  await request(app)
    .post('/api/v1/auth/logout-all')
    .set('Origin', config.origin)
    .expect(401);
  await request(app)
    .post('/api/v1/auth/logout-all')
    .set('Authorization', bearer(first.data.accessToken))
    .expect(403);
  await request(app)
    .post('/api/v1/auth/logout-all')
    .set('Origin', config.origin)
    .set('Authorization', bearer(first.data.accessToken))
    .send({ userId: other.id })
    .expect(422);
  const result = await request(app)
    .post('/api/v1/auth/logout-all')
    .set('Origin', config.origin)
    .set('Authorization', bearer(first.data.accessToken))
    .send({})
    .expect(204);
  assert.match(result.headers['cache-control'], /no-store/);
  assert.ok(result.headers['set-cookie']);
  assert.equal(
    await prisma.refreshSession.count({
      where: { userId: user.id, revokedAt: null },
    }),
    0,
  );
  await assert.rejects(sessions.rotate(second.refreshToken), { status: 401 });
  await request(app)
    .get('/api/v1/test/protected')
    .set('Authorization', bearer(first.data.accessToken))
    .expect(401);
  await request(app)
    .get('/api/v1/test/protected')
    .set('Authorization', bearer(foreign.data.accessToken))
    .expect(200);
});

test('logout and logout-all serialize with refresh so no live successor survives', async (t) => {
  const {
    prisma,
    users: [user],
    app,
    sessions,
  } = await setup(t);
  for (const all of [false, true]) {
    const current = await sessions.issue(user.id);
    const logout = request(app)
      .post('/api/v1/auth/' + (all ? 'logout-all' : 'logout'))
      .set('Origin', config.origin)
      .set('Cookie', cookie(current.refreshToken));
    // A separate family supplies logout-all credentials, so rotation cannot invalidate that request.
    if (all)
      logout.set(
        'Authorization',
        bearer((await sessions.issue(user.id)).data.accessToken),
      );
    const outcomes = await Promise.allSettled([
      logout.expect(204),
      sessions.rotate(current.refreshToken),
    ]);
    assert.equal(outcomes[0].status, 'fulfilled');
    assert.equal(
      await prisma.refreshSession.count({
        where: { userId: user.id, revokedAt: null },
      }),
      0,
    );
  }
});
