import assert from 'node:assert/strict';
import test from 'node:test';
import {
  registerSchema,
  loginSchema,
  publicUserSchema,
} from '@marthub/contracts';

const valid = {
  email: '  MINH@example.test ',
  password: 'a long unique password',
  firstName: ' Minh ',
  lastName: 'Nguyen',
};
test('registration canonicalizes identity and rejects privilege/mass assignment', () => {
  assert.equal(registerSchema.parse(valid).email, 'minh@example.test');
  assert.equal(registerSchema.parse(valid).firstName, 'Minh');
  for (const field of ['role', 'status', 'userId', 'passwordHash']) {
    assert.equal(
      registerSchema.safeParse({ ...valid, [field]: 'injected' }).success,
      false,
    );
  }
  assert.equal(
    registerSchema.safeParse({ ...valid, firstName: '<script>' }).success,
    false,
  );
});
test('credential limits are shared with forms and password whitespace is preserved', () => {
  for (const password of ['short', 'a'.repeat(129)])
    assert.equal(
      loginSchema.safeParse({ email: valid.email, password }).success,
      false,
    );
  assert.equal(
    loginSchema.parse({ email: valid.email, password: '  a long password  ' })
      .password,
    '  a long password  ',
  );
  assert.equal(
    publicUserSchema.safeParse({
      id: 'b2ecb79a-b74a-4748-93dc-f2fc02b93b3d',
      email: 'minh@example.test',
      firstName: 'Minh',
      lastName: 'Nguyen',
      role: 'CUSTOMER',
      passwordHash: 'secret',
    }).success,
    false,
  );
});
