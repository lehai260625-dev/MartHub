import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import test from 'node:test';
import request from 'supertest';
import { createDatabase } from '../../src/db/client.js';
import { validateDatabaseUrl } from '../../src/config/env.js';
import { readAuthConfig } from '../../src/config/auth.js';
import { createApp } from '../../src/app.js';
import { createSessionService } from '../../src/modules/auth/sessions.js';
import { verifyAccessToken } from '../../src/modules/auth/tokens.js';
import { throttleKey } from '../../src/modules/auth/throttle.js';

const config = readAuthConfig({
  AUTH_JWT_SECRET: randomBytes(32).toString('hex'),
  WEB_ORIGIN: 'https://shop.example.test',
  NODE_ENV: 'production',
});
const hash = (token) => createHash('sha256').update(token).digest('hex');

async function fixture(t) {
  const database = createDatabase(
    validateDatabaseUrl(process.env.DATABASE_URL),
  );
  const user = await database.prisma.user.create({
    data: {
      email: `session-${randomUUID()}@example.test`,
      passwordHash: 'unused-test-hash',
      firstName: 'Session',
      lastName: 'Test',
    },
  });
  t.after(async () => {
    await database.prisma.user.delete({ where: { id: user.id } });
    await database.close();
  });
  return {
    ...database,
    user,
    sessions: createSessionService({ prisma: database.prisma, config }),
  };
}

test('opaque refresh tokens are hashed, rotate once, and replay revokes only their family', async (t) => {
  const { prisma, user, sessions } = await fixture(t);
  const issued = await sessions.issue(user.id, {
    ip: '127.0.0.1',
    userAgent: 'Session test',
  });
  assert.ok(Buffer.from(issued.refreshToken, 'base64url').length >= 32);
  assert.equal(issued.data.expiresIn, 900);
  assert.equal(issued.data.user.id, user.id);
  assert.equal(Object.hasOwn(issued.data.user, 'passwordHash'), false);
  const parent = await prisma.refreshSession.findUnique({
    where: { tokenHash: hash(issued.refreshToken) },
    select: {
      id: true,
      tokenHash: true,
      familyId: true,
      revokedAt: true,
      expiresAt: true,
    },
  });
  assert.equal(parent.tokenHash, hash(issued.refreshToken));
  assert.notEqual(parent.tokenHash, issued.refreshToken);
  assert.equal(parent.revokedAt, null);
  assert.equal(parent.expiresAt.getTime(), issued.expiresAt.getTime());
  const otherFamily = await sessions.issue(user.id);
  const rotated = await sessions.rotate(issued.refreshToken);
  assert.notEqual(rotated.refreshToken, issued.refreshToken);
  const child = await prisma.refreshSession.findUnique({
    where: { tokenHash: hash(rotated.refreshToken) },
  });
  assert.equal(child.parentSessionId, parent.id);
  assert.equal(child.familyId, parent.familyId);
  assert.ok(
    (await prisma.refreshSession.findUnique({ where: { id: parent.id } }))
      .revokedAt,
  );
  assert.equal(
    (await verifyAccessToken(rotated.data.accessToken, config)).sid,
    child.id,
  );
  await assert.rejects(sessions.rotate(issued.refreshToken), { status: 401 });
  assert.equal(
    await prisma.refreshSession.count({
      where: { familyId: parent.familyId, revokedAt: null },
    }),
    0,
  );
  await assert.rejects(sessions.rotate(rotated.refreshToken), { status: 401 });
  assert.ok((await sessions.rotate(otherFamily.refreshToken)).data.accessToken);
});

test('parallel refresh and replay cannot leave a live successor in the compromised family', async (t) => {
  const { prisma, user, sessions } = await fixture(t);
  const original = await sessions.issue(user.id);
  const pair = await Promise.allSettled([
    sessions.rotate(original.refreshToken),
    sessions.rotate(original.refreshToken),
  ]);
  assert.equal(
    pair.filter((outcome) => outcome.status === 'fulfilled').length,
    1,
  );
  assert.equal(
    pair.find((outcome) => outcome.status === 'rejected').reason.status,
    401,
  );
  assert.equal(
    await prisma.refreshSession.count({
      where: { userId: user.id, revokedAt: null },
    }),
    0,
  );
  const fresh = await sessions.issue(user.id);
  const successor = await sessions.rotate(fresh.refreshToken);
  await Promise.allSettled([
    sessions.rotate(successor.refreshToken),
    sessions.rotate(fresh.refreshToken),
  ]);
  const family = await prisma.refreshSession.findUnique({
    where: { tokenHash: hash(fresh.refreshToken) },
  });
  assert.equal(
    await prisma.refreshSession.count({
      where: { familyId: family.familyId, revokedAt: null },
    }),
    0,
  );
});

