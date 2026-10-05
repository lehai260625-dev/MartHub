import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, readFile, copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createDatabase } from '../apps/api/src/db/client.js';
import { createApp } from '../apps/api/src/app.js';
import { readAuthConfig } from '../apps/api/src/config/auth.js';
import { hashPassword } from '../apps/api/src/modules/auth/passwords.js';
import { requireEmpty } from './lib/restore-rehearsal.js';
import {
  postmanDatabaseUrl,
  coreFolders,
  assertCollectionPaths,
} from './lib/postman.js';

const root = fileURLToPath(new URL('../', import.meta.url));
let db,
  server,
  stage = 'safety_guards';
async function command(args, cwd, env = process.env) {
  const child = spawn(process.execPath, args, {
    cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  // Consume but never forward raw tool output (URLs and credentials may appear).
  let stdout = '';
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
  });
  child.stderr.resume();
  const [code] = await once(child, 'exit');
  assert.equal(code, 0, 'Rehearsal setup command failed; raw output withheld.');
  return stdout;
}
try {
  const url = postmanDatabaseUrl();
  const collection = JSON.parse(
    await readFile(
      join(root, 'postman/MartHub.postman_collection.json'),
      'utf8',
    ),
  );
  const environment = JSON.parse(
    await readFile(
      join(root, 'postman/local-test.postman_environment.json'),
      'utf8',
    ),
  );
  const openapi = JSON.parse(
    await readFile(join(root, 'packages/contracts/openapi.json'), 'utf8'),
  );
  assert.equal(assertCollectionPaths(collection, openapi), 80);
  db = createDatabase(url);
  // Same empty-object guard as the native restore rehearsal; never reset residue.
  await requireEmpty({
    query: async (sql) => ({ rows: await db.prisma.$queryRawUnsafe(sql) }),
  });
  stage = 'migrate_seed';
  const prisma = join(root, 'node_modules/prisma/build/index.js'),
    apiRoot = join(root, 'apps/api');
  await command([prisma, 'validate'], apiRoot);
  assert.match(
    await command([prisma, 'migrate', 'deploy'], apiRoot),
    /migrations have been successfully applied/u,
  );
  await command(['prisma/seed.js'], apiRoot);
  assert.equal(await db.prisma.user.count(), 0);
  assert.equal(await db.prisma.product.count(), 10);
  const customerPassword = randomBytes(24).toString('hex'),
    adminPassword = randomBytes(24).toString('hex');
  await db.prisma.user.create({
    data: {
      email: 'admin@example.test',
      passwordHash: await hashPassword(adminPassword),
      firstName: 'Portfolio',
      lastName: 'Admin',
      role: 'ADMIN',
    },
  });
  stage = 'runner_tool';
  const toolRoot = join(root, '.cache/postman-tools');
  await mkdir(toolRoot, { recursive: true });
  for (const name of ['package.json', 'package-lock.json'])
    await copyFile(join(root, 'postman/runner', name), join(toolRoot, name));
  assert.ok(
    process.env.npm_execpath,
    'Use npm run test:postman so the documented npm executable is available.',
  );
  await command(
    [
      process.env.npm_execpath,
      'ci',
      '--prefix',
      toolRoot,
      '--no-audit',
      '--no-fund',
      '--ignore-scripts',
    ],
    root,
  );
  const newman = createRequire(import.meta.url)(
    join(toolRoot, 'node_modules/newman'),
  );
  stage = 'collection';
  const logs = [];
  const origin = 'http://localhost:3000';
  const app = createApp({
    prisma: db.prisma,
    authConfig: readAuthConfig({
      NODE_ENV: 'test',
      AUTH_JWT_SECRET: randomBytes(32).toString('hex'),
    }),
    origin,
    readiness: () => db.ready(),
    logger: (record) => logs.push(record),
  });
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const values = {
    baseUrl: `http://127.0.0.1:${server.address().port}/api/v1`,
    origin,
    customerEmail: 'customer@example.test',
    customerPassword,
    adminEmail: 'admin@example.test',
    adminPassword,
    runId: '107001',
  };
  environment.values = environment.values.map((entry) => ({
    ...entry,
    value: values[entry.key] ?? entry.value,
  }));
  // Real Newman cookie jar/collection scripts. No token/cookie environment export,
  // no reports containing request/response bodies, no external media execution.
  const summary = await new Promise((resolve, reject) =>
    newman.run(
      {
        collection,
        environment,
        folder: coreFolders,
        reporters: [],
        bail: true,
        timeoutRequest: 10000,
      },
      (error, result) => (error ? reject(error) : resolve(result)),
    ),
  );
  if (summary.run.failures.length) {
    console.error(
      JSON.stringify({
        failedTests: summary.run.failures.map((f) => ({
          request: f.source?.name,
          test: f.error?.test,
        })),
      }),
    );
    throw new Error('Collection assertion failure.');
  }
  assert.equal(summary.run.stats.requests.total, 76);
  assert.equal(await db.prisma.order.count(), 2);
  assert.equal(
    await db.prisma.order.count({ where: { status: 'DELIVERED' } }),
    1,
  );
  assert.equal(
    await db.prisma.order.count({ where: { status: 'CANCELLED' } }),
    1,
  );
  assert.equal(logs.filter((record) => record.level === 'error').length, 0);
  console.log(
    JSON.stringify({
      result: 'PASS',
      runner: 'Newman 6.2.2',
      requests: summary.run.stats.requests.total,
      assertions: summary.run.stats.assertions.total,
      failed: summary.run.stats.assertions.failed,
      skippedExternal: 4,
      migrations: 15,
      orders: 2,
      unexpectedServerErrors: 0,
    }),
  );
} catch {
  console.error(
    JSON.stringify({
      result: 'FAIL',
      stage,
      detail:
        'Raw errors withheld; no reset, production credentials or external media calls.',
    }),
  );
  process.exitCode = 1;
} finally {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (db) await db.close();
}
