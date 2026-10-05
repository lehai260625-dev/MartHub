import assert from 'node:assert/strict';
import { fork, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile } from 'node:fs/promises';
import { createServer, request as httpRequest } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID } from 'node:crypto';
import { chromium, request } from '@playwright/test';
import { createDatabase } from '../apps/api/src/db/client.js';
import { e2eDatabaseUrl } from './lib/e2e-database.js';
import { upstreamFailure } from './lib/smoke-proxy.js';

// Destructive helpers must never run against a shared/non-test database.
// This smoke does not truncate: it requires an empty, exclusively owned DB.
const databaseUrl = e2eDatabaseUrl();
const apiRoot = fileURLToPath(new URL('../apps/api/', import.meta.url));
const webRoot = fileURLToPath(new URL('../apps/web/', import.meta.url));
const prismaCli = fileURLToPath(
  new URL('../node_modules/prisma/build/index.js', import.meta.url),
);
const origin = 'https://127.0.0.1:13002';
const env = {
  ...process.env,
  NODE_ENV: 'production',
  DATABASE_URL: databaseUrl,
  HOST: '127.0.0.1',
  PORT: '4000',
  WEB_ORIGIN: origin,
  API_INTERNAL_ORIGIN: 'http://127.0.0.1:4000',
  AUTH_JWT_SECRET: randomBytes(32).toString('hex'),
  CLOUDINARY_CLOUD_NAME: 'marthub-smoke-test',
  CLOUDINARY_API_KEY: 'test-only-key',
  CLOUDINARY_API_SECRET: randomBytes(32).toString('hex'),
  SHIPPING_FIXED_FEE_VND: '30000',
  SHIPPING_FREE_THRESHOLD_VND: '500000',
};
const database = createDatabase(databaseUrl);
let api, web, edge, browser, client;
let stage = 'fresh_database';
const logs = [];
function run(args) {
  const result = spawnSync(process.execPath, args, {
    cwd: apiRoot,
    env,
    encoding: 'utf8',
  });
  assert.equal(
    result.status,
    0,
    'Production migration/seed command failed (raw output withheld).',
  );
  return result.stdout;
}
async function waitForReady() {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      if ((await client.get('/api/v1/health/ready')).status() === 200) return;
    } catch {
      /* Wait only for startup readiness, never retry a failed assertion. */
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Production smoke readiness deadline exceeded.');
}
async function stopApi() {
  if (!api || api.exitCode !== null || api.signalCode !== null) return;
  const exit = once(api, 'exit');
  api.send({ type: 'shutdown' });
  const [code] = await exit;
  assert.equal(code, 0);
}
try {
  const tables = await database.prisma
    .$queryRaw`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`;
  assert.equal(
    tables.length,
    0,
    'Smoke requires a fresh empty dedicated test database.',
  );
  run([prismaCli, 'validate']);
  stage = 'migrations';
  const migrated = run([prismaCli, 'migrate', 'deploy']);
  assert.match(migrated, /migrations have been successfully applied/);
  assert.match(run([prismaCli, 'migrate', 'deploy']), /No pending migrations/);
  run(['prisma/seed.js']);
  assert.equal(await database.prisma.user.count(), 0);
  assert.equal(await database.prisma.product.count(), 10);

  // Ephemeral certificate only; no trust-store or deployed credentials change.
  stage = 'test_certificate';
  const temp = await mkdtemp(join(tmpdir(), 'marthub-smoke-'));
  const key = join(temp, 'key.pem'),
    cert = join(temp, 'cert.pem');
  const openssl = process.env.MARTHUB_TEST_OPENSSL || 'openssl';
  const generated = spawnSync(
    openssl,
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      key,
      '-out',
      cert,
      '-days',
      '1',
      '-subj',
      '/CN=127.0.0.1',
      '-addext',
      'subjectAltName=IP:127.0.0.1',
    ],
    { encoding: 'utf8' },
  );
  assert.equal(generated.status, 0, 'Test certificate generation failed.');
  // Verify smoke-only listener ports are free before starting either process.
  for (const port of [4000, 13000]) {
    const probe = createServer();
    probe.listen(port, '127.0.0.1');
    await once(probe, 'listening');
    await new Promise((resolve) => probe.close(resolve));
  }
  stage = 'startup';
  api = fork(new URL('../apps/api/src/server.js', import.meta.url), {
    env,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  api.stdout.on('data', (chunk) => logs.push(chunk.toString()));
  api.stderr.on('data', () => {});
  const [message] = await once(api, 'message', {
    signal: AbortSignal.timeout(30000),
  });
  assert.equal(message.type, 'ready');
  web = fork(
    new URL('../node_modules/next/dist/bin/next', import.meta.url),
    ['start', '--hostname', '127.0.0.1', '--port', '13000'],
    { cwd: webRoot, env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] },
  );
  web.stdout.resume();
  web.stderr.resume();
  edge = createHttpsServer(
    { key: await readFile(key), cert: await readFile(cert) },
    (req, res) => {
      const upstream = httpRequest(
        {
          host: '127.0.0.1',
          port: 13000,
          path: req.url,
          method: req.method,
          headers: { ...req.headers, host: '127.0.0.1:13002' },
        },
        (reply) => {
          res.writeHead(reply.statusCode, reply.headers);
          reply.pipe(res);
        },
      );
      upstream.on('error', () => {
        upstreamFailure(res);
      });
      req.pipe(upstream);
    },
  );
  edge.listen(13002, '127.0.0.1');
  await once(edge, 'listening');
  client = await request.newContext({
    baseURL: origin,
    ignoreHTTPSErrors: true,
  });
  await waitForReady();
  stage = 'health';
  const live = await client.get('/api/v1/health/live', {
    headers: { 'X-Request-Id': 'm105_tls_smoke' },
  });
  assert.equal(live.status(), 200);
  assert.equal(live.headers()['x-request-id'], 'm105_tls_smoke');
  const replacement = await client.get('/api/v1/health/ready', {
    headers: { 'X-Request-Id': 'invalid id' },
  });
  assert.match(replacement.headers()['x-request-id'], /^[0-9a-f-]{36}$/);
  assert.equal((await client.get('/api/v1/homepage')).status(), 200);
  stage = 'secure_auth';
  const credentials = {
    email: `smoke-${randomUUID()}@example.test`,
    password: randomBytes(24).toString('hex'),
    firstName: 'Smoke',
    lastName: 'Test',
  };
  const registration = await client.post('/api/v1/auth/register', {
    headers: { Origin: origin },
    data: credentials,
  });
  assert.equal(registration.status(), 201);
  const cookie = registration.headers()['set-cookie'];
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Path=\/api\/v1\/auth/);
  assert.equal(
    (
      await client.post('/api/v1/auth/refresh', {
        headers: { Origin: origin },
        data: {},
      })
    ).status(),
    200,
  );
  assert.equal(
    (
      await client.post('/api/v1/auth/logout', {
        headers: { Origin: origin },
        data: {},
      })
    ).status(),
    204,
  );

  stage = 'browser_csp';
  browser = await chromium.launch();
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();
  const violations = [],
    pageErrors = [];
  await page.exposeFunction('recordViolation', (directive) =>
    violations.push(directive),
  );
  await page.addInitScript(() =>
    globalThis.addEventListener('securitypolicyviolation', (event) =>
      globalThis.recordViolation(event.effectiveDirective),
    ),
  );
  page.on('pageerror', () => pageErrors.push('runtime_error'));
  const response = await page.goto(origin + '/products/cove-stoneware-mug');
  assert.match(
    response.headers()['content-security-policy'],
    /script-src 'self' 'nonce-/,
  );
  await page.getByLabel('Quantity', { exact: true }).fill('2');
  assert.equal(
    await page.getByLabel('Quantity', { exact: true }).inputValue(),
    '2',
  );
  assert.deepEqual(violations, []);
  assert.deepEqual(pageErrors, []);
  await browser.close();
  browser = undefined;
  await client.dispose();
  client = undefined;
  stage = 'shutdown_telemetry';
  await stopApi();
  const records = logs
    .join('')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  for (const event of [
    'application_started',
    'db_readiness_ready',
    'http_request',
    'shutdown_started',
    'shutdown_completed',
  ])
    assert.ok(
      records.some((record) => record.event === event),
      event,
    );
  const serialized = JSON.stringify(records);
  for (const sensitive of [
    credentials.email,
    credentials.password,
    env.AUTH_JWT_SECRET,
    env.CLOUDINARY_API_SECRET,
    databaseUrl,
  ])
    assert.ok(!serialized.includes(sensitive));
  const http = records.filter((record) => record.event === 'http_request');
  assert.ok(
    http.every(
      (record) =>
        Number.isInteger(record.durationMs) &&
        record.statusClass &&
        !record.route.includes('?'),
    ),
  );
  console.log(
    'Production TLS smoke PASS: fresh/no-op migrations, seed, production API/Next, HTTPS cookies/refresh/logout, health, CSP/hydration, correlation, safe JSON telemetry and graceful shutdown.',
  );
} catch {
  console.error(
    `Production smoke FAILED at ${stage}; raw requests, credentials and server output withheld.`,
  );
  process.exitCode = 1;
} finally {
  await browser?.close();
  await client?.dispose();
  // Drain the test edge before stopping its upstream; otherwise an outstanding
  // browser stream can error after headers have already been forwarded.
  if (edge) {
    edge.closeAllConnections();
    await new Promise((resolve) => edge.close(resolve));
  }
  await stopApi();
  if (web?.exitCode === null && web.signalCode === null) {
    const exited = once(web, 'exit');
    web.kill('SIGTERM');
    await exited;
  }
  await database.close();
}
