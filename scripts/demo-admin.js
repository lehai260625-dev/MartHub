import { createDatabase } from '../apps/api/src/db/client.js';
import { hashPassword } from '../apps/api/src/modules/auth/passwords.js';
import { postmanDatabaseUrl } from './lib/postman.js';

// Local, explicitly owned test fixture setup only; not a production bootstrap.
let db;
try {
  const url = postmanDatabaseUrl();
  const email = process.env.MARTHUB_DEMO_ADMIN_EMAIL,
    password = process.env.MARTHUB_DEMO_ADMIN_PASSWORD;
  if (
    !email?.endsWith('@example.test') ||
    !/^[^\s@]+@example\.test$/u.test(email) ||
    !password ||
    password.length < 15 ||
    password.length > 128
  )
    throw new Error('Invalid test fixture credentials.');
  db = createDatabase(url);
  if (await db.prisma.user.findUnique({ where: { email } }))
    throw new Error('Existing identities are never promoted or overwritten.');
  await db.prisma.user.create({
    data: {
      email,
      passwordHash: await hashPassword(password),
      firstName: 'Demo',
      lastName: 'Admin',
      role: 'ADMIN',
    },
  });
  console.log(
    JSON.stringify({ result: 'PASS', fixture: 'isolated-test-admin-created' }),
  );
} catch {
  console.error(
    JSON.stringify({
      result: 'FAIL',
      detail:
        'Test opt-in/credential/uniqueness/migration requirement failed; no credential values printed.',
    }),
  );
  process.exitCode = 1;
} finally {
  if (db) await db.close();
}
