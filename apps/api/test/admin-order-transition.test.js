import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ADMIN_ORDER_TRANSITION_MATRIX,
  isAdminOrderTransitionAllowed,
} from '../src/modules/admin/orders.js';

const statuses = [
  'PENDING',
  'CONFIRMED',
  'PACKING',
  'SHIPPING',
  'DELIVERED',
  'CANCELLED',
];
const allowed = new Set([
  'PENDING:CONFIRMED',
  'PENDING:CANCELLED',
  'CONFIRMED:PACKING',
  'CONFIRMED:CANCELLED',
  'PACKING:SHIPPING',
  'PACKING:CANCELLED',
  'SHIPPING:DELIVERED',
]);

test('Admin order transition matrix allows every direct edge and rejects all skips, reversals, and terminal mutations', () => {
  assert.deepEqual(Object.keys(ADMIN_ORDER_TRANSITION_MATRIX), statuses);
  for (const fromStatus of statuses)
    for (const toStatus of statuses)
      assert.equal(
        isAdminOrderTransitionAllowed(fromStatus, toStatus),
        allowed.has(`${fromStatus}:${toStatus}`),
        `${fromStatus} -> ${toStatus}`,
      );
});

test('Admin order transition matrix rejects unknown state values', () => {
  assert.equal(isAdminOrderTransitionAllowed('UNKNOWN', 'PENDING'), false);
  assert.equal(isAdminOrderTransitionAllowed('PENDING', 'UNKNOWN'), false);
});
