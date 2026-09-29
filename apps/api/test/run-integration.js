import { spawnSync } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateDatabaseUrl } from '../src/config/env.js';
import { createDatabase } from '../src/db/client.js';

const apiRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const integrationDirectory = path.join(apiRoot, 'test', 'integration');
const databaseUrl = validateDatabaseUrl(process.env.DATABASE_URL);
const databaseName = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));

if (!/(^|[-_])test($|[-_])/iu.test(databaseName))
  throw new Error(
    'Integration tests may reset only a dedicated database whose name contains the word "test".',
  );

const quoteIdentifier = (value) => `"${value.replaceAll('"', '""')}"`;

async function resetDatabase() {
  const database = createDatabase(databaseUrl);
  try {
    const tables = await database.prisma.$queryRawUnsafe(
      `SELECT tablename
         FROM pg_tables
        WHERE schemaname = 'public'
          AND tablename <> '_prisma_migrations'
        ORDER BY tablename`,
    );
    if (!tables.length)
      throw new Error(
        'Integration test database has no migrated application tables.',
      );
    await database.prisma.$executeRawUnsafe(
      `TRUNCATE TABLE ${tables
        .map(({ tablename }) => `"public".${quoteIdentifier(tablename)}`)
        .join(', ')} RESTART IDENTITY CASCADE`,
    );
  } finally {
    await database.close();
  }

  const seeded = spawnSync(process.execPath, ['prisma/seed.js'], {
    cwd: apiRoot,
    env: process.env,
    encoding: 'utf8',
  });
  if (seeded.status !== 0) {
    process.stderr.write(seeded.stdout || '');
    process.stderr.write(seeded.stderr || '');
    throw new Error('Failed to seed the integration test database.');
  }
}

const files = (await readdir(integrationDirectory))
  .filter((file) => file.endsWith('.test.js'))
  .sort();

let failed = false;
let passedFiles = 0;
let failedFiles = 0;
for (const file of files) {
  await resetDatabase();
  const result = spawnSync(
    process.execPath,
    ['--test', `test/integration/${file}`],
    {
      cwd: apiRoot,
      env: process.env,
      stdio: 'inherit',
    },
  );
  if (result.status === 0) passedFiles += 1;
  else {
    failed = true;
    failedFiles += 1;
  }
}

console.log(
  `Integration test files: ${passedFiles} passed, ${failedFiles} failed.`,
);
if (failed) process.exitCode = 1;
