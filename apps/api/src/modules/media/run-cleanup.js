import { readEnv } from '../../config/env.js';
import { readMediaConfig } from '../../config/media.js';
import { createDatabase } from '../../db/client.js';
import { createCloudinaryAdapter } from './cloudinary.js';
import { processDueMediaCleanup } from './cleanup.js';

const environment = readEnv();
const database = createDatabase(environment.databaseUrl);
try {
  const results = await processDueMediaCleanup({
    prisma: database.prisma,
    media: createCloudinaryAdapter({ config: readMediaConfig() }),
    retryFailed: process.argv.includes('--retry-failed'),
  });
  const summary = results.reduce(
    (counts, row) => ({
      ...counts,
      [row.status.toLowerCase()]: counts[row.status.toLowerCase()] + 1,
    }),
    { processed: results.length, pending: 0, failed: 0, completed: 0 },
  );
  process.stdout.write(JSON.stringify(summary) + '\n');
} finally {
  await database.close();
}