test('refresh rejects expired, unknown, suspended, and archived sessions', async (t) => {
  const { prisma, user, sessions } = await fixture(t);
  const expired = await sessions.issue(user.id);
  await prisma.refreshSession.update({
    where: { tokenHash: hash(expired.refreshToken) },
    data: { expiresAt: new Date(0) },
  });
  await assert.rejects(sessions.rotate(expired.refreshToken), { status: 401 });
  await assert.rejects(sessions.rotate(randomBytes(32).toString('base64url')), {
    status: 401,
  });
  for (const status of ['SUSPENDED', 'ARCHIVED']) {
    await prisma.user.update({
      where: { id: user.id },
      data: { status: 'ACTIVE' },
    });
    const issued = await sessions.issue(user.id);
    await prisma.user.update({ where: { id: user.id }, data: { status } });
    await assert.rejects(sessions.rotate(issued.refreshToken), { status: 401 });
    await assert.rejects(sessions.issue(user.id), { status: 401 });
  }
});

test('refresh rotations preserve absolute family expiry and revoke at its exact boundary', async (t) => {
  const { prisma, user } = await fixture(t);
  let now = new Date('2026-10-05T00:00:00Z');
  const sessions = createSessionService({ prisma, config, clock: () => now });
  const original = await sessions.issue(user.id);
  const expiresAt = original.expiresAt.getTime();
  now = new Date(now.getTime() + 86400000);
  const rotated = await sessions.rotate(original.refreshToken);
  now = new Date(expiresAt - 1000);
  const last = await sessions.rotate(rotated.refreshToken);
  assert.equal(last.expiresAt.getTime(), expiresAt);
  const rows = await prisma.refreshSession.findMany({
    where: { userId: user.id },
  });
  assert.equal(rows.length, 3);
  assert.ok(rows.every((row) => row.expiresAt.getTime() === expiresAt));
  now = new Date(expiresAt);
  await assert.rejects(sessions.rotate(last.refreshToken), {
    status: 401,
    code: 'UNAUTHORIZED',
  });
  const final = await prisma.refreshSession.findUnique({
    where: { tokenHash: hash(last.refreshToken) },
  });
  assert.equal(final.revokeReason, 'EXPIRED');
  assert.equal(final.revokedAt.getTime(), expiresAt);
  assert.equal(
    await prisma.refreshSession.count({
      where: { userId: user.id, revokedAt: null },
    }),
    0,
  );
});

test('successor persistence failure rolls back parent rotation and permits one safe retry', async (t) => {
  const { prisma, user, sessions } = await fixture(t);
  const issued = await sessions.issue(user.id);
  const before = await prisma.refreshSession.findUnique({
    where: { tokenHash: hash(issued.refreshToken) },
  });
  let inserted = 0;
  const failing = new Proxy(prisma, {
    get(target, field) {
      if (field !== '$transaction') return target[field];
      return (callback) =>
        target.$transaction((tx) =>
          callback(
            new Proxy(tx, {
              get(transaction, model) {
                if (model !== 'refreshSession') return transaction[model];
                return new Proxy(transaction.refreshSession, {
                  get(delegate, operation) {
                    if (operation !== 'create') return delegate[operation];
                    return async (args) => {
                      await delegate.create(args);
                      inserted += 1;
                      throw new Error('Injected successor persistence failure');
                    };
                  },
                });
              },
            }),
          ),
        );
    },
  });
  await assert.rejects(
    createSessionService({ prisma: failing, config }).rotate(
      issued.refreshToken,
    ),
    /Injected successor persistence failure/,
  );
  assert.equal(inserted, 1);
  assert.deepEqual(
    await prisma.refreshSession.findUnique({ where: { id: before.id } }),
    before,
  );
  assert.equal(
    await prisma.refreshSession.count({ where: { familyId: before.familyId } }),
    1,
  );
  const retry = await sessions.rotate(issued.refreshToken);
  const rows = await prisma.refreshSession.findMany({
    where: { familyId: before.familyId },
  });
  assert.equal(rows.length, 2);
  assert.equal(rows.filter((row) => row.revokedAt === null).length, 1);
  const successorId = (await verifyAccessToken(retry.data.accessToken, config))
    .sid;
  assert.equal(
    rows.find((row) => row.id === successorId).parentSessionId,
    before.id,
  );
});

