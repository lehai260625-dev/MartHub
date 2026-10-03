import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { z } from 'zod';
import {
  checkoutOrderInputSchema,
  checkoutOrderResponseSchema,
  idempotencyKeySchema,
} from '../src/index.js';

const cartId = 'a6620237-185f-47a8-9d94-69fa51d4aa8a';
const addressId = 'ab60db36-8b4d-4a91-bf42-a17ad33db0a2';
test('order intent canonicalizes UUIDs and notes and strictly excludes server-owned inputs', () => {
  for (const customerNote of [undefined, null, '', '  \t\n'])
    assert.equal(
      checkoutOrderInputSchema.parse({ cartId, addressId, customerNote })
        .customerNote,
      null,
    );
  assert.deepEqual(
    checkoutOrderInputSchema.parse({
      addressId: addressId.toUpperCase(),
      cartId: cartId.toUpperCase(),
      customerNote: '  note  ',
    }),
    { cartId, addressId, customerNote: 'note' },
  );
  assert.equal(
    checkoutOrderInputSchema.parse({
      cartId,
      addressId,
      customerNote: ' '.repeat(3) + 'a'.repeat(500) + ' ',
    }).customerNote.length,
    500,
  );
  for (const input of [
    { addressId },
    { cartId },
    { cartId, addressId, customerNote: 'a'.repeat(501) },
    { cartId, addressId, customerNote: 1 },
    ...[
      'userId',
      'items',
      'price',
      'total',
      'stock',
      'status',
      'address',
      'quoteId',
    ].map((key) => ({ cartId, addressId, [key]: 1 })),
  ])
    assert.equal(checkoutOrderInputSchema.safeParse(input).success, false);
  assert.equal(idempotencyKeySchema.parse(cartId.toUpperCase()), cartId);
  for (const value of [undefined, '', 'bad', `${cartId},${addressId}`])
    assert.equal(idempotencyKeySchema.safeParse(value).success, false);
});

test('order OpenAPI defines strict canonical input, key, create/replay responses and conflict error', async () => {
  const spec = JSON.parse(
    await readFile(new URL('../openapi.json', import.meta.url), 'utf8'),
  );
  assert.deepEqual(
    spec.components.schemas.CheckoutOrderInput,
    z.toJSONSchema(checkoutOrderInputSchema, { io: 'input' }),
  );
  assert.deepEqual(
    spec.components.schemas.CheckoutOrderResponse,
    z.toJSONSchema(checkoutOrderResponseSchema),
  );
  const operation = spec.paths['/checkout/orders'].post;
  assert.deepEqual(operation.security, [{ BearerAuth: [] }]);
  assert.equal(operation.parameters[0].name, 'Idempotency-Key');
  assert.equal(operation.parameters[0].required, true);
  for (const code of ['200', '201']) {
    assert.equal(
      operation.responses[code].headers['Cache-Control'].schema.const,
      'no-store',
    );
    assert.equal(
      operation.responses[code].content['application/json'].schema.$ref,
      '#/components/schemas/CheckoutOrderResponse',
    );
  }
  for (const code of ['400', '401', '403', '404', '409', '422', '500'])
    assert.ok(operation.responses[code]);
});
