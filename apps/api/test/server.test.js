import assert from 'node:assert/strict';
import { once } from 'node:events';
import { fork, spawnSync } from 'node:child_process';
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
  const events = [];
  const runtime = startServer({
    port: 0,
    app,
    logger: (record) => events.push(record),
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
  assert.deepEqual(
    events.map((row) => row.event),
    ['application_started', 'shutdown_started', 'shutdown_completed'],
  );
});

test('production startup fails before serving and emits only a bounded safe event', () => {
  const result = spawnSync(process.execPath, ['src/server.js'], {
    cwd: new URL('..', import.meta.url),
    env: {
      ...process.env,
      NODE_ENV: 'production',
      HOST: '127.0.0.1',
      PORT: '14019',
      WEB_ORIGIN: 'https://shop.example.test',
      DATABASE_URL: 'postgresql://user:secret-canary@127.0.0.1/test',
      SHIPPING_FIXED_FEE_VND: '30000',
      SHIPPING_FREE_THRESHOLD_VND: '500000',
      AUTH_JWT_SECRET: 'secret-canary-invalid',
    },
    encoding: 'utf8',
  });
  assert.equal(result.status, 1);
  assert.deepEqual(JSON.parse(result.stdout), {
    level: 'error',
    event: 'application_configuration_failed',
  });
  assert.ok(!`${result.stdout}${result.stderr}`.includes('secret-canary'));
});

test(
  'production listen failure drains resources and exits with safe telemetry',
  { timeout: 15000 },
  async (t) => {
    const runtime = startServer({ port: 0, logger: () => {} });
    await once(runtime.server, 'listening');
    t.after(() => runtime.shutdown());
    const child = fork(new URL('../src/server.js', import.meta.url), {
      env: {
        ...process.env,
        NODE_ENV: 'production',
        HOST: '127.0.0.1',
        PORT: String(runtime.server.address().port),
        WEB_ORIGIN: 'https://shop.example.test',
        DATABASE_URL: 'postgresql://user:secret-canary@127.0.0.1/test',
        SHIPPING_FIXED_FEE_VND: '30000',
        SHIPPING_FREE_THRESHOLD_VND: '500000',
        AUTH_JWT_SECRET: '0123456789abcdef'.repeat(4),
        CLOUDINARY_CLOUD_NAME: 'marthub-test',
        CLOUDINARY_API_KEY: 'test-key',
        CLOUDINARY_API_SECRET: 'test-secret-long-enough',
      },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    t.after(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill();
    });
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      output += chunk.toString();
    });
    const [code] = await once(child, 'exit');
    assert.equal(code, 1);
    assert.ok(output.includes('application_listen_failed'));
    assert.ok(!output.includes('secret-canary'));
    assert.ok(
      output
        .trim()
        .split('\n')
        .every((line) => JSON.parse(line).event),
    );
  },
);

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
