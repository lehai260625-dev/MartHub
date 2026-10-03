import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { z } from 'zod';
import {
  myItemsQuerySchema,
  myItemsResponseSchema,
  myItemSchema,
} from '../src/index.js';

test('My Items validates only the approved pagination and sorts', () => {
  assert.deepEqual(myItemsQuerySchema.parse({}), {
    page: 1,
    perPage: 20,
    sort: 'recent',
  });
  assert.deepEqual(
    myItemsQuerySchema.parse({ page: '2', perPage: '50', sort: 'frequent' }),
    { page: 2, perPage: 50, sort: 'frequent' },
  );
  for (const query of [
    { page: '0' },
    { perPage: '51' },
    { sort: 'newest' },
    { status: 'DELIVERED' },
    { userId: 'spoof' },
    { page: ['1', '2'] },
    { page: '9999999999999999999' },
    { page: '2147483649', perPage: '2' },
  ])
    assert.equal(myItemsQuerySchema.safeParse(query).success, false);
});

test('My Items preserves safe persisted identity while representing unavailable current state explicitly', () => {
  const entry = {
    productId: '11111111-1111-4111-8111-111111111111',
    orderId: '22222222-2222-4222-8222-222222222222',
    purchaseCount: 5,
    lastPurchasedAt: '2020-01-01T00:00:00.000Z',
    snapshot: {
      sku: 'OLD',
      productName: 'Purchased name',
      imageUrl: null,
      sellingUnit: 'box',
    },
    currentProduct: null,
    currentPrice: null,
    availability: 'UNAVAILABLE',
  };
  assert.deepEqual(myItemSchema.parse(entry), entry);
  for (const field of [
    'userId',
    'actorUserId',
    'requestFingerprint',
    'quantityOnHand',
    'internalStatus',
  ])
    assert.equal(
      myItemSchema.safeParse({ ...entry, [field]: 'private' }).success,
      false,
    );
  assert.equal(
    myItemSchema.safeParse({
      ...entry,
      snapshot: { ...entry.snapshot, privateField: 'private' },
    }).success,
    false,
  );
  assert.equal(
    myItemSchema.safeParse({
      ...entry,
      currentPrice: Number('9007199254740993'),
    }).success,
    false,
  );
  assert.equal(
    myItemSchema.safeParse({ ...entry, currentPrice: '9007199254740993' })
      .success,
    true,
  );
});

test('My Items OpenAPI matches the shared response and documents only implemented Customer scope', async () => {
  const spec = JSON.parse(
    await readFile(new URL('../openapi.json', import.meta.url), 'utf8'),
  );
  const read = spec.paths['/users/me/items'].get;
  assert.deepEqual(read.security, [{ BearerAuth: [] }]);
  assert.equal(
    read.responses['200'].headers['Cache-Control'].schema.const,
    'no-store',
  );
  assert.deepEqual(
    spec.components.schemas.MyItemsResponse,
    z.toJSONSchema(myItemsResponseSchema),
  );
  assert.deepEqual(
    read.parameters.map((p) => p.name),
    ['page', 'perPage', 'sort'],
  );
  assert.deepEqual(read.parameters[2].schema.enum, ['recent', 'frequent']);
  assert.equal(read.parameters[1].schema.maximum, 50);
  for (const status of ['401', '403', '422', '500'])
    assert.ok(read.responses[status]);
  assert.ok(spec.paths['/orders/{orderId}/reorder'].post);
  assert.equal(spec.paths['/users/me/recommendations'], undefined);
});
