import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { z } from 'zod';
import { reorderInputSchema, reorderResponseSchema } from '../src/index.js';
test('reorder input is bodyless/empty and rejects client-controlled quantities or prices', () => {
  assert.deepEqual(reorderInputSchema.parse({}), {});
  for (const input of [
    null,
    [],
    { quantity: 1 },
    { productId: 'spoof' },
    { userId: 'spoof' },
    { currentUnitPrice: '1' },
    { idempotencyKey: 'spoof' },
  ])
    assert.equal(reorderInputSchema.safeParse(input).success, false);
});
test('reorder response preserves exact VND and only approved reason codes', () => {
  const productId = '11111111-1111-4111-8111-111111111111';
  for (const reason of ['UNAVAILABLE', 'OUT_OF_STOCK', 'QUANTITY_LIMITED'])
    assert.ok(
      reorderResponseSchema.safeParse({
        data: { cartId: null, added: [], skipped: [{ productId, reason }] },
      }).success,
    );
  for (const reason of ['PRODUCT_ARCHIVED', 'INSUFFICIENT_STOCK'])
    assert.equal(
      reorderResponseSchema.safeParse({
        data: { cartId: null, added: [], skipped: [{ productId, reason }] },
      }).success,
      false,
    );
  assert.ok(
    reorderResponseSchema.safeParse({
      data: {
        cartId: productId,
        added: [
          { productId, quantity: 99, currentUnitPrice: '9007199254740993' },
        ],
        skipped: [],
      },
    }).success,
  );
});
test('reorder OpenAPI matches implemented strict shared contracts', async () => {
  const spec = JSON.parse(
    await readFile(new URL('../openapi.json', import.meta.url), 'utf8'),
  );
  assert.deepEqual(
    spec.components.schemas.ReorderInput,
    z.toJSONSchema(reorderInputSchema),
  );
  assert.deepEqual(
    spec.components.schemas.ReorderResponse,
    z.toJSONSchema(reorderResponseSchema),
  );
  const command = spec.paths['/orders/{orderId}/reorder'].post;
  assert.deepEqual(command.security, [{ BearerAuth: [] }]);
  assert.equal(
    command.responses['200'].headers['Cache-Control'].schema.const,
    'no-store',
  );
  for (const status of ['401', '403', '404', '422', '500'])
    assert.ok(command.responses[status]);
});
