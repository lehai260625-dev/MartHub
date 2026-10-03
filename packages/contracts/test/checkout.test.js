import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import {
  checkoutQuoteInputSchema,
  checkoutQuoteResponseSchema,
} from '../src/index.js';

test('quote input accepts only an owned-address choice, never client prices/stock/totals', () => {
  const addressId = 'b2ecb79a-b74a-4748-93dc-f2fc02b93b3d';
  assert.equal(checkoutQuoteInputSchema.safeParse({ addressId }).success, true);
  for (const input of [
    {},
    { addressId: 'bad' },
    ...[
      'userId',
      'price',
      'stock',
      'subtotal',
      'shippingFee',
      'total',
      'address',
      'customerNote',
    ].map((key) => ({ addressId, [key]: 0 })),
  ])
    assert.equal(checkoutQuoteInputSchema.safeParse(input).success, false);
});

test('quote OpenAPI matches strict shared schemas and protected no-store responses', async () => {
  const spec = JSON.parse(
    await readFile(new URL('../openapi.json', import.meta.url), 'utf8'),
  );
  assert.deepEqual(
    spec.components.schemas.CheckoutQuoteInput,
    z.toJSONSchema(checkoutQuoteInputSchema),
  );
  assert.deepEqual(
    spec.components.schemas.CheckoutQuoteResponse,
    z.toJSONSchema(checkoutQuoteResponseSchema),
  );
  const operation = spec.paths['/checkout/quote'].post;
  assert.deepEqual(operation.security, [{ BearerAuth: [] }]);
  assert.equal(
    operation.responses['200'].headers['Cache-Control'].schema.const,
    'no-store',
  );
  assert.equal(
    operation.requestBody.content['application/json'].schema.$ref,
    '#/components/schemas/CheckoutQuoteInput',
  );
  assert.equal(
    operation.responses['200'].content['application/json'].schema.$ref,
    '#/components/schemas/CheckoutQuoteResponse',
  );
  for (const status of ['401', '403', '404', '409', '422'])
    assert.ok(operation.responses[status]);
  assert.equal(spec.paths['/checkout/orders'], undefined);
});
