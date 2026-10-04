import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { z } from 'zod';
import {
  adminOrderDetailResponseSchema,
  adminOrderDetailSchema,
  adminOrderHistorySchema,
  adminOrderListResponseSchema,
  adminOrderQuerySchema,
  adminOrderSummarySchema,
  adminOrderTransitionInputSchema,
} from '../src/index.js';

const id = 'b2ecb79a-b74a-4748-93dc-f2fc02b93b3d';

test('Admin order query normalizes approved search and enforces exact options', () => {
  assert.deepEqual(adminOrderQuerySchema.parse({}), {
    sort: 'newest',
    page: 1,
    perPage: 20,
  });
  assert.deepEqual(
    adminOrderQuerySchema.parse({
      q: '  Minh   Anh  ',
      status: 'PACKING',
      sort: 'oldest',
      page: '2',
      perPage: '50',
    }),
    {
      q: 'Minh Anh',
      status: 'PACKING',
      sort: 'oldest',
      page: 2,
      perPage: 50,
    },
  );
  assert.equal(adminOrderQuerySchema.parse({ q: '   ' }).q, undefined);
  for (const input of [
    { q: 'x'.repeat(101) },
    { status: ['PENDING', 'DELIVERED'] },
    { status: 'UNKNOWN' },
    { page: ['1', '2'] },
    { page: '0' },
    { perPage: '51' },
    { sort: 'total' },
    { dateFrom: '2026-01-01' },
  ])
    assert.equal(adminOrderQuerySchema.safeParse(input).success, false);
});

test('Admin transition input requires stale state and exact reason policy', () => {
  assert.deepEqual(
    adminOrderTransitionInputSchema.parse({
      expectedStatus: 'CONFIRMED',
      toStatus: 'CANCELLED',
      reason: '  Customer requested cancellation  ',
    }),
    {
      expectedStatus: 'CONFIRMED',
      toStatus: 'CANCELLED',
      reason: 'Customer requested cancellation',
    },
  );
  assert.deepEqual(
    adminOrderTransitionInputSchema.parse({
      expectedStatus: 'PENDING',
      toStatus: 'CONFIRMED',
    }),
    { expectedStatus: 'PENDING', toStatus: 'CONFIRMED' },
  );
  for (const input of [
    { toStatus: 'CONFIRMED' },
    { expectedStatus: 'PENDING' },
    {
      expectedStatus: 'PENDING',
      toStatus: 'CANCELLED',
    },
    {
      expectedStatus: 'PENDING',
      toStatus: 'CANCELLED',
      reason: '   ',
    },
    {
      expectedStatus: 'PENDING',
      toStatus: 'CANCELLED',
      reason: 'x'.repeat(241),
    },
    {
      expectedStatus: 'PENDING',
      toStatus: 'CONFIRMED',
      reason: 'not allowed',
    },
    {
      expectedStatus: 'PENDING',
      toStatus: 'CONFIRMED',
      unexpected: true,
    },
  ])
    assert.equal(
      adminOrderTransitionInputSchema.safeParse(input).success,
      false,
    );
  assert.equal(
    adminOrderTransitionInputSchema.safeParse({
      expectedStatus: 'PENDING',
      toStatus: 'CANCELLED',
      reason: 'x'.repeat(240),
    }).success,
    true,
  );
});

test('Admin queue/detail schemas preserve exact snapshots and reject private extras', () => {
  const summary = {
    id,
    orderNumber: 'MH-test',
    status: 'PENDING',
    createdAt: '2026-01-01T00:00:00.000Z',
    subtotal: '9007199254740993',
    shippingFee: '0',
    discountTotal: '0',
    total: '9007199254740993',
    currency: 'VND',
    paymentMethod: 'COD',
    itemCount: 2,
    customer: { userId: id, email: 'customer@example.test' },
  };
  assert.equal(adminOrderSummarySchema.parse(summary).total, summary.total);
  for (const field of ['address', 'idempotencyKey', 'requestFingerprint'])
    assert.equal(
      adminOrderSummarySchema.safeParse({ ...summary, [field]: 'private' })
        .success,
      false,
    );
  const history = {
    id,
    status: 'PENDING',
    reason: null,
    createdAt: summary.createdAt,
    actorUserId: null,
  };
  assert.deepEqual(adminOrderHistorySchema.parse(history), history);
  for (const field of ['actorType', 'actorEmail', 'actorName'])
    assert.equal(
      adminOrderHistorySchema.safeParse({ ...history, [field]: 'private' })
        .success,
      false,
    );
  assert.equal('idempotencyKey' in adminOrderDetailSchema.shape, false);
  assert.equal('requestFingerprint' in adminOrderDetailSchema.shape, false);
});

test('Admin order OpenAPI matches strict shared contracts', async () => {
  const spec = JSON.parse(
    await readFile(new URL('../openapi.json', import.meta.url), 'utf8'),
  );
  assert.deepEqual(
    spec.components.schemas.AdminOrderListResponse,
    z.toJSONSchema(adminOrderListResponseSchema),
  );
  assert.deepEqual(
    spec.components.schemas.AdminOrderDetailResponse,
    z.toJSONSchema(adminOrderDetailResponseSchema),
  );
  assert.deepEqual(
    spec.components.schemas.AdminOrderTransitionInput,
    z.toJSONSchema(adminOrderTransitionInputSchema),
  );
  const list = spec.paths['/admin/orders'].get;
  const detail = spec.paths['/admin/orders/{orderId}'].get;
  assert.deepEqual(Object.keys(spec.paths['/admin/orders']), ['get']);
  assert.deepEqual(Object.keys(spec.paths['/admin/orders/{orderId}']), ['get']);
  const transition = spec.paths['/admin/orders/{orderId}/transitions'].post;
  assert.deepEqual(list.security, [{ BearerAuth: [] }]);
  assert.deepEqual(detail.security, [{ BearerAuth: [] }]);
  assert.equal(
    list.responses[200].headers['Cache-Control'].schema.const,
    'no-store',
  );
  assert.equal(
    detail.responses[200].headers['Cache-Control'].schema.const,
    'no-store',
  );
  const parameters = Object.fromEntries(
    list.parameters.map((parameter) => [parameter.name, parameter.schema]),
  );
  assert.deepEqual(Object.keys(parameters).sort(), [
    'page',
    'perPage',
    'q',
    'sort',
    'status',
  ]);
  assert.equal(parameters.q.maxLength, 100);
  assert.equal(parameters.page.default, 1);
  assert.equal(parameters.perPage.default, 20);
  assert.equal(parameters.perPage.maximum, 50);
  assert.deepEqual(parameters.sort.enum, ['newest', 'oldest']);
  assert.equal(detail.parameters.length, 1);
  assert.equal(detail.parameters[0].name, 'orderId');
  assert.deepEqual(transition.security, [{ BearerAuth: [] }]);
  assert.equal(
    transition.requestBody.content['application/json'].schema.$ref,
    '#/components/schemas/AdminOrderTransitionInput',
  );
  assert.equal(
    transition.responses[200].content['application/json'].schema.$ref,
    '#/components/schemas/AdminOrderDetailResponse',
  );
  assert.equal(transition.responses[409].$ref, '#/components/responses/Error');
});
