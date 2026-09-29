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
const details = (suffix = '') => ({
  label: `Home${suffix}`,
  recipientName: `Minh Nguyen${suffix}`,
  phone: '+84 912-345-678',
  line1: `12 Market Street${suffix}`,
  line2: null,
  ward: 'Ward 1',
  district: 'District 3',
  province: 'Ho Chi Minh City',
  postalCode: '700000',
});

async function setup(t) {
  const database = createDatabase(
    validateDatabaseUrl(process.env.DATABASE_URL),
  );
  const { prisma } = database;
  const users = await Promise.all(
    ['CUSTOMER', 'CUSTOMER', 'ADMIN'].map((role) =>
      prisma.user.create({
        data: {
          email: `address-${randomUUID()}@example.test`,
          passwordHash: 'unused-test-hash',
          firstName: 'Address',
          lastName: role,
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
  const tokens = await Promise.all(
    users.map(async ({ id }) => (await sessions.issue(id)).data.accessToken),
  );
  return {
    app: createApp({
      prisma,
      authConfig: config,
      origin: config.origin,
      logger: () => {},
    }),
    prisma,
    users,
    tokens,
  };
}

test('database enforces address ownership and one active default per user', async (t) => {
  const { prisma, users } = await setup(t);
  const first = await prisma.address.create({
    data: { ...details(' A'), userId: users[0].id, isDefault: true },
  });
  await assert.rejects(
    prisma.address.create({
      data: { ...details(' B'), userId: users[0].id, isDefault: true },
    }),
    { code: 'P2002' },
  );
  await assert.rejects(
    prisma.address.create({
      data: { ...details(' Foreign'), userId: randomUUID() },
    }),
    { code: 'P2003' },
  );
  await prisma.address.update({
    where: { id: first.id },
    data: { archivedAt: new Date() },
  });
  await prisma.address.create({
    data: { ...details(' Replacement'), userId: users[0].id, isDefault: true },
  });
  const indexes =
    await prisma.$queryRaw`SELECT indexname FROM pg_indexes WHERE tablename = 'addresses'`;
  assert.ok(
    indexes.some(
      ({ indexname }) => indexname === 'addresses_one_active_default_per_user',
    ),
  );
});

test('customer address CRUD is strict, safe, ordered, and soft-deleting', async (t) => {
  const { app, prisma, users, tokens } = await setup(t);
  await request(app).get('/api/v1/users/me/addresses').expect(401);
  await request(app)
    .get('/api/v1/users/me/addresses')
    .set('Authorization', bearer(tokens[2]))
    .expect(403);
  const empty = await request(app)
    .get('/api/v1/users/me/addresses')
    .set('Authorization', bearer(tokens[0]))
    .expect(200);
  assert.deepEqual(empty.body, { data: [] });
  assert.match(empty.headers['cache-control'], /no-store/);

  const first = await request(app)
    .post('/api/v1/users/me/addresses')
    .set('Authorization', bearer(tokens[0]))
    .send({ ...details(' A'), isDefault: false })
    .expect(201);
  assert.equal(first.body.data.isDefault, true);
  assert.equal(Object.hasOwn(first.body.data, 'userId'), false);
  const second = await request(app)
    .post('/api/v1/users/me/addresses')
    .set('Authorization', bearer(tokens[0]))
    .send(details(' B'))
    .expect(201);
  assert.equal(second.body.data.isDefault, false);

  const updated = await request(app)
    .patch(`/api/v1/users/me/addresses/${second.body.data.id}`)
    .set('Authorization', bearer(tokens[0]))
    .send({ label: 'Office', line2: 'Floor 2' })
    .expect(200);
  assert.equal(updated.body.data.label, 'Office');
  for (const body of [
    {},
    { isDefault: true },
    { userId: users[1].id },
    { unknown: true },
  ])
    await request(app)
      .patch(`/api/v1/users/me/addresses/${second.body.data.id}`)
      .set('Authorization', bearer(tokens[0]))
      .send(body)
      .expect(422);
  await request(app)
    .put(`/api/v1/users/me/addresses/${second.body.data.id}/default`)
    .set('Authorization', bearer(tokens[0]))
    .send({ isDefault: true })
    .expect(422);
  await request(app)
    .put(`/api/v1/users/me/addresses/${second.body.data.id}/default`)
    .set('Authorization', bearer(tokens[0]))
    .expect(200);
  const list = await request(app)
    .get('/api/v1/users/me/addresses')
    .set('Authorization', bearer(tokens[0]))
    .expect(200);
  assert.equal(list.body.data[0].id, second.body.data.id);
  assert.equal(list.body.data.filter(({ isDefault }) => isDefault).length, 1);
  await request(app)
    .delete(`/api/v1/users/me/addresses/${second.body.data.id}`)
    .set('Authorization', bearer(tokens[0]))
    .expect(204);
  const archived = await prisma.address.findUnique({
    where: { id: second.body.data.id },
  });
  assert.ok(archived.archivedAt);
  assert.equal(archived.isDefault, false);
});

test('address ownership is derived from authentication and concealed from other customers', async (t) => {
  const { app, tokens } = await setup(t);
  const owned = await request(app)
    .post('/api/v1/users/me/addresses')
    .set('Authorization', bearer(tokens[0]))
    .send(details())
    .expect(201);
  for (const [method, path] of [
    ['patch', `/api/v1/users/me/addresses/${owned.body.data.id}`],
    ['put', `/api/v1/users/me/addresses/${owned.body.data.id}/default`],
    ['delete', `/api/v1/users/me/addresses/${owned.body.data.id}`],
  ]) {
    const client = request(app);
    const call = client[method](path).set('Authorization', bearer(tokens[1]));
    if (method === 'patch') call.send({ label: 'Stolen' });
    await call.expect(404);
  }
  const otherList = await request(app)
    .get('/api/v1/users/me/addresses')
    .set('Authorization', bearer(tokens[1]))
    .expect(200);
  assert.deepEqual(otherList.body, { data: [] });
});

test('concurrent default changes serialize and leave exactly one active default', async (t) => {
  const { app, prisma, users, tokens } = await setup(t);
  const ids = [];
  for (const suffix of [' A', ' B']) {
    const created = await request(app)
      .post('/api/v1/users/me/addresses')
      .set('Authorization', bearer(tokens[0]))
      .send(details(suffix))
      .expect(201);
    ids.push(created.body.data.id);
  }
  const results = await Promise.all(
    ids.map((id) =>
      request(app)
        .put(`/api/v1/users/me/addresses/${id}/default`)
        .set('Authorization', bearer(tokens[0])),
    ),
  );
  assert.deepEqual(
    results.map(({ status }) => status),
    [200, 200],
  );
  const defaults = await prisma.address.findMany({
    where: { userId: users[0].id, archivedAt: null, isDefault: true },
  });
  assert.equal(defaults.length, 1);
  assert.ok(ids.includes(defaults[0].id));
});
