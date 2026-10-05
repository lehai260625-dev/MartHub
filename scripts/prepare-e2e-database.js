import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createDatabase } from '../apps/api/src/db/client.js';
import { e2eDatabaseUrl } from './lib/e2e-database.js';

// Validate before invoking migrations or opening any connection. Opt-in means
// the caller owns this dedicated disposable DB and no other run shares it.
const databaseUrl = e2eDatabaseUrl();
const apiRoot = fileURLToPath(new URL('../apps/api/', import.meta.url));
function run(args) {
  const result = spawnSync(process.execPath, args, {
    cwd: apiRoot,
    env: process.env,
    stdio: 'inherit',
  });
  if (result.status !== 0) throw new Error('E2E database preparation failed.');
}
run([
  fileURLToPath(
    new URL('../node_modules/prisma/build/index.js', import.meta.url),
  ),
  'migrate',
  'deploy',
]);
const database = createDatabase(databaseUrl);
try {
  const tables = await database.prisma.$queryRaw`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
      AND tablename <> '_prisma_migrations' ORDER BY tablename`;
  if (!tables.length)
    throw new Error('E2E migration created no application tables.');
  const identifiers = tables.map(
    ({ tablename }) => `"public"."${tablename.replaceAll('"', '""')}"`,
  );
  await database.prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${identifiers.join(', ')} RESTART IDENTITY CASCADE`,
  );
} finally {
  await database.close();
}
run(['prisma/seed.js']);
const baseline = createDatabase(databaseUrl);
try {
  const users = await baseline.prisma.user.count();
  const orders = await baseline.prisma.order.count();
  const products = await baseline.prisma.product.count();
  if (users !== 0 || orders !== 0 || products !== 10)
    throw new Error(
      'E2E baseline verification failed; refusing to start the test API.',
    );
  console.log(
    'E2E baseline verified: 0 users, 0 orders, 10 original catalog products.',
  );
} finally {
  await baseline.close();
}
console.log(
  'E2E dedicated test database migrated and reset to the approved catalog baseline.',
);
