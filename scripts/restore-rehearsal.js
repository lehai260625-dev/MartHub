import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  writeFile,
  chmod,
  stat,
  realpath,
} from 'node:fs/promises';
import { once } from 'node:events';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { createDatabase } from '../apps/api/src/db/client.js';
import { createApp } from '../apps/api/src/app.js';
import {
  rehearsalTargets,
  nativeEnvironment,
  runNative,
  requireEmpty,
  snapshot,
  expectSqlFailure,
} from './lib/restore-rehearsal.js';
import {
  seedRecoveryFixture,
  fixtureId,
  exactVnd,
} from './lib/restore-fixture.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const apiRoot = join(root, 'apps/api');
const migrationRoot = join(apiRoot, 'prisma/migrations');
const clients = [];
let sourceDb,
  restoredDb,
  server,
  stage = 'safety_guards';
function runPrisma(args, url) {
  const result = spawnSync(
    process.execPath,
    [join(root, 'node_modules/prisma/build/index.js'), ...args],
    {
      cwd: apiRoot,
      env: { ...process.env, DATABASE_URL: url },
      encoding: 'utf8',
      timeout: 120000,
    },
  );
  assert.equal(result.status, 0, 'Prisma command failed; raw output withheld.');
  return result.stdout;
}
async function connect(target, database = target.name) {
  const env = nativeEnvironment(target);
  const client = new pg.Client({
    host: env.PGHOST,
    port: Number(env.PGPORT),
    user: env.PGUSER,
    password: env.PGPASSWORD,
    database,
    connectionTimeoutMillis: 5000,
    options: '-c timezone=UTC',
  });
  clients.push(client);
  await client.connect();
  return client;
}
async function verifyMigrationHistory(client) {
  const names = (await readdir(migrationRoot))
    .filter((name) => /^\d{14}_/u.test(name))
    .sort();
  const { rows } = await client.query(
    'SELECT migration_name,checksum,finished_at,rolled_back_at,applied_steps_count FROM _prisma_migrations ORDER BY migration_name',
  );
  assert.deepEqual(
    rows.map((row) => row.migration_name),
    names,
  );
  for (const row of rows) {
    const checksum = createHash('sha256')
      .update(
        await readFile(
          join(migrationRoot, row.migration_name, 'migration.sql'),
        ),
      )
      .digest('hex');
    assert.ok(
      row.checksum === checksum &&
        row.finished_at &&
        !row.rolled_back_at &&
        row.applied_steps_count > 0,
      'Migration metadata mismatch.',
    );
  }
  return names.length;
}
async function verifyRepresentative(prisma) {
  const order = await prisma.order.findUniqueOrThrow({
    where: { id: fixtureId(34) },
    include: {
      items: true,
      statusHistory: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
    },
  });
  assert.equal(order.status, 'DELIVERED');
  assert.equal(order.total, exactVnd + 30000n);
  assert.equal(order.items[0].unitPrice, exactVnd);
  assert.equal(
    order.items[0].productName,
    'Historical snapshot distinct from current product',
  );
  assert.deepEqual(
    order.statusHistory.map((row) => row.toStatus),
    ['PENDING', 'CONFIRMED', 'PACKING', 'SHIPPING', 'DELIVERED'],
  );
  assert.equal(
    (
      await prisma.inventory.findUniqueOrThrow({
        where: { productId: fixtureId(10) },
      })
    ).quantityOnHand,
    95,
  );
  assert.equal(
    await prisma.inventoryMovement.count({
      where: { orderId: fixtureId(35), type: 'ORDER_CANCEL_RESTORE' },
    }),
    1,
  );
  assert.equal(
    (await prisma.order.findUniqueOrThrow({ where: { id: fixtureId(35) } }))
      .cancellationReason,
    'Rehearsal cancellation',
  );
}
try {
  const [source, target] = rehearsalTargets();
  const cache = join(root, '.cache');
  await mkdir(cache, { recursive: true });
  assert.equal(
    await realpath(cache),
    join(await realpath(root), '.cache'),
    'Refuse redirected artifact directory.',
  );
  const directory = await mkdtemp(join(cache, 'restore-rehearsal-'));
  await chmod(directory, 0o700);
  if (process.platform === 'win32') {
    const identity = spawnSync('whoami', [], { encoding: 'utf8' });
    assert.equal(identity.status, 0);
    assert.equal(
      spawnSync(
        'icacls',
        [
          directory,
          '/inheritance:r',
          '/grant:r',
          `${identity.stdout.trim()}:(OI)(CI)F`,
        ],
        { encoding: 'utf8' },
      ).status,
      0,
      'Cannot restrict backup directory ACL.',
    );
  }
  const artifact = join(directory, 'marthub.dump');
  assert.equal(
    spawnSync('git', ['check-ignore', '--quiet', artifact], { cwd: root })
      .status,
    0,
    'Backup must be ignored.',
  );
  const tracked = spawnSync('git', ['ls-files', '--', artifact], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(tracked.status, 0);
  assert.equal(tracked.stdout.trim(), '');
  const dumpVersion = runNative('pg_dump', ['--version'], source).trim();
  const restoreVersion = runNative('pg_restore', ['--version'], target).trim();
  const maintenance = await connect(source, 'postgres');
  const {
    rows: [version],
  } = await maintenance.query(
    "SELECT current_setting('server_version') AS version,current_setting('server_version_num') AS number",
  );
  const major = Math.floor(Number(version.number) / 10000);
  assert.ok(
    dumpVersion.includes(` ${major}.`) && restoreVersion.includes(` ${major}.`),
    'Use matching PostgreSQL major tools for this rehearsal.',
  );
  const { rows: existing } = await maintenance.query(
    'SELECT datname FROM pg_database WHERE datname=ANY($1::text[])',
    [[source.name, target.name]],
  );
  assert.equal(
    existing.length,
    0,
    'Both rehearsal databases must be NEW; choose new names, never drop/reset existing DBs.',
  );
  stage = 'create_empty_databases';
  runNative(
    'createdb',
    ['--no-password', '--template=template0', source.name],
    { ...source, name: 'postgres' },
  );
  runNative(
    'createdb',
    ['--no-password', '--template=template0', target.name],
    { ...target, name: 'postgres' },
  );
  const sourceClient = await connect(source),
    targetClient = await connect(target);
  await requireEmpty(sourceClient);
  await requireEmpty(targetClient);
  stage = 'migrate_seed_source';
  runPrisma(['validate'], source.url);
  assert.match(
    runPrisma(['migrate', 'deploy'], source.url),
    /migrations have been successfully applied/u,
  );
  const seeded = spawnSync(process.execPath, ['prisma/seed.js'], {
    cwd: apiRoot,
    env: { ...process.env, DATABASE_URL: source.url },
    encoding: 'utf8',
    timeout: 120000,
  });
  assert.equal(
    seeded.status,
    0,
    'Approved baseline seed failed; raw output withheld.',
  );
  sourceDb = createDatabase(source.url);
  assert.equal(await sourceDb.prisma.product.count(), 10);
  assert.equal(await sourceDb.prisma.user.count(), 0);
  stage = 'representative_fixture';
  await sourceDb.prisma.$transaction(seedRecoveryFixture, { timeout: 30000 });
  stage = 'source_reconciliation_baseline';
  await verifyRepresentative(sourceDb.prisma);
  const migrations = await verifyMigrationHistory(sourceClient);
  const before = await snapshot(sourceClient);
  for (const value of Object.values(before.data))
    assert.ok(
      value.count > 0,
      'Every current application table must have representative data.',
    );
  stage = 'native_backup';
  runNative(
    'pg_dump',
    [
      '--no-password',
      '--format=custom',
      '--no-owner',
      '--no-acl',
      `--file=${artifact}`,
    ],
    source,
  );
  await chmod(artifact, 0o600);
  const bytes = (await stat(artifact)).size;
  assert.ok(bytes > 0);
  assert.match(
    runNative('pg_restore', ['--list', artifact], target),
    /_prisma_migrations/u,
  );
  assert.deepEqual(
    await snapshot(sourceClient),
    before,
    'Source changed during backup; reconciliation baseline is invalid.',
  );
  stage = 'restore_empty_target';
  await requireEmpty(targetClient);
  runNative(
    'pg_restore',
    [
      '--no-password',
      '--exit-on-error',
      '--single-transaction',
      '--no-owner',
      '--no-acl',
      `--dbname=${target.name}`,
      artifact,
    ],
    target,
  );
  stage = 'reconcile';
  const restoredSnapshot = await snapshot(targetClient);
  const differences = {
    tables: Object.keys(before.data).filter(
      (name) =>
        JSON.stringify(before.data[name]) !==
        JSON.stringify(restoredSnapshot.data[name]),
    ),
    schemaGroups: before.schema
      .map((value, index) =>
        JSON.stringify(value) !== JSON.stringify(restoredSnapshot.schema[index])
          ? index
          : null,
      )
      .filter((index) => index !== null),
  };
  if (differences.tables.length || differences.schemaGroups.length)
    console.error(JSON.stringify({ reconciliationDifferences: differences }));
  assert.deepEqual(
    restoredSnapshot,
    before,
    'Restored data/schema differs from source.',
  );
  await verifyMigrationHistory(targetClient);
  restoredDb = createDatabase(target.url);
  await verifyRepresentative(restoredDb.prisma);
  stage = 'migration_noop';
  runPrisma(['validate'], target.url);
  assert.match(
    runPrisma(['migrate', 'deploy'], target.url),
    /No pending migrations/u,
  );
  assert.deepEqual(
    await snapshot(targetClient),
    before,
    'Migration deploy changed restored data/schema.',
  );
  stage = 'restored_invariants';
  for (const [table, column, value, id] of [
    ['orders', 'total', '0', fixtureId(34)],
    ['order_items', 'quantity', '2', fixtureId(54)],
    ['order_status_history', 'reason', "'changed'", fixtureId(140)],
    ['inventory_movements', 'reason', "'changed'", fixtureId(13)],
    ['admin_audit_logs', 'request_id', "'changed'", fixtureId(211)],
  ]) {
    await expectSqlFailure(
      targetClient,
      `UPDATE "${table}" SET "${column}"=${value} WHERE id=$1`,
      [id],
      'P0001',
    );
    await expectSqlFailure(
      targetClient,
      `DELETE FROM "${table}" WHERE id=$1`,
      [id],
      'P0001',
    );
  }
  await expectSqlFailure(
    targetClient,
    'UPDATE product_price_history SET price=0 WHERE id=$1',
    [fixtureId(11)],
    '23514',
  );
  await expectSqlFailure(
    targetClient,
    'UPDATE inventory SET quantity_on_hand=-1 WHERE id=$1',
    [fixtureId(12)],
    '23514',
  );
  await expectSqlFailure(
    targetClient,
    'INSERT INTO product_price_history(id,product_id,price,starts_at) VALUES($1,$2,100,$3)',
    [fixtureId(900), fixtureId(10), '2026-09-02T00:00:00Z'],
    '23P01',
  );
  await expectSqlFailure(
    targetClient,
    'INSERT INTO carts(id,user_id,updated_at) VALUES($1,$2,CURRENT_TIMESTAMP)',
    [fixtureId(901), fixtureId(1)],
    '23505',
  );
  assert.deepEqual(
    await snapshot(targetClient),
    before,
    'Invariant probes must leave no mutation.',
  );
  stage = 'restored_application_smoke';
  const logs = [];
  const app = createApp({
    prisma: restoredDb.prisma,
    readiness: () => restoredDb.ready(),
    logger: (record) => logs.push(record),
  });
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}/api/v1`;
  const ready = await fetch(`${base}/health/ready`);
  assert.equal(ready.status, 200);
  assert.equal((await ready.json()).data.status, 'ready');
  const product = await fetch(`${base}/products/recovery-exact-vnd`);
  assert.equal(product.status, 200);
  const body = await product.json();
  assert.equal(body.data.price, exactVnd.toString());
  assert.equal(body.data.id, fixtureId(10));
  assert.equal(
    logs.filter((record) => record.level === 'error').length,
    0,
    'Unexpected application error.',
  );
  assert.deepEqual(
    await snapshot(targetClient),
    before,
    'Read smoke must not mutate restored state.',
  );
  const report = {
    result: 'PASS',
    serverVersion: version.version,
    dumpVersion,
    restoreVersion,
    migrations,
    backupBytes: bytes,
    backupSha256: createHash('sha256')
      .update(await readFile(artifact))
      .digest('hex'),
    reconciliation: before,
    migrationDeploy: 'NO_OP',
    invariantProbes: 14,
    readiness: 'PASS',
    apiRead: 'PASS',
  };
  await writeFile(
    join(directory, 'report.json'),
    JSON.stringify(report, null, 2),
    { mode: 0o600, flag: 'wx' },
  );
  console.log(JSON.stringify({ ...report, artifactDirectory: directory }));
} catch {
  console.error(
    JSON.stringify({
      result: 'FAIL',
      stage,
      detail:
        'Raw errors withheld to protect credentials/row data; no drop/reset/promotion is performed.',
    }),
  );
  process.exitCode = 1;
} finally {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (sourceDb) await sourceDb.close();
  if (restoredDb) await restoredDb.close();
  for (const client of clients) await client.end();
}
