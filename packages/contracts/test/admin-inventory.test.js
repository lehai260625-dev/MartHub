import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { z } from 'zod';
import {
  adminInventoryAdjustmentResponseSchema,
  adminInventoryAdjustmentSchema,
  adminInventoryListResponseSchema,
  adminInventoryMovementListResponseSchema,
} from '../src/admin-inventory.js';

test('inventory adjustment contract is strict, signed, non-zero, and reasoned', () => {
  assert.equal(
    adminInventoryAdjustmentSchema.safeParse({
      adjustment: -2,
      reason: 'Damaged during count',
    }).success,
    true,
  );
  for (const input of [
    { adjustment: 0, reason: 'Counted' },
    { adjustment: 1.5, reason: 'Counted' },
    { adjustment: 1, reason: '' },
    { adjustment: 1, reason: '<b>Counted</b>' },
    { adjustment: 1, reason: 'Counted', quantityAfter: 10 },
    { adjustment: 1, reason: 'Counted', actorUserId: crypto.randomUUID() },
  ])
    assert.equal(
      adminInventoryAdjustmentSchema.safeParse(input).success,
      false,
    );
});

test('inventory response contracts preserve authoritative boundaries and actor', () => {
  const productId = '0e7b73b7-9db0-4ae0-80b5-08e4049162cf';
  const item = {
    productId,
    sku: 'MHB-OPS-001',
    name: 'Desk lamp',
    status: 'ACTIVE',
    quantityOnHand: 3,
    updatedAt: '2026-09-21T00:00:00.000Z',
  };
  const movement = {
    id: '7984f43d-f8fb-45a7-94d6-cdb60e278081',
    productId,
    type: 'ADJUSTMENT',
    adjustment: -2,
    quantityBefore: 5,
    quantityAfter: 3,
    orderId: null,
    reason: 'Damaged during count',
    createdAt: '2026-09-21T00:00:00.000Z',
    actor: {
      id: 'b2ecb79a-b74a-4748-93dc-f2fc02b93b3d',
      email: 'admin@example.test',
      firstName: 'Admin',
      lastName: 'User',
    },
  };
  assert.equal(
    adminInventoryAdjustmentResponseSchema.safeParse({
      data: { inventory: item, movement },
    }).success,
    true,
  );
  assert.equal(
    adminInventoryListResponseSchema.safeParse({
      data: [item],
      meta: { page: 1, perPage: 24, totalItems: 1, totalPages: 1 },
    }).success,
    true,
  );
  assert.equal(
    adminInventoryMovementListResponseSchema.safeParse({
      data: [movement],
      meta: { page: 1, perPage: 20, totalItems: 1, totalPages: 1 },
    }).success,
    true,
  );
});

test('OpenAPI documents protected inventory routes with shared schemas', async () => {
  const spec = JSON.parse(
    await readFile(new URL('../openapi.json', import.meta.url), 'utf8'),
  );
  const list = spec.paths['/admin/inventory'].get;
  const movements = spec.paths['/admin/inventory/{productId}/movements'].get;
  const adjustment =
    spec.paths['/admin/inventory/{productId}/adjustments'].post;
  for (const operation of [list, movements, adjustment])
    assert.deepEqual(operation.security, [{ BearerAuth: [] }]);
  assert.equal(
    adjustment.requestBody.content['application/json'].schema.$ref,
    '#/components/schemas/AdminInventoryAdjustment',
  );
  for (const [name, schema] of Object.entries({
    AdminInventoryAdjustment: adminInventoryAdjustmentSchema,
    AdminInventoryAdjustmentResponse: adminInventoryAdjustmentResponseSchema,
    AdminInventoryListResponse: adminInventoryListResponseSchema,
    AdminInventoryMovementListResponse:
      adminInventoryMovementListResponseSchema,
  }))
    assert.deepEqual(spec.components.schemas[name], z.toJSONSchema(schema));
  assert.equal(
    adjustment.responses['409'].$ref,
    '#/components/responses/AuthError',
  );
});
