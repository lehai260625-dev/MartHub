import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { customerOrderCancelInputSchema } from '../src/orders.js';

test('cancellation reason canonicalizes null inputs, trims before the exact boundary and rejects spoofed fields', () => {
  for (const reason of [undefined, null, '', ' \n\t '])
    assert.deepEqual(customerOrderCancelInputSchema.parse({ reason }), {
      reason: null,
    });
  assert.deepEqual(customerOrderCancelInputSchema.parse({}), { reason: null });
  assert.equal(
    customerOrderCancelInputSchema.parse({
      reason: '  ' + 'x'.repeat(240) + '  ',
    }).reason.length,
    240,
  );
  for (const reason of ['x'.repeat(241), 1, [], {}])
    assert.equal(
      customerOrderCancelInputSchema.safeParse({ reason }).success,
      false,
    );
  for (const field of [
    'status',
    'actorUserId',
    'userId',
    'quantity',
    'cancelledAt',
    'idempotencyKey',
  ])
    assert.equal(
      customerOrderCancelInputSchema.safeParse({ [field]: 'spoofed' }).success,
      false,
    );
  assert.equal(customerOrderCancelInputSchema.safeParse(null).success, false);
});

test('cancellation OpenAPI declares only the approved command, strict reason contract and existing safe detail', async () => {
  const spec = JSON.parse(
    await readFile(new URL('../openapi.json', import.meta.url), 'utf8'),
  );
  const command = spec.paths['/orders/{orderId}/cancel'].post;
  assert.deepEqual(command.security, [{ BearerAuth: [] }]);
  assert.equal(
    command.responses['200'].content['application/json'].schema.$ref,
    '#/components/schemas/CustomerOrderDetailResponse',
  );
  assert.equal(
    command.responses['200'].headers['Cache-Control'].schema.const,
    'no-store',
  );
  assert.match(command.description, /no-op/);
  for (const status of ['401', '403', '404', '409', '422', '500'])
    assert.ok(command.responses[status]);
  const input = spec.components.schemas.CustomerOrderCancelInput;
  assert.equal(input.additionalProperties, false);
  assert.deepEqual(Object.keys(input.properties), ['reason']);
  assert.match(input.properties.reason.description, /240/);
  assert.equal(spec.paths['/orders/{orderId}/reorder'], undefined);
});
