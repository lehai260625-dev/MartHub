import assert from 'node:assert/strict';
import test from 'node:test';
import { hashPassword, verifyPassword } from '../src/modules/auth/passwords.js';

test('passwords use independently salted Argon2id with the required work factors', async () => {
  const password = 'A sufficiently long password';
  const first = await hashPassword(password);
  const second = await hashPassword(password);
  assert.equal(first.split('$')[1], 'argon2id');
  assert.equal(first.split('$')[2], 'v=19');
  assert.deepEqual(
    Object.fromEntries(
      first
        .split('$')[3]
        .split(',')
        .map((entry) => entry.split('=')),
    ),
    { m: '19456', t: '2', p: '1' },
  );
  assert.notEqual(first, second);
  assert.equal(await verifyPassword(first, password), true);
  assert.equal(await verifyPassword(first, 'different password'), false);
  assert.equal(await verifyPassword('invalid hash', password), false);
});
