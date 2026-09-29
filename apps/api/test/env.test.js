import assert from 'node:assert/strict';
import test from 'node:test';
import { readEnv, validateDatabaseUrl } from '../src/config/env.js';

test('configuration rejects missing/invalid database and port without exposing secrets', () => {
  for (const value of [
    undefined,
    'https://user:secret@host/db',
    'postgresql://localhost',
  ]) {
    assert.throws(
      () => validateDatabaseUrl(value),
      (error) => !error.message.includes('secret'),
    );
  }
  assert.throws(() =>
    readEnv({ DATABASE_URL: 'postgresql://localhost/test', PORT: '-1' }),
  );
  assert.equal(
    readEnv({ DATABASE_URL: 'postgresql://localhost/test' }).port,
    4000,
  );
});
