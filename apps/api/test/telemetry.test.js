import assert from 'node:assert/strict';
import test from 'node:test';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { emitEvent } from '../src/observability/log.js';

test('bounded readiness and HTTP telemetry correlates safely without public metrics', async () => {
  const records = [];
  let failing = false;
  const app = createApp({
    logger: (record) => records.push(record),
    readiness: async () => {
      if (failing) throw new Error('secret database password');
    },
  });
  await request(app)
    .get('/api/v1/health/ready?email=secret')
    .set('X-Request-Id', 'health_test')
    .expect(200);
  failing = true;
  await request(app)
    .get('/api/v1/health/ready')
    .set('X-Request-Id', 'health_test')
    .expect(503);
  assert.deepEqual(
    records
      .filter((row) => row.event.startsWith('db_readiness'))
      .map((row) => row.event),
    ['db_readiness_ready', 'db_readiness_failed'],
  );
  const requests = records.filter((row) => row.event === 'http_request');
  assert.deepEqual(
    requests.map((row) => row.statusClass),
    ['2xx', '5xx'],
  );
  assert.ok(
    requests.every(
      (row) =>
        Number.isFinite(row.durationMs) &&
        row.route === '/health/ready' &&
        row.requestId === 'health_test',
    ),
  );
  assert.ok(!JSON.stringify(records).includes('secret'));
  await request(app).get('/api/v1/metrics').expect(404);
  assert.doesNotThrow(() =>
    emitEvent(() => {
      throw new Error('sink failed');
    }, 'shutdown_completed'),
  );
});
