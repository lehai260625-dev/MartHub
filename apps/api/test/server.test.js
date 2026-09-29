import assert from 'node:assert/strict';
import { once } from 'node:events';
import { fork } from 'node:child_process';
import test from 'node:test';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { startServer } from '../src/server.js';

test('liveness uses the versioned success contract', async () => {
  const response = await request(createApp())
    .get('/api/v1/health/live')
    .expect(200);
  assert.deepEqual(response.body, { data: { status: 'ok', version: 'v1' } });
  assert.equal(response.headers['x-powered-by'], undefined);
  await request(createApp()).get('/health/live').expect(404);
});

test('shutdown drains an active request, closes once, and stops listening', async () => {
  let release;
  const entered = new Promise((resolve) => {
    release = resolve;
  });
  const app = createApp({
    configureRouter(router) {
      router.get('/slow', (req, res) => {
        release();
        setTimeout(() => res.end('done'), 50);
      });
    },
  });
  let closed = 0;
  const runtime = startServer({
    port: 0,
    app,
    onClose: async () => {
      closed += 1;
    },
  });
  await once(runtime.server, 'listening');
  const response = fetch(
    `http://127.0.0.1:${runtime.server.address().port}/api/v1/slow`,
  );
  await entered;
  await Promise.all([runtime.shutdown(), runtime.shutdown()]);
  assert.equal(await (await response).text(), 'done');
  assert.equal(closed, 1);
  assert.equal(runtime.server.listening, false);
});

test(
  'standalone API starts and exits cleanly through the shutdown handler',
  { timeout: 15000 },
  async (t) => {
    const child = fork(new URL('../src/server.js', import.meta.url), {
      env: {
        ...process.env,
        PORT: '14001',
        AUTH_JWT_SECRET: '0123456789abcdef'.repeat(4),
        CLOUDINARY_CLOUD_NAME: 'marthub-test',
        CLOUDINARY_API_KEY: 'test-key',
        CLOUDINARY_API_SECRET: 'test-secret-long-enough',
        DATABASE_URL:
          process.env.DATABASE_URL ||
          'postgresql://localhost:5432/marthub_test',
      },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    t.after(() => {
      if (child.exitCode === null) child.kill();
    });
    const [message] = await once(child, 'message');
    assert.equal(message.type, 'ready');
    assert.equal(
      (await fetch('http://127.0.0.1:14001/api/v1/health/live')).status,
      200,
    );
    const exited = once(child, 'exit');
    child.send({ type: 'shutdown' });
    const [code] = await exited;
    assert.equal(code, 0);
  },
);
