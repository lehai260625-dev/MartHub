import assert from 'node:assert/strict';
import test from 'node:test';
import { checkoutOrderInputSchema } from '@marthub/contracts';
import { fingerprintIntent } from '../src/modules/checkout/orders.js';
const cartId = 'a6620237-185f-47a8-9d94-69fa51d4aa8a';
const addressId = 'ab60db36-8b4d-4a91-bf42-a17ad33db0a2';
test('fingerprint uses stable canonical client intent and excludes mutable server state', () => {
  const parse = checkoutOrderInputSchema.parse;
  const expected = fingerprintIntent(parse({ cartId, addressId }));
  for (const customerNote of [undefined, null, '', '  '])
    assert.equal(
      fingerprintIntent(parse({ addressId, cartId, customerNote })),
      expected,
    );
  assert.equal(
    fingerprintIntent(
      parse({
        addressId: addressId.toUpperCase(),
        cartId: cartId.toUpperCase(),
      }),
    ),
    expected,
  );
  assert.equal(
    fingerprintIntent(parse({ cartId, addressId, customerNote: ' note ' })),
    fingerprintIntent(parse({ addressId, cartId, customerNote: 'note' })),
  );
  assert.equal(
    fingerprintIntent({
      cartId,
      addressId,
      customerNote: null,
      items: [],
      price: 123,
      stock: 0,
      address: {},
    }),
    expected,
  );
  assert.notEqual(
    fingerprintIntent(parse({ cartId, addressId, customerNote: 'note' })),
    expected,
  );
  assert.notEqual(
    fingerprintIntent(parse({ cartId: addressId, addressId })),
    expected,
  );
  assert.notEqual(
    fingerprintIntent(parse({ cartId, addressId: cartId })),
    expected,
  );
  assert.match(expected, /^[a-f0-9]{64}$/);
});
