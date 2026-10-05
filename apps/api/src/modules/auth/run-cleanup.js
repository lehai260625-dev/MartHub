import { validateDatabaseUrl } from '../../config/env.js';
import { createDatabase } from '../../db/client.js';
import { cleanupRefreshSessions } from './cleanup.js';

let database;
try {
  database = createDatabase(validateDatabaseUrl(process.env.DATABASE_URL));
  const summary = await cleanupRefreshSessions(database.prisma);
  process.stdout.write(
    JSON.stringify({
      level: 'info',
      event: 'session_cleanup_completed',
      ...summary,
    }) + '\n',
  );
} catch {
  process.stderr.write(
    JSON.stringify({ level: 'error', event: 'session_cleanup_failed' }) + '\n',
  );
  process.exitCode = 1;
} finally {
  try {
    if (database) await database.close();
  } catch {
    process.stderr.write(
      JSON.stringify({
        level: 'error',
        event: 'session_cleanup_close_failed',
      }) + '\n',
    );
    process.exitCode = 1;
  }
}
