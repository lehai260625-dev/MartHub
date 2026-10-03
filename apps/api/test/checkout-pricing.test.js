import assert from 'node:assert/strict';
import test from 'node:test';
import { readShippingConfig } from '../src/config/env.js';
import { calculateQuoteTotals } from '../src/modules/checkout/pricing.js';

test('shipping uses selling-price merchandise subtotal with inclusive free threshold', () => {
  const policy = readShippingConfig({});
  for (const [price, shipping] of [
    ['499999', '30000'],
    ['500000', '0'],
    ['500001', '0'],
  ]) {
    const totals = calculateQuoteTotals(
      [{ unitPrice: price, quantity: 1, compareAtPrice: '999999' }],
      policy,
    );
    assert.equal(totals.subtotal, price);
    assert.equal(totals.shippingFee, shipping);
    assert.equal(totals.discountTotal, '0');
    assert.equal(totals.total, (BigInt(price) + BigInt(shipping)).toString());
  }
  assert.equal(
    calculateQuoteTotals([{ unitPrice: '250000', quantity: 2 }], policy)
      .shippingFee,
    '0',
  );
});

test('pricing preserves exact integers and rejects BIGINT overflow', () => {
  const policy = readShippingConfig({});
  assert.equal(
    calculateQuoteTotals(
      [{ unitPrice: '9007199254740993', quantity: 2 }],
      policy,
    ).total,
    '18014398509481986',
  );
  assert.throws(
    () =>
      calculateQuoteTotals(
        [{ unitPrice: '9223372036854775807', quantity: 2 }],
        policy,
      ),
    { status: 422, code: 'VALIDATION_ERROR' },
  );
  assert.throws(
    () =>
      calculateQuoteTotals(
        [{ unitPrice: '9223372036854775807', quantity: 1 }],
        { fixedFee: 1n, freeThreshold: 9223372036854775808n },
      ),
    { code: 'VALIDATION_ERROR' },
  );
});

test('server shipping configuration is exact, configurable, and rejects malformed or out-of-range values', () => {
  assert.deepEqual(
    readShippingConfig({
      SHIPPING_FIXED_FEE_VND: '100',
      SHIPPING_FREE_THRESHOLD_VND: '200',
    }),
    { fixedFee: 100n, freeThreshold: 200n },
  );
  for (const key of ['SHIPPING_FIXED_FEE_VND', 'SHIPPING_FREE_THRESHOLD_VND']) {
    for (const value of [
      '',
      '-1',
      '1.5',
      '01',
      'secret',
      '9223372036854775808',
    ])
      assert.throws(
        () => readShippingConfig({ [key]: value }),
        (error) =>
          error.message ===
          `${key} must be a non-negative integer VND amount within BIGINT range.`,
      );
  }
  assert.equal(
    calculateQuoteTotals(
      [{ unitPrice: '1', quantity: 1 }],
      readShippingConfig({ SHIPPING_FREE_THRESHOLD_VND: '0' }),
    ).shippingFee,
    '0',
  );
});
