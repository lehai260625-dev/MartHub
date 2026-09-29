import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addressCreateSchema,
  addressFormSchema,
  addressListResponseSchema,
  addressResponseSchema,
  addressUpdateSchema,
} from '../src/address.js';

const input = {
  label: ' Home ',
  recipientName: ' Minh Nguyen ',
  phone: ' +84 912-345-678 ',
  line1: ' 12 Market Street ',
  line2: null,
  ward: ' Ward 1 ',
  district: ' District 3 ',
  province: ' Ho Chi Minh City ',
  postalCode: '700000',
  isDefault: true,
};

test('address contracts normalize safe fields and reject identity/default injection', () => {
  const parsed = addressCreateSchema.parse(input);
  assert.equal(parsed.label, 'Home');
  assert.equal(parsed.recipientName, 'Minh Nguyen');
  assert.equal(parsed.phone, '+84 912-345-678');
  assert.ok(
    addressFormSchema.safeParse({ ...input, line2: '', postalCode: '' })
      .success,
  );
  assert.ok(addressUpdateSchema.safeParse({ label: 'Office' }).success);
  for (const value of [
    {},
    { userId: 'b2ecb79a-b74a-4748-93dc-f2fc02b93b3d' },
    { isDefault: true },
    { line1: '<script>' },
    { phone: 'call-me' },
  ])
    assert.equal(addressUpdateSchema.safeParse(value).success, false);

  const address = {
    id: 'b2ecb79a-b74a-4748-93dc-f2fc02b93b3d',
    ...parsed,
    line2: null,
    postalCode: '700000',
  };
  assert.ok(addressResponseSchema.safeParse({ data: address }).success);
  assert.ok(addressListResponseSchema.safeParse({ data: [address] }).success);
});
