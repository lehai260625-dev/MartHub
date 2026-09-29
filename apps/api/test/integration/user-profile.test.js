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
const bearer = (token) => `Bearer ${token}`;

async function setup(t) {
  const database = createDatabase(
    validateDatabaseUrl(process.env.DATABASE_URL),
  );
  const { prisma } = database;
  const users = await Promise.all(
    ['CUSTOMER', 'ADMIN'].map((role) =>
      prisma.user.create({
        data: {
          email: `profile-${randomUUID()}@example.test`,
          passwordHash: 'unused-test-hash',
          firstName: 'Original',
          lastName: role === 'CUSTOMER' ? 'Customer' : 'Admin',
          phone: null,
          role,
        },
      }),
    ),
  );
  t.after(async () => {
    await prisma.user.deleteMany({
      where: { id: { in: users.map(({ id }) => id) } },
    });
    await database.close();
  });
  const sessions = createSessionService({ prisma, config });
  return {
    app: createApp({
      prisma,
      authConfig: config,
      origin: config.origin,
      logger: () => {},
    }),
    prisma,
    users,
    customerToken: (await sessions.issue(users[0].id)).data.accessToken,
    adminToken: (await sessions.issue(users[1].id)).data.accessToken,
  };
}

test('customer can view a no-store safe profile and admin is denied', async (t) => {
  const { app, users, customerToken, adminToken } = await setup(t);
  await request(app).get('/api/v1/users/me').expect(401);
  const response = await request(app)
    .get('/api/v1/users/me')
    .set('Authorization', bearer(customerToken))
    .expect(200);
  assert.match(response.headers['cache-control'], /no-store/);
  assert.equal(response.body.data.id, users[0].id);
  for (const secret of ['passwordHash', 'archivedAt', 'lastLoginAt'])
    assert.equal(Object.hasOwn(response.body.data, secret), false);
  await request(app)
    .get('/api/v1/users/me')
    .set('Authorization', bearer(adminToken))
    .expect(403);
});

test('customer updates only their allowed normalized profile fields', async (t) => {
  const { app, prisma, users, customerToken } = await setup(t);
  const response = await request(app)
    .patch('/api/v1/users/me')
    .set('Authorization', bearer(customerToken))
    .send({
      firstName: '  Mai  ',
      lastName: ' Tran ',
      phone: ' +84 912-345-678 ',
    })
    .expect(200);
  assert.deepEqual(
    {
      id: response.body.data.id,
      firstName: response.body.data.firstName,
      lastName: response.body.data.lastName,
      phone: response.body.data.phone,
    },
    {
      id: users[0].id,
      firstName: 'Mai',
      lastName: 'Tran',
      phone: '+84 912-345-678',
    },
  );
  const persisted = await prisma.user.findUnique({
    where: { id: users[0].id },
  });
  assert.equal(persisted.firstName, 'Mai');
  assert.equal(persisted.phone, '+84 912-345-678');
  const other = await prisma.user.findUnique({ where: { id: users[1].id } });
  assert.equal(other.firstName, 'Original');
});

test('profile boundary rejects privilege, identity, unknown, empty and invalid fields without mutation', async (t) => {
  const { app, prisma, users, customerToken } = await setup(t);
  for (const body of [
    {},
    { email: 'changed@example.test' },
    { role: 'ADMIN' },
    { status: 'SUSPENDED' },
    { userId: users[1].id },
    { passwordHash: 'replacement' },
    { unknown: true },
    { phone: 'call-me' },
    { firstName: '<b>Mai</b>' },
  ])
    await request(app)
      .patch('/api/v1/users/me')
      .set('Authorization', bearer(customerToken))
      .send(body)
      .expect(422);
  const persisted = await prisma.user.findUnique({
    where: { id: users[0].id },
  });
  assert.equal(persisted.firstName, 'Original');
  assert.equal(persisted.role, 'CUSTOMER');
  assert.equal(persisted.email, users[0].email);
});

test('profile update accepts clearing phone and rejects inactive sessions', async (t) => {
  const { app, prisma, users, customerToken } = await setup(t);
  await request(app)
    .patch('/api/v1/users/me')
    .set('Authorization', bearer(customerToken))
    .send({ phone: null })
    .expect(200);
  await prisma.user.update({
    where: { id: users[0].id },
    data: { status: 'SUSPENDED' },
  });
  await request(app)
    .patch('/api/v1/users/me')
    .set('Authorization', bearer(customerToken))
    .send({ firstName: 'Blocked' })
    .expect(401);
});
