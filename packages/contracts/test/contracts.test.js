import assert from 'node:assert/strict';
import test from 'node:test';
import {
  API_BASE_PATH,
  healthSchema,
  moneySchema,
  requestIdSchema,
} from '@marthub/contracts';

test('package exports versioned runtime contracts', () => {
  assert.equal(API_BASE_PATH, '/api/v1');
  assert.equal(
    healthSchema.safeParse({ data: { status: 'ok', version: 'v1' } }).success,
    true,
  );
  assert.equal(
    healthSchema.safeParse({ data: { status: 'ok', version: 'v2' } }).success,
    false,
  );
});
test('VND remains exact and within PostgreSQL BIGINT', () => {
  assert.equal(moneySchema.parse('9223372036854775807'), '9223372036854775807');
  for (const value of [1.5, 10, '-1', '01', '1.0', '9223372036854775808']) {
    assert.equal(moneySchema.safeParse(value).success, false);
  }
});
test('request IDs reject unsafe or unbounded input', () => {
  assert.equal(requestIdSchema.safeParse('req_123-abc').success, true);
  for (const value of ['a'.repeat(65), 'unsafe value', 'line\nbreak'])
    assert.equal(requestIdSchema.safeParse(value).success, false);
});