test('HTTP auth enforces origin, production cookie scope, secret exclusion, rotation and no-store', async () => {
  const database = createDatabase(
    validateDatabaseUrl(process.env.DATABASE_URL),
  );
  const { prisma } = database;
  const email = `http-session-${randomUUID()}@example.test`;
  const input = {
    email,
    password: 'Correct horse battery staple',
    firstName: 'HTTP',
    lastName: 'Session',
  };
  const app = createApp({
    prisma,
    authConfig: config,
    readiness: database.ready,
    origin: config.origin,
    logger: () => {},
  });
  const cookieValue = (response) =>
    response.headers['set-cookie']
      .find((value) => value.startsWith('mh_refresh='))
      .split(';')[0];
  const checkResponse = (response) => {
    assert.match(response.headers['cache-control'], /no-store/);
    assert.equal(response.body.data.expiresIn, 900);
    assert.equal(response.body.data.user.email, email);
    assert.deepEqual(Object.keys(response.body.data).sort(), [
      'accessToken',
      'expiresIn',
      'user',
    ]);
    assert.equal(Object.hasOwn(response.body.data.user, 'passwordHash'), false);
    const cookie = response.headers['set-cookie'].find((value) =>
      value.startsWith('mh_refresh='),
    );
    assert.match(cookie, /; HttpOnly/i);
    assert.match(cookie, /; Secure/i);
    assert.match(cookie, /; SameSite=Lax/i);
    assert.match(cookie, /; Path=\/api\/v1\/auth(?:;|$)/i);
    assert.doesNotMatch(cookie, /; Domain=/i);
    assert.equal(
      JSON.stringify(response.body).includes(
        cookieValue(response).slice('mh_refresh='.length),
      ),
      false,
    );
  };
  try {
    for (const endpoint of ['register', 'login', 'refresh']) {
      await request(app)
        .post(`/api/v1/auth/${endpoint}`)
        .send(endpoint === 'refresh' ? {} : input)
        .expect(403);
      await request(app)
        .post(`/api/v1/auth/${endpoint}`)
        .set('Origin', 'https://evil.example.test')
        .send({})
        .expect(403);
    }
    const forbidden = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Origin', 'https://evil.example.test')
      .send({})
      .expect(403);
    assert.match(forbidden.headers['cache-control'], /no-store/);
    const malformed = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Origin', config.origin)
      .set('Content-Type', 'application/json')
      .send('{')
      .expect(400);
    assert.match(malformed.headers['cache-control'], /no-store/);
    await request(app)
      .post('/api/v1/auth/refresh')
      .set('Origin', config.origin)
      .send([])
      .expect(422);
    const registered = await request(app)
      .post('/api/v1/auth/register')
      .set('Origin', config.origin)
      .send(input)
      .expect(201);
    checkResponse(registered);
    const loggedIn = await request(app)
      .post('/api/v1/auth/login')
      .set('Origin', config.origin)
      .send({ email, password: input.password })
      .expect(200);
    checkResponse(loggedIn);
    const refreshed = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Origin', config.origin)
      .set('Cookie', cookieValue(loggedIn))
      .send({})
      .expect(200);
    checkResponse(refreshed);
    assert.notEqual(cookieValue(refreshed), cookieValue(loggedIn));
    const replay = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Origin', config.origin)
      .set('Cookie', cookieValue(loggedIn))
      .send({})
      .expect(401);
    assert.match(replay.headers['cache-control'], /no-store/);
    await request(app)
      .post('/api/v1/auth/refresh')
      .set('Origin', config.origin)
      .set('Cookie', cookieValue(refreshed))
      .send({})
      .expect(401);
    await request(app)
      .post('/api/v1/auth/refresh')
      .set('Origin', config.origin)
      .send({})
      .expect(401);
  } finally {
    await prisma.user.deleteMany({ where: { email } });
    await prisma.authThrottle.deleteMany({
      where: {
        key: {
          in: ['register', 'login'].map((operation) =>
            throttleKey(operation, 'email', email),
          ),
        },
      },
    });
    await database.close();
  }
});
