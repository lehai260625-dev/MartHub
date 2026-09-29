import assert from 'node:assert/strict';
import test from 'node:test';
import request from 'supertest';
import { createDatabase } from '../../src/db/client.js';
import { validateDatabaseUrl } from '../../src/config/env.js';
import { createApp } from '../../src/app.js';

test('real PostgreSQL readiness and baseline migration are available', async () => {
  const database = createDatabase(
    validateDatabaseUrl(process.env.DATABASE_URL),
  );
  try {
    await request(createApp({ readiness: database.ready }))
      .get('/api/v1/health/ready')
      .expect(200);
    const rows = await database.prisma
      .$queryRaw`SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL`;
    assert.ok(
      rows.some((row) => row.migration_name === '20260913000000_foundation'),
    );
  } finally {
    await database.close();
  }
});

test('dependency failure returns a safe readiness response', async () => {
  const response = await request(
    createApp({
      readiness: async () => {
        throw new Error('password=secret');
      },
    }),
  )
    .get('/api/v1/health/ready')
    .expect(503);
  assert.equal(response.body.error.code, 'SERVICE_UNAVAILABLE');
  assert.ok(!JSON.stringify(response.body).includes('secret'));
});
