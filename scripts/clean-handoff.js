import assert from 'node:assert/strict';
import { spawn, spawnSync, fork } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { cp, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { postmanDatabaseUrl } from './lib/postman.js';
import { createDatabase } from '../apps/api/src/db/client.js';
import { requireEmpty } from './lib/restore-rehearsal.js';

// Snapshot tracked + nonignored task files, never .git/node_modules/local env.
const root = fileURLToPath(new URL('../', import.meta.url));
const url = postmanDatabaseUrl();
const guardDatabase = createDatabase(url);
try {
  await requireEmpty({
    query: async (sql) => ({
      rows: await guardDatabase.prisma.$queryRawUnsafe(sql),
    }),
  });
} finally {
  await guardDatabase.close();
}
assert.equal(
  process.env.MARTHUB_CLEAN_HANDOFF,
  '1',
  'Explicit clean-copy test opt-in required.',
);
assert.ok(process.env.npm_execpath, 'Run through npm run test:handoff.');
const cache = join(root, '.cache');
await mkdir(cache, { recursive: true });
const copy = await mkdtemp(join(cache, 'clean-handoff-'));
const files = spawnSync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
  { cwd: root, encoding: 'utf8' },
);
assert.equal(files.status, 0);
for (const name of new Set(files.stdout.split('\0').filter(Boolean))) {
  const source = resolve(root, name),
    target = resolve(copy, name);
  assert.ok(
    source.startsWith(resolve(root) + '\\') ||
      source.startsWith(resolve(root) + '/'),
  );
  assert.ok(
    target.startsWith(resolve(copy) + '\\') ||
      target.startsWith(resolve(copy) + '/'),
  );
  assert.ok(
    !/(^|\/)\.env(?:\.|$)/u.test(name) || name.endsWith('.env.example'),
  );
  await mkdir(dirname(target), { recursive: true });
  await cp(source, target);
}
const env = {};
for (const key of [
  'PATH',
  'Path',
  'SystemRoot',
  'WINDIR',
  'ComSpec',
  'TEMP',
  'TMP',
  'APPDATA',
  'LOCALAPPDATA',
  'USERPROFILE',
  'HOME',
])
  if (process.env[key]) env[key] = process.env[key];
Object.assign(env, {
  NODE_ENV: 'test',
  DATABASE_URL: url,
  AUTH_JWT_SECRET: randomBytes(32).toString('hex'),
  WEB_ORIGIN: 'https://127.0.0.1:13711',
  API_INTERNAL_ORIGIN: 'http://127.0.0.1:13710',
  HOST: '127.0.0.1',
  PORT: '13710',
  SHIPPING_FIXED_FEE_VND: '30000',
  SHIPPING_FREE_THRESHOLD_VND: '500000',
  CLOUDINARY_CLOUD_NAME: 'marthub-local-test',
  CLOUDINARY_API_KEY: 'local-test-key',
  CLOUDINARY_API_SECRET: randomBytes(32).toString('hex'),
});
const results = [];
let api,
  web,
  stage = 'copy';
async function npm(args, override = {}) {
  stage = args.join(' ');
  console.log('Clean copy: ' + stage);
  const child = spawn(process.execPath, [process.env.npm_execpath, ...args], {
    cwd: copy,
    env: { ...env, ...override },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => {
    output += chunk;
  });
  child.stderr.on('data', (chunk) => {
    output += chunk;
  });
  const [code] = await once(child, 'exit');
  await writeFile(join(copy, `step-${results.length}.log`), output, {
    mode: 0o600,
  });
  assert.equal(
    code,
    0,
    'Clean-copy command failed; inspect private ignored logs.',
  );
  results.push({ command: stage, result: 'PASS' });
}
async function ready(url, child) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    assert.equal(child.exitCode, null, 'Startup process exited.');
    try {
      const response = await fetch(url);
      if (response.status === 200) return response;
    } catch {
      /* Startup readiness only. */
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Startup readiness deadline exceeded.');
}
try {
  await npm(['ci']);
  await npm(['run', 'test:harness']);
  await npm(['run', 'db:validate']);
  await npm(['run', 'db:generate']);
  await npm(['run', 'db:migrate']);
  await npm(['run', 'db:seed', '--workspace', '@marthub/api']);
  await npm(['test', '--workspace', '@marthub/contracts']);
  await npm(['test', '--workspace', '@marthub/api']);
  await npm(['test', '--workspace', '@marthub/web', '--', '--maxWorkers=2']);
  await npm(['run', 'build'], { NODE_ENV: 'production' });
  stage = 'application_startup';
  api = fork(join(copy, 'apps/api/src/server.js'), [], {
    cwd: join(copy, 'apps/api'),
    env: {
      ...env,
      NODE_ENV: 'development',
      WEB_ORIGIN: 'http://localhost:3000',
    },
    execArgv: [],
    silent: true,
  });
  api.stdout.resume();
  api.stderr.resume();
  const response = await ready(
    'http://127.0.0.1:13710/api/v1/health/ready',
    api,
  );
  assert.equal((await response.json()).data.status, 'ready');
  web = fork(
    join(copy, 'node_modules/next/dist/bin/next'),
    ['start', '--hostname', '127.0.0.1', '--port', '13711'],
    {
      cwd: join(copy, 'apps/web'),
      env: { ...env, NODE_ENV: 'production' },
      execArgv: [],
      silent: true,
    },
  );
  web.stdout.resume();
  web.stderr.resume();
  assert.match(
    await (await ready('http://127.0.0.1:13711/', web)).text(),
    /MartHub/u,
  );
  results.push({
    command: 'API entrypoint readiness + production Next homepage',
    result: 'PASS',
  });
  await writeFile(
    join(copy, 'handoff-report.json'),
    JSON.stringify(
      {
        result: 'PASS',
        files: new Set(files.stdout.split('\0').filter(Boolean)).size,
        results,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  console.log(JSON.stringify({ result: 'PASS', copy, results }));
} catch {
  console.error(
    JSON.stringify({
      result: 'FAIL',
      stage,
      copy,
      detail:
        'Private ignored logs retained; no secrets/config from working machine copied.',
    }),
  );
  process.exitCode = 1;
} finally {
  if (web && web.exitCode === null) {
    const done = once(web, 'exit');
    web.kill();
    await done;
  }
  if (api && api.exitCode === null) {
    const done = once(api, 'exit');
    api.send({ type: 'shutdown' });
    await done;
  }
}
