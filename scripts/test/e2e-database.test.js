import assert from 'node:assert/strict';
import test from 'node:test';
import { e2eDatabaseUrl } from '../lib/e2e-database.js';

test('E2E reset requires explicit disposable DB opt-in, loopback and bounded test name', () => {
  const env = {
    DATABASE_URL: 'postgresql://fixture@127.0.0.1:15432/marthub_m102_test',
    MARTHUB_E2E_RESET_DATABASE: '1',
    NODE_ENV: 'test',
  };
  assert.equal(e2eDatabaseUrl(env), env.DATABASE_URL);
  for (const changes of [
    { MARTHUB_E2E_RESET_DATABASE: undefined },
    { MARTHUB_E2E_RESET_DATABASE: '0' },
    { NODE_ENV: 'production' },
    { DATABASE_URL: 'postgresql://fixture@remote.example.test/marthub_test' },
    { DATABASE_URL: 'postgresql://fixture@127.0.0.1/marthub' },
    { DATABASE_URL: 'postgresql://fixture@127.0.0.1/contest' },
    {
      DATABASE_URL: 'postgresql://fixture@127.0.0.1/marthub_test?schema=other',
    },
    { DATABASE_URL: 'not-a-url' },
  ])
    assert.throws(() => e2eDatabaseUrl({ ...env, ...changes }));
});
