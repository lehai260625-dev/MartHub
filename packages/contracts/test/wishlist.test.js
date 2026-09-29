import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { z } from 'zod';
import { wishlistResponseSchema } from '../src/index.js';

const product = {
  id: 'b2ecb79a-b74a-4748-93dc-f2fc02b93b3d',
  slug: 'cove-mug',
  sku: 'COVE-001',
  name: 'Cove mug',
  shortDescription: null,
  image: null,
  price: '9007199254740993',
  compareAtPrice: null,
  currency: 'VND',
  sellingUnit: 'each',
  badges: [],
  availability: { status: 'IN_STOCK', canAddToCart: true },
};

test('wishlist response carries current product cards and explicit unavailable items', () => {
  assert.equal(
    wishlistResponseSchema.safeParse({
      data: {
        id: '8ae0b1ba-2414-4d55-a0ad-7cc6ab8a4f96',
        itemCount: 2,
        items: [
          {
            id: 'bca61ed7-dc50-4aa0-bbf7-b4561e572d3a',
            productId: product.id,
            availability: 'IN_STOCK',
            product,
          },
          {
            id: 'a92868e2-c526-4d3f-92f8-d73746547fc5',
            productId: '7846f9c2-a3f4-4145-86d6-118319d06513',
            availability: 'UNAVAILABLE',
            product: null,
          },
        ],
      },
    }).success,
    true,
  );
});

test('wishlist OpenAPI paths use bearer auth and the shared response contract', async () => {
  const spec = JSON.parse(
    await readFile(new URL('../openapi.json', import.meta.url), 'utf8'),
  );
  assert.deepEqual(
    spec.components.schemas.WishlistResponse,
    z.toJSONSchema(wishlistResponseSchema),
  );
  for (const [path, method, status] of [
    ['/wishlist', 'get', '200'],
    ['/wishlist/items/{productId}', 'put', '200'],
    ['/wishlist/items/{productId}', 'delete', '204'],
  ]) {
    const operation = spec.paths[path][method];
    assert.deepEqual(operation.security, [{ BearerAuth: [] }]);
    assert.equal(
      operation.responses[status].headers['Cache-Control'].schema.const,
      'no-store',
    );
  }
  assert.deepEqual(
    spec.paths['/wishlist'].get.responses['200'].content['application/json']
      .schema,
    { $ref: '#/components/schemas/WishlistResponse' },
  );
  assert.deepEqual(
    spec.paths['/wishlist/items/{productId}'].put.responses['200'].content[
      'application/json'
    ].schema,
    { $ref: '#/components/schemas/WishlistResponse' },
  );
  assert.equal(
    Object.hasOwn(
      spec.paths['/wishlist/items/{productId}'].delete.responses['204'],
      'content',
    ),
    false,
  );
});
