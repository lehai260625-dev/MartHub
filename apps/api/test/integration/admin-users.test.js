import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import test from 'node:test';
import request from 'supertest';
import {
  adminUserListResponseSchema,
  adminUserDetailResponseSchema,
} from '@marthub/contracts';
import { createApp } from '../../src/app.js';
import { readAuthConfig } from '../../src/config/auth.js';
import { createDatabase } from '../../src/db/client.js';
import { validateDatabaseUrl } from '../../src/config/env.js';
import { createSessionService } from '../../src/modules/auth/sessions.js';
import { createAdminUserService } from '../../src/modules/admin/users.js';

const config = readAuthConfig({
  AUTH_JWT_SECRET: randomBytes(32).toString('hex'),
  WEB_ORIGIN: 'https://shop.example.test',
  NODE_ENV: 'production',
});
async function fixture(t) {
  const database = createDatabase(
    validateDatabaseUrl(process.env.DATABASE_URL),
  );
  t.after(() => database.close());
  const { prisma } = database;
  const suffix = randomUUID();
  const createUser = (overrides = {}) =>
    prisma.user.create({
      data: {
        email: `user-${randomUUID()}-${suffix}@example.test`,
        passwordHash: 'private-password-hash',
        firstName: 'Original',
        lastName: 'Customer',
        ...overrides,
      },
    });
  const admin = await createUser({ role: 'ADMIN' });
  const otherAdmin = await createUser({ role: 'ADMIN' });
  const customer = await createUser();
  const sessions = createSessionService({ prisma, config });
  const a = await sessions.issue(admin.id);
  const b = await sessions.issue(otherAdmin.id);
  const c = await sessions.issue(customer.id);
  const makeApp = (db = prisma) =>
    createApp({
      prisma: db,
      authConfig: config,
      origin: config.origin,
      logger: () => {},
    });
  const app = makeApp();
  const get = (path, token = a.data.accessToken) =>
    request(app)
      .get('/api/v1/admin/users' + path)
      .set('Authorization', `Bearer ${token}`);
  const change = (id, body, token = a.data.accessToken, target = app) =>
    request(target)
      .patch(`/api/v1/admin/users/${id}/status`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Request-Id', randomUUID())
      .send(body);
  const state = async (id) => ({
    user: await prisma.user.findUnique({ where: { id } }),
    sessions: await prisma.refreshSession.findMany({
      where: { userId: id },
      orderBy: { id: 'asc' },
    }),
    audits: await prisma.adminAuditLog.findMany({
      where: { entityType: 'USER', entityId: id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    }),
  });
  return {
    prisma,
    suffix,
    admin,
    otherAdmin,
    customer,
    sessions,
    a,
    b,
    c,
    app,
    makeApp,
    get,
    change,
    createUser,
    state,
  };
}
function wrap(prisma, transform) {
  return new Proxy(prisma, {
    get(target, key) {
      return key === '$transaction'
        ? (callback, options) =>
            prisma.$transaction((tx) => callback(transform(tx)), options)
        : target[key];
    },
  });
}
function competing(prisma) {
  let arrived = 0,
    release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  return wrap(
    prisma,
    (tx) =>
      new Proxy(tx, {
        get(target, key) {
          if (key !== '$queryRaw') return target[key];
          return async (...args) => {
            if (
              (args[0].strings ?? args[0]).join('').includes('FOR UPDATE') &&
              arrived < 2
            ) {
              if (++arrived === 2) release();
              await gate;
            }
            return tx.$queryRaw(...args);
          };
        },
      }),
  );
}
test('User reads/status enforce Admin RBAC and exact safe projection including archived records', async (t) => {
  const f = await fixture(t);
  const body = {
    expectedStatus: 'ACTIVE',
    toStatus: 'SUSPENDED',
    reason: 'Review',
  };
  for (const path of ['', `/${f.customer.id}`]) {
    await request(f.app)
      .get('/api/v1/admin/users' + path)
      .expect(401);
    await f.get(path, f.c.data.accessToken).expect(403);
    const response = await f.get(path).expect(200);
    assert.match(response.headers['cache-control'], /no-store/);
  }
  await request(f.app)
    .patch(`/api/v1/admin/users/${f.customer.id}/status`)
    .send(body)
    .expect(401);
  await f.change(f.admin.id, body, f.c.data.accessToken).expect(403);
  const detail = (await f.get(`/${f.customer.id}`).expect(200)).body;
  assert.ok(adminUserDetailResponseSchema.safeParse(detail).success);
  assert.deepEqual(
    Object.keys(detail.data).sort(),
    [
      'id',
      'email',
      'firstName',
      'lastName',
      'role',
      'status',
      'createdAt',
      'updatedAt',
      'archivedAt',
    ].sort(),
  );
  for (const field of [
    'passwordHash',
    'refreshSessions',
    'phone',
    'lastLoginAt',
    'addresses',
    'orders',
    'cart',
    'tokenHash',
  ])
    assert.equal(JSON.stringify(detail).includes(`"${field}"`), false);
  await f.get('/malformed').expect(404);
  await f.get(`/${randomUUID()}`).expect(404);
  await f.get(`/${f.customer.id}?extra=true`).expect(422);
});
test('User list search, filters, all sort directions, normalization and pagination are deterministic', async (t) => {
  const f = await fixture(t);
  const tied = new Date('2026-01-01T00:00:00Z');
  const rows = [];
  for (let i = 0; i < 22; i++)
    rows.push(
      await f.createUser({
        email: `query-${String(i).padStart(2, '0')}-${f.suffix}@example.test`,
        firstName: `Search ${f.suffix}`,
        lastName: `Last ${f.suffix}`,
        createdAt: tied,
        status: i === 0 ? 'ARCHIVED' : 'ACTIVE',
        archivedAt: i === 0 ? tied : null,
      }),
    );
  // Scope by the unique suffix plus fields rather than global counts.
  const response = (await f.get(`?q=${f.suffix}&perPage=50`).expect(200)).body;
  assert.ok(adminUserListResponseSchema.safeParse(response).success);
  assert.equal(response.meta.totalItems, 25);
  for (const field of ['firstName', 'lastName']) {
    const value =
      field === 'firstName' ? `SEARCH   ${f.suffix}` : `LAST   ${f.suffix}`;
    assert.equal(
      (await f.get(`?q=${encodeURIComponent(value)}&perPage=50`).expect(200))
        .body.meta.totalItems,
      22,
    );
  }
  const ids = rows.map((r) => r.id).sort();
  for (const sort of ['newest', 'oldest', 'email']) {
    const list = (
      await f
        .get(
          `?q=${encodeURIComponent(`Search ${f.suffix}`)}&sort=${sort}&perPage=50`,
        )
        .expect(200)
    ).body;
    assert.deepEqual(
      list.data.map((r) => r.id),
      sort === 'email'
        ? rows.map((r) => r.id)
        : sort === 'newest'
          ? [...ids].reverse()
          : ids,
    );
  }
  const page = (
    await f
      .get(`?q=${encodeURIComponent(`Search ${f.suffix}`)}&page=2`)
      .expect(200)
  ).body;
  assert.deepEqual(page.meta, {
    page: 2,
    perPage: 20,
    totalItems: 22,
    totalPages: 2,
  });
  assert.equal(page.data.length, 2);
  assert.equal(
    (await f.get(`?q=${f.suffix}&role=ADMIN`).expect(200)).body.meta.totalItems,
    2,
  );
  assert.equal(
    (await f.get(`?q=${f.suffix}&status=ARCHIVED`).expect(200)).body.meta
      .totalItems,
    1,
  );
  for (const query of [
    'q=' + 'x'.repeat(101),
    'q=a&q=b',
    'role=ADMIN&role=CUSTOMER',
    'status=DISABLED',
    'status=ACTIVE&status=ARCHIVED',
    'page=0',
    'page=1&page=2',
    'perPage=51',
    'sort=money',
    'unknown=yes',
  ])
    await f.get('?' + query).expect(422);
});
test('Customer disable/reactivate/archive atomically revokes sessions, preserves no-ops, records safe audit and prevents token resurrection', async (t) => {
  const f = await fixture(t);
  await f.sessions.issue(f.customer.id);
  const body = {
    expectedStatus: 'ACTIVE',
    toStatus: 'SUSPENDED',
    reason: '  Review account  ',
  };
  await f.change(f.customer.id, body).expect(200);
  const suspended = await f.state(f.customer.id);
  assert.equal(suspended.user.status, 'SUSPENDED');
  assert.equal(suspended.user.archivedAt, null);
  assert.ok(suspended.sessions.every((s) => s.revokedAt !== null));
  assert.equal(suspended.audits.length, 1);
  assert.equal(suspended.audits[0].action, 'USER_STATUS_CHANGE');
  assert.equal(suspended.audits[0].actorUserId, f.admin.id);
  assert.deepEqual(suspended.audits[0].afterJson, {
    userId: f.customer.id,
    role: 'CUSTOMER',
    status: 'SUSPENDED',
    archivedAt: null,
    reason: 'Review account',
  });
  await f.change(f.customer.id, { ...body, reason: 'different' }).expect(200);
  assert.deepEqual(await f.state(f.customer.id), suspended);
  await request(f.app)
    .get('/api/v1/users/me')
    .set('Authorization', `Bearer ${f.c.data.accessToken}`)
    .expect(401);
  await assert.rejects(f.sessions.rotate(f.c.refreshToken));
  await f
    .change(f.customer.id, { expectedStatus: 'SUSPENDED', toStatus: 'ACTIVE' })
    .expect(200);
  await request(f.app)
    .get('/api/v1/users/me')
    .set('Authorization', `Bearer ${f.c.data.accessToken}`)
    .expect(401);
  const fresh = await f.sessions.issue(f.customer.id);
  await request(f.app)
    .get('/api/v1/users/me')
    .set('Authorization', `Bearer ${fresh.data.accessToken}`)
    .expect(200);
  await f
    .change(f.customer.id, {
      expectedStatus: 'ACTIVE',
      toStatus: 'ARCHIVED',
      reason: 'Archive',
    })
    .expect(200);
  const archived = await f.state(f.customer.id);
  assert.ok(archived.user.archivedAt instanceof Date);
  assert.ok(archived.sessions.every((s) => s.revokedAt));
  const invalid = await f
    .change(f.customer.id, { expectedStatus: 'ARCHIVED', toStatus: 'ACTIVE' })
    .expect(409);
  assert.equal(invalid.body.error.code, 'INVALID_USER_STATUS_TRANSITION');
});
test('Status validation, role injection, self commands, Admin archival and stale conflicts have no side effects', async (t) => {
  const f = await fixture(t);
  const before = await f.state(f.customer.id);
  for (const body of [
    {},
    { toStatus: 'SUSPENDED', reason: 'reason' },
    { expectedStatus: 'ACTIVE', toStatus: 'SUSPENDED' },
    { expectedStatus: 'ACTIVE', toStatus: 'SUSPENDED', reason: '  ' },
    {
      expectedStatus: 'ACTIVE',
      toStatus: 'SUSPENDED',
      reason: 'x'.repeat(241),
    },
    { expectedStatus: 'SUSPENDED', toStatus: 'ACTIVE', reason: null },
    {
      expectedStatus: 'ACTIVE',
      toStatus: 'SUSPENDED',
      reason: 'reason',
      role: 'ADMIN',
    },
  ])
    await f.change(f.customer.id, body).expect(422);
  assert.deepEqual(await f.state(f.customer.id), before);
  const self = await f
    .change(f.admin.id, {
      expectedStatus: 'ACTIVE',
      toStatus: 'SUSPENDED',
      reason: 'Self',
    })
    .expect(409);
  assert.equal(self.body.error.code, 'ADMIN_SELF_STATUS_CHANGE_FORBIDDEN');
  const archive = await f
    .change(f.otherAdmin.id, {
      expectedStatus: 'ACTIVE',
      toStatus: 'ARCHIVED',
      reason: 'Archive admin',
    })
    .expect(409);
  assert.equal(archive.body.error.code, 'INVALID_USER_STATUS_TRANSITION');
  const stale = await f
    .change(f.customer.id, {
      expectedStatus: 'SUSPENDED',
      toStatus: 'ARCHIVED',
      reason: 'stale',
    })
    .expect(409);
  assert.equal(stale.body.error.code, 'USER_STATUS_CONFLICT');
  assert.deepEqual(stale.body.error.details, [
    { currentStatus: 'ACTIVE', expectedStatus: 'SUSPENDED' },
  ]);
  assert.deepEqual(await f.state(f.customer.id), before);
});
test('Competing status commands serialize same-target no-ops and cross-disable Admins retain an active actor', async (t) => {
  const f = await fixture(t);
  const app = f.makeApp(competing(f.prisma));
  const body = {
    expectedStatus: 'ACTIVE',
    toStatus: 'SUSPENDED',
    reason: 'Concurrent',
  };
  const results = await Promise.all([
    f.change(f.customer.id, body, f.a.data.accessToken, app),
    f.change(
      f.customer.id,
      { ...body, reason: 'Retry' },
      f.a.data.accessToken,
      app,
    ),
  ]);
  assert.deepEqual(
    results.map((r) => r.status),
    [200, 200],
  );
  assert.equal((await f.state(f.customer.id)).audits.length, 1);
  const cross = f.makeApp(competing(f.prisma));
  const disabled = await Promise.all([
    f.change(f.otherAdmin.id, body, f.a.data.accessToken, cross),
    f.change(f.admin.id, body, f.b.data.accessToken, cross),
  ]);
  assert.deepEqual(disabled.map((r) => r.status).sort(), [200, 401]);
  assert.equal(
    await f.prisma.user.count({
      where: { id: { in: [f.admin.id, f.otherAdmin.id] }, status: 'ACTIVE' },
    }),
    1,
  );
});
test('Audit failure rolls back status/archive/session writes and preserves safe retry', async (t) => {
  const f = await fixture(t);
  const before = await f.state(f.customer.id);
  const failing = wrap(
    f.prisma,
    (tx) =>
      new Proxy(tx, {
        get(target, key) {
          if (key !== 'adminAuditLog') return target[key];
          return new Proxy(target[key], {
            get(model, op) {
              if (op !== 'create') return model[op];
              return async (args) => {
                await model.create(args);
                throw new Error('Injected failure');
              };
            },
          });
        },
      }),
  );
  const body = {
    expectedStatus: 'ACTIVE',
    toStatus: 'ARCHIVED',
    reason: 'Rollback',
  };
  await f
    .change(f.customer.id, body, f.a.data.accessToken, f.makeApp(failing))
    .expect(500);
  assert.deepEqual(await f.state(f.customer.id), before);
  await f.change(f.customer.id, body).expect(200);
});
test('Defensive last-active-Admin count guard rejects without audit (injected population count)', async (t) => {
  const f = await fixture(t);
  // Transaction proxy narrows the authoritative population count to exercise the
  // invariant independently of seed and prior fixture Admins; real locks/writes.
  const narrowed = wrap(
    f.prisma,
    (tx) =>
      new Proxy(tx, {
        get(target, key) {
          if (key !== 'user') return target[key];
          return new Proxy(target[key], {
            get(model, op) {
              if (op !== 'count') return model[op];
              return async () => 1;
            },
          });
        },
      }),
  );
  const service = createAdminUserService({ prisma: narrowed });
  const before = await f.state(f.otherAdmin.id);
  await assert.rejects(
    service.changeStatus(
      f.otherAdmin.id,
      { expectedStatus: 'ACTIVE', toStatus: 'SUSPENDED', reason: 'Last' },
      { actorUserId: f.admin.id, requestId: randomUUID() },
    ),
    (e) => e.code === 'LAST_ACTIVE_ADMIN_REQUIRED',
  );
  assert.deepEqual(await f.state(f.otherAdmin.id), before);
});

test('Search contains treats SQL pattern characters literally, empty input is omitted, and beyond-last pages are empty', async (t) => {
  const f = await fixture(t);
  await f.createUser({ firstName: `Literal%_${f.suffix}` });
  const response = await f
    .get(`?q=${encodeURIComponent(`Literal%_${f.suffix}`)}`)
    .expect(200);
  assert.equal(response.body.meta.totalItems, 1);
  assert.equal(
    (await f.get(`?q=${f.suffix}&page=100`).expect(200)).body.data.length,
    0,
  );
  const empty = (await f.get('?q=%20%20').expect(200)).body;
  assert.deepEqual(empty, (await f.get('').expect(200)).body);
});

test('Admin disable/reactivation, Customer suspended archival and archive retries preserve reasons and timestamps', async (t) => {
  const f = await fixture(t);
  await f
    .change(f.otherAdmin.id, {
      expectedStatus: 'ACTIVE',
      toStatus: 'SUSPENDED',
      reason: 'x'.repeat(240),
    })
    .expect(200);
  await f
    .change(f.otherAdmin.id, {
      expectedStatus: 'SUSPENDED',
      toStatus: 'ACTIVE',
    })
    .expect(200);
  const admin = await f.state(f.otherAdmin.id);
  assert.equal(admin.user.status, 'ACTIVE');
  assert.ok(admin.sessions.every((s) => s.revokedAt));
  assert.equal(admin.audits.length, 2);
  assert.equal(Object.hasOwn(admin.audits[1].afterJson, 'reason'), false);
  await f
    .change(f.customer.id, {
      expectedStatus: 'ACTIVE',
      toStatus: 'SUSPENDED',
      reason: 'Disable',
    })
    .expect(200);
  await f
    .change(f.customer.id, {
      expectedStatus: 'SUSPENDED',
      toStatus: 'ARCHIVED',
      reason: 'Archive',
    })
    .expect(200);
  const archived = await f.state(f.customer.id);
  const response = await f
    .change(f.customer.id, {
      expectedStatus: 'ACTIVE',
      toStatus: 'ARCHIVED',
      reason: 'Different retry',
    })
    .expect(200);
  assert.equal(
    response.body.data.archivedAt,
    archived.user.archivedAt.toISOString(),
  );
  assert.deepEqual(await f.state(f.customer.id), archived);
});

test('Concurrent competing targets produce one committed audit and one stale conflict', async (t) => {
  const f = await fixture(t);
  const app = f.makeApp(competing(f.prisma));
  const results = await Promise.all(
    ['SUSPENDED', 'ARCHIVED'].map((toStatus) =>
      f.change(
        f.customer.id,
        { expectedStatus: 'ACTIVE', toStatus, reason: 'Competing' },
        f.a.data.accessToken,
        app,
      ),
    ),
  );
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  const state = await f.state(f.customer.id);
  assert.equal(state.audits.length, 1);
  assert.equal(
    results.find((r) => r.status === 409).body.error.code,
    'USER_STATUS_CONFLICT',
  );
  assert.equal(
    state.user.status,
    results.find((r) => r.status === 200).body.data.status,
  );
});

test('Session issuance/rotation racing disabling serialize on the same authoritative User lock', async (t) => {
  const f = await fixture(t);
  for (const operation of ['issue', 'rotate']) {
    const customer = await f.createUser();
    const original = await f.sessions.issue(customer.id);
    const shared = competing(f.prisma);
    const sessions = createSessionService({ prisma: shared, config });
    const service = createAdminUserService({ prisma: shared });
    const results = await Promise.allSettled([
      service.changeStatus(
        customer.id,
        {
          expectedStatus: 'ACTIVE',
          toStatus: 'SUSPENDED',
          reason: 'Concurrent disable',
        },
        { actorUserId: f.admin.id, requestId: randomUUID() },
      ),
      operation === 'issue'
        ? sessions.issue(customer.id)
        : sessions.rotate(original.refreshToken),
    ]);
    assert.equal(results[0].status, 'fulfilled');
    if (results[1].status === 'rejected')
      assert.equal(results[1].reason.status, 401);
    const state = await f.state(customer.id);
    assert.equal(state.user.status, 'SUSPENDED');
    assert.ok(state.sessions.every((s) => s.revokedAt));
    assert.equal(state.audits.length, 1);
    await assert.rejects(
      f.sessions.issue(customer.id),
      (e) => e.status === 401,
    );
  }
});
