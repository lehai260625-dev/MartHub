import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { z } from 'zod';
import {
  customerOrderQuerySchema,
  customerOrderSummarySchema,
  customerOrderHistorySchema,
  customerOrderListResponseSchema,
  customerOrderDetailResponseSchema,
  customerOrderDetailSchema,
  customerOrderStatusSchema,
} from '../src/index.js';

test('Customer order query implements approved pagination/filter/sort and rejects spoofed or ambiguous parameters', () => {
  assert.deepEqual(customerOrderQuerySchema.parse({}), {
    page: 1,
    perPage: 20,
    sort: 'newest',
  });
  assert.deepEqual(
    customerOrderQuerySchema.parse({
      page: '2',
      perPage: '50',
      status: 'DELIVERED',
      sort: 'oldest',
    }),
    { page: 2, perPage: 50, status: 'DELIVERED', sort: 'oldest' },
  );
  for (const input of [
    { perPage: '51' },
    { page: '0' },
    { page: ['1', '2'] },
    { sort: 'createdAt' },
    { status: 'fake' },
    { dateFrom: '2020-01-01' },
    { userId: 'spoof' },
    { page: '999999999999999999' },
  ])
    assert.equal(customerOrderQuerySchema.safeParse(input).success, false);
});

test('Customer summary and history allowlists exclude private identity and preserve exact money', () => {
  const row = {
    id: 'b2ecb79a-b74a-4748-93dc-f2fc02b93b3d',
    orderNumber: 'MH-test',
    status: 'PENDING',
    createdAt: '2026-01-01T00:00:00.000Z',
    subtotal: '9007199254740993',
    shippingFee: '0',
    discountTotal: '0',
    total: '9007199254740993',
    currency: 'VND',
    paymentMethod: 'COD',
    itemCount: 3,
  };
  assert.equal(customerOrderSummarySchema.parse(row).total, '9007199254740993');
  for (const field of [
    'address',
    'userId',
    'requestFingerprint',
    'idempotencyKey',
    'email',
  ])
    assert.equal(
      customerOrderSummarySchema.safeParse({ ...row, [field]: 'private' })
        .success,
      false,
    );
  const history = {
    fromStatus: null,
    toStatus: 'PENDING',
    reason: 'Customer note',
    createdAt: row.createdAt,
  };
  assert.deepEqual(customerOrderHistorySchema.parse(history), history);
  for (const field of ['actorUserId', 'email', 'actor', 'actorType'])
    assert.equal(
      customerOrderHistorySchema.safeParse({ ...history, [field]: 'private' })
        .success,
      false,
    );
  assert.equal(
    customerOrderHistorySchema.safeParse({ ...history, toStatus: 'INVALID' })
      .success,
    false,
  );
  assert.equal('idempotencyKey' in customerOrderDetailSchema.shape, false);
  assert.equal('requestFingerprint' in customerOrderDetailSchema.shape, false);
});

test('Customer order OpenAPI matches shared response schemas, authorization, pagination and read-only scope', async () => {
  const spec = JSON.parse(
    await readFile(new URL('../openapi.json', import.meta.url), 'utf8'),
  );
  assert.deepEqual(
    spec.components.schemas.CustomerOrderListResponse,
    z.toJSONSchema(customerOrderListResponseSchema),
  );
  assert.deepEqual(
    spec.components.schemas.CustomerOrderDetailResponse,
    z.toJSONSchema(customerOrderDetailResponseSchema),
  );
  for (const path of ['/orders', '/orders/{orderId}']) {
    assert.deepEqual(Object.keys(spec.paths[path]), ['get']);
    assert.deepEqual(spec.paths[path].get.security, [{ BearerAuth: [] }]);
    assert.equal(
      spec.paths[path].get.responses[200].headers['Cache-Control'].schema.const,
      'no-store',
    );
    for (const code of [401, 403, 404, 422])
      assert.ok(spec.paths[path].get.responses[code]);
  }
  const parameters = Object.fromEntries(
    spec.paths['/orders'].get.parameters.map((param) => [
      param.name,
      param.schema,
    ]),
  );
  assert.equal(parameters.page.default, 1);
  assert.equal(parameters.perPage.default, 20);
  assert.equal(parameters.perPage.maximum, 50);
  assert.deepEqual(
    parameters.status,
    z.toJSONSchema(customerOrderStatusSchema),
  );
  assert.deepEqual(parameters.sort.enum, ['newest', 'oldest']);
  assert.deepEqual(Object.keys(parameters).sort(), [
    'page',
    'perPage',
    'sort',
    'status',
  ]);
  assert.ok(spec.paths['/orders/{orderId}/cancel'].post);
});
