import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { z } from 'zod';
import {
  recommendationsQuerySchema,
  recommendationsResponseSchema,
} from '../src/recommendations.js';

const card = {
  id: 'da7a0000-0000-4000-8000-020000000001',
  slug: 'mug',
  sku: 'MUG',
  name: 'Mug',
  shortDescription: null,
  image: null,
  price: '9007199254740993',
  compareAtPrice: null,
  currency: 'VND',
  sellingUnit: 'each',
  badges: [],
  availability: { status: 'IN_STOCK', canAddToCart: true },
};
test('recommendations query rejects all client selection/ranking/identity inputs', () => {
  assert.ok(recommendationsQuerySchema.safeParse({}).success);
  for (const field of [
    'userId',
    'limit',
    'categoryId',
    'label',
    'sort',
    'page',
  ])
    assert.equal(
      recommendationsQuerySchema.safeParse({ [field]: 'spoof' }).success,
      false,
    );
});
test('source labels, eligible cards, exact prices, bound and redaction are strict', () => {
  const response = { data: { label: 'PERSONALIZED', products: [card] } };
  assert.deepEqual(recommendationsResponseSchema.parse(response), response);
  assert.ok(
    recommendationsResponseSchema.safeParse({
      data: { label: 'POPULAR', products: [] },
    }).success,
  );
  for (const data of [
    { label: 'PERSONALIZED', products: [] },
    { label: 'UNKNOWN', products: [card] },
    { label: 'POPULAR', products: Array(9).fill(card) },
    { label: 'POPULAR', products: [{ ...card, actorUserId: 'private' }] },
    {
      label: 'POPULAR',
      products: [
        {
          ...card,
          availability: { status: 'OUT_OF_STOCK', canAddToCart: false },
        },
      ],
    },
    { label: 'PERSONALIZED', products: [card], categoryAffinity: 'private' },
  ])
    assert.equal(
      recommendationsResponseSchema.safeParse({ data }).success,
      false,
    );
});
test('recommendation OpenAPI matches implemented Customer-only no-store contract', async () => {
  const spec = JSON.parse(
    await readFile(new URL('../openapi.json', import.meta.url), 'utf8'),
  );
  assert.deepEqual(
    spec.components.schemas.RecommendationsResponse,
    z.toJSONSchema(recommendationsResponseSchema),
  );
  const get = spec.paths['/users/me/recommendations'].get;
  assert.deepEqual(get.security, [{ BearerAuth: [] }]);
  assert.deepEqual(get.parameters, []);
  assert.equal(
    get.responses['200'].headers['Cache-Control'].schema.const,
    'no-store',
  );
  assert.equal(
    get.responses['200'].content['application/json'].schema.$ref,
    '#/components/schemas/RecommendationsResponse',
  );
});
