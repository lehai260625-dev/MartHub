import assert from 'node:assert/strict';
import test from 'node:test';
import {
  profileFormSchema,
  profileResponseSchema,
  profileUpdateSchema,
} from '../src/auth.js';

const user = {
  id: 'b2ecb79a-b74a-4748-93dc-f2fc02b93b3d',
  email: 'customer@example.test',
  firstName: 'Minh',
  lastName: 'Nguyen',
  phone: null,
  role: 'CUSTOMER',
  status: 'ACTIVE',
};

test('profile contracts allow only bounded names and optional phone', () => {
  assert.deepEqual(
    profileUpdateSchema.parse({
      firstName: '  Minh  ',
      lastName: ' Nguyen ',
      phone: ' +84 912-345-678 ',
    }),
    { firstName: 'Minh', lastName: 'Nguyen', phone: '+84 912-345-678' },
  );
  assert.ok(profileUpdateSchema.safeParse({ phone: null }).success);
  assert.ok(
    profileFormSchema.safeParse({
      firstName: user.firstName,
      lastName: user.lastName,
      phone: '',
    }).success,
  );
  assert.ok(profileResponseSchema.safeParse({ data: user }).success);
  for (const input of [
    {},
    { email: 'other@example.test' },
    { role: 'ADMIN' },
    { phone: 'call-me' },
    { firstName: '<script>' },
  ])
    assert.equal(profileUpdateSchema.safeParse(input).success, false);
});
