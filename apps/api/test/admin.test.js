import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import test from 'node:test';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { readAuthConfig } from '../src/config/auth.js';
import { signAccessToken } from '../src/modules/auth/tokens.js';

const config = readAuthConfig({
  AUTH_JWT_SECRET: randomBytes(32).toString('hex'),
  WEB_ORIGIN: 'https://shop.example.test',
  NODE_ENV: 'production',
});

test('admin namespace requires a current database ADMIN role and returns only safe identity data', async () => {
  const sessionId = randomUUID();
  const users = {
    customer: {
      id: randomUUID(),
      email: 'customer@example.test',
      firstName: 'Customer',
      lastName: 'User',
      phone: null,
      role: 'CUSTOMER',
      status: 'ACTIVE',
    },
    admin: {
      id: randomUUID(),
      email: 'admin@example.test',
      firstName: 'Admin',
      lastName: 'User',
      phone: null,
      role: 'ADMIN',
      status: 'ACTIVE',
    },
  };
  let currentAdminRole = 'ADMIN';
  const prisma = {
    refreshSession: {
      async findFirst({ where }) {
        const source = Object.values(users).find(
          (user) => user.id === where.userId,
        );
        if (!source || where.id !== sessionId) return null;
        return {
          id: sessionId,
          user: {
            ...source,
            role: source.id === users.admin.id ? currentAdminRole : source.role,
          },
        };
      },
    },
    product: {
      async count() {
        return 0;
      },
      async findMany() {
        return [];
      },
    },
    async $transaction(operations) {
      return Promise.all(operations);
    },
  };
  const app = createApp({
    prisma,
    authConfig: config,
    origin: config.origin,
    logger: () => {},
  });
  const customerToken = await signAccessToken(
    users.customer,
    sessionId,
    config,
  );
  const adminToken = await signAccessToken(users.admin, sessionId, config);
  const bearer = (token) => 'Bearer ' + token;

  const missing = await request(app).get('/api/v1/admin').expect(401);
  assert.equal(missing.body.error.code, 'UNAUTHORIZED');

  const forbidden = await request(app)
    .get('/api/v1/admin')
    .set('Authorization', bearer(customerToken))
    .expect(403);
  assert.equal(forbidden.body.error.code, 'FORBIDDEN');
  assert.match(forbidden.headers['cache-control'], /no-store/);

  await request(app)
    .get('/api/v1/admin/products')
    .set('Authorization', bearer(customerToken))
    .expect(403);

  const allowed = await request(app)
    .get('/api/v1/admin')
    .set('Authorization', bearer(adminToken))
    .expect(200);
  assert.deepEqual(allowed.body, { data: { user: users.admin } });
  assert.match(allowed.headers['cache-control'], /no-store/);
  assert.equal(JSON.stringify(allowed.body).includes('password'), false);
  assert.equal(JSON.stringify(allowed.body).includes('token'), false);

  await request(app)
    .get('/api/v1/admin/products')
    .set('Authorization', bearer(adminToken))
    .expect(200);

  currentAdminRole = 'CUSTOMER';
  await request(app)
    .get('/api/v1/admin')
    .set('Authorization', bearer(adminToken))
    .expect(403);
});
