import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { z } from 'zod';
import {
  categoryListResponseSchema,
  homepageResponseSchema,
  categoryResponseSchema,
  productListResponseSchema,
  productQuerySchema,
  productResponseSchema,
} from '../src/index.js';

test('public catalog OpenAPI paths match implemented shared response contracts', async () => {
  const spec = JSON.parse(
    await readFile(new URL('../openapi.json', import.meta.url), 'utf8'),
  );
  assert.deepEqual(
    spec.paths['/products'].get.parameters.map(({ name }) => name),
    [
      'q',
      'category',
      'minPrice',
      'maxPrice',
      'availability',
      'featured',
      'new',
      'popular',
      'sort',
      'page',
      'perPage',
    ],
  );
  for (const [path, schema, name] of [
    ['/categories', categoryListResponseSchema, 'CategoryListResponse'],
    ['/categories/{slug}', categoryResponseSchema, 'CategoryResponse'],
    ['/products', productListResponseSchema, 'ProductListResponse'],
    ['/products/{slug}', productResponseSchema, 'ProductResponse'],
  ]) {
    const route = spec.paths[path].get;
    assert.deepEqual(route.security, []);
    assert.deepEqual(
      route.responses['200'].content['application/json'].schema,
      { $ref: `#/components/schemas/${name}` },
    );
    assert.deepEqual(spec.components.schemas[name], z.toJSONSchema(schema));
  }
});

test('product query contract normalizes search and rejects conflicting or unbounded input', () => {
  const parsed = productQuerySchema.parse({
    q: '  Cove   mug  ',
    page: '2',
    perPage: '3',
  });
  assert.equal(parsed.q, 'Cove mug');
  assert.equal(parsed.sort, 'relevance');
  assert.equal(parsed.page, 2);
  assert.equal(parsed.perPage, 3);
  assert.equal(productQuerySchema.parse({}).sort, 'newest');
  assert.equal(productQuerySchema.parse({}).page, 1);
  assert.equal(productQuerySchema.parse({}).perPage, 24);
  for (const query of [
    { q: 'a' },
    { sort: 'relevance' },
    { minPrice: '200', maxPrice: '100' },
    { perPage: '61' },
    { page: '0' },
    { unknown: 'value' },
  ])
    assert.equal(productQuerySchema.safeParse(query).success, false);
});

test('homepage OpenAPI contract is public, bounded, and documents cache freshness', async () => {
  const spec = JSON.parse(
    await readFile(new URL('../openapi.json', import.meta.url), 'utf8'),
  );
  const route = spec.paths['/homepage'].get;
  assert.deepEqual(route.security, []);
  assert.deepEqual(route.responses['200'].content['application/json'].schema, {
    $ref: '#/components/schemas/HomepageResponse',
  });
  assert.equal(
    route.responses['200'].headers['Cache-Control'].schema.const,
    'public, max-age=60, s-maxage=300, stale-while-revalidate=600',
  );
  assert.deepEqual(
    spec.components.schemas.HomepageResponse,
    z.toJSONSchema(homepageResponseSchema),
  );
});
