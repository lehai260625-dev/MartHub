import { validateDatabaseUrl } from '../../apps/api/src/config/env.js';

export function e2eDatabaseUrl(env = process.env) {
  const value = validateDatabaseUrl(env.DATABASE_URL);
  const url = new URL(value);
  if (
    env.MARTHUB_E2E_RESET_DATABASE !== '1' ||
    env.NODE_ENV === 'production' ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    !/(^|[-_])test($|[-_])/iu.test(decodeURIComponent(url.pathname.slice(1))) ||
    url.search ||
    url.hash
  )
    throw new Error(
      'E2E requires explicit reset opt-in and a dedicated loopback test database, never a shared or production database.',
    );
  return value;
}
