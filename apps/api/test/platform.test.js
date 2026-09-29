import assert from 'node:assert/strict';
import test from 'node:test';
import request from 'supertest';
import { errorSchema } from '@marthub/contracts';
import { createApp } from '../src/app.js';

function fixture(logger = () => {}) {
  return createApp({
    logger,
    configureRouter(router) {
      router.post('/echo', (req, res) => res.json({ data: req.body }));
      router.get('/explode', () => {
        throw new Error('secret password cookie address');
      });
    },
  });
}
test('request correlation, headers, and normalized 404/500', async () => {
  const app = fixture();
  const response = await request(app)
    .get('/api/v1/health/live')
    .set('X-Request-Id', 'req_test')
    .expect(200);
  assert.equal(response.headers['x-request-id'], 'req_test');
  assert.equal(response.headers['x-content-type-options'], 'nosniff');
  assert.ok(response.headers['content-security-policy']);
  for (const [path, status] of [
    ['/missing', 404],
    ['/api/v1/explode', 500],
  ]) {
    const result = await request(app)
      .get(path)
      .set('X-Request-Id', 'unsafe value')
      .expect(status);
    assert.ok(errorSchema.safeParse(result.body).success);
    assert.equal(result.body.error.requestId, result.headers['x-request-id']);
    assert.ok(!JSON.stringify(result.body).includes('secret'));
  }
});
test('malformed, oversized, and unsupported bodies are normalized', async () => {
  const app = fixture();
  for (const [body, type, status, code] of [
    ['{', 'application/json', 400, 'INVALID_JSON'],
    ['x'.repeat(102401), 'application/json', 413, 'PAYLOAD_TOO_LARGE'],
    ['plain', 'text/plain', 415, 'UNSUPPORTED_MEDIA_TYPE'],
  ]) {
    const response = await request(app)
      .post('/api/v1/echo')
      .set('Content-Type', type)
      .send(body)
      .expect(status);
    assert.equal(response.body.error.code, code);
    assert.ok(errorSchema.safeParse(response.body).success);
  }
});
test('CORS only permits the configured origin and explicit preflight headers', async () => {
  const app = fixture();
  await request(app)
    .get('/api/v1/health/live')
    .set('Origin', 'https://attacker.example')
    .expect(403);
  const response = await request(app)
    .options('/api/v1/echo')
    .set('Origin', 'http://localhost:3000')
    .set('Access-Control-Request-Method', 'POST')
    .set('Access-Control-Request-Headers', 'Content-Type, X-Request-Id')
    .expect(204);
  assert.equal(
    response.headers['access-control-allow-origin'],
    'http://localhost:3000',
  );
  assert.equal(response.headers['access-control-allow-credentials'], 'true');
  await request(app)
    .options('/api/v1/echo')
    .set('Access-Control-Request-Method', 'TRACE')
    .expect(403);
  await request(app)
    .options('/api/v1/echo')
    .set('Access-Control-Request-Method', 'POST')
    .set('Access-Control-Request-Headers', 'x-untrusted')
    .expect(403);
  await request(app)
    .options('/api/v1/echo')
    .set('Access-Control-Request-Method', 'POST')
    .expect(403);
});
test('malformed compressed JSON is a safe client error', async () => {
  const response = await request(fixture())
    .post('/api/v1/echo')
    .set('Content-Type', 'application/json')
    .set('Content-Encoding', 'gzip')
    .send('not-gzip')
    .expect(400);
  assert.equal(response.body.error.code, 'INVALID_JSON');
});
test('logs omit sensitive payloads, headers, queries, and error internals; logger failure is harmless', async () => {
  const records = [];
  const app = fixture((record) => records.push(record));
  await request(app)
    .post('/api/v1/echo?token=secret-query')
    .set('Authorization', 'Bearer secret-token')
    .set('Cookie', 'secret-cookie')
    .send({ password: 'secret-password', address: 'secret-address' })
    .expect(200);
  await request(app).get('/api/v1/explode').expect(500);
  assert.equal(records.length, 2);
  assert.ok(!JSON.stringify(records).includes('secret'));
  assert.equal(records[1].code, 'INTERNAL_ERROR');
  await request(
    fixture(() => {
      throw new Error('logger failed');
    }),
  )
    .get('/api/v1/health/live')
    .expect(200);
});
