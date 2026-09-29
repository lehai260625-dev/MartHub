import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { z } from 'zod';
import {
  cartAddSchema,
  cartQuantityUpdateSchema,
  cartResponseSchema,
  MAX_CART_ITEM_QUANTITY,
} from '../src/index.js';

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

test('cart add contract enforces the approved 1-99 quantity policy strictly', () => {
  assert.equal(MAX_CART_ITEM_QUANTITY, 99);
  for (const quantity of [1, 99])
    assert.equal(
      cartAddSchema.safeParse({ productId: product.id, quantity }).success,
      true,
    );
  for (const input of [
    { productId: product.id, quantity: 0 },
    { productId: product.id, quantity: 100 },
    { productId: product.id, quantity: 1.5 },
    { productId: product.id, quantity: '1' },
    { productId: product.id, quantity: 1, userId: product.id },
  ])
    assert.equal(cartAddSchema.safeParse(input).success, false);
});

test('cart quantity update contract sets one strict 1-99 quantity', () => {
  for (const quantity of [1, 99])
    assert.equal(
      cartQuantityUpdateSchema.safeParse({ quantity }).success,
      true,
    );
  for (const input of [
    { quantity: 0 },
    { quantity: 100 },
    { quantity: -1 },
    { quantity: 1.5 },
    { quantity: '1' },
    { quantity: 1, productId: product.id },
    {},
  ])
    assert.equal(cartQuantityUpdateSchema.safeParse(input).success, false);
});
test('cart response carries current exact-VND product cards and explicit unavailable lines', () => {
  assert.equal(
    cartResponseSchema.safeParse({
      data: {
        id: '8ae0b1ba-2414-4d55-a0ad-7cc6ab8a4f96',
        itemCount: 2,
        items: [
          {
            id: 'bca61ed7-dc50-4aa0-bbf7-b4561e572d3a',
            productId: product.id,
            quantity: 1,
            availability: 'IN_STOCK',
            product,
          },
          {
            id: 'a92868e2-c526-4d3f-92f8-d73746547fc5',
            productId: '7846f9c2-a3f4-4145-86d6-118319d06513',
            quantity: 1,
            availability: 'UNAVAILABLE',
            product: null,
          },
        ],
      },
    }).success,
    true,
  );
});

test('cart OpenAPI paths use bearer auth and exact shared contracts', async () => {
  const spec = JSON.parse(
    await readFile(new URL('../openapi.json', import.meta.url), 'utf8'),
  );
  assert.deepEqual(
    spec.components.schemas.CartAdd,
    z.toJSONSchema(cartAddSchema),
  );
  assert.deepEqual(
    spec.components.schemas.CartResponse,
    z.toJSONSchema(cartResponseSchema),
  );
  assert.deepEqual(
    spec.components.schemas.CartQuantityUpdate,
    z.toJSONSchema(cartQuantityUpdateSchema),
  );
  for (const [path, method] of [
    ['/cart', 'get'],
    ['/cart/items', 'post'],
    ['/cart/items', 'delete'],
    ['/cart/items/{itemId}', 'patch'],
    ['/cart/items/{itemId}', 'delete'],
  ]) {
    const operation = spec.paths[path][method];
    assert.deepEqual(operation.security, [{ BearerAuth: [] }]);
    assert.deepEqual(
      operation.responses['200'].content['application/json'].schema,
      { $ref: '#/components/schemas/CartResponse' },
    );
    assert.equal(
      operation.responses['200'].headers['Cache-Control'].schema.const,
      'no-store',
    );
  }
  assert.deepEqual(
    spec.paths['/cart/items'].post.requestBody.content['application/json']
      .schema,
    { $ref: '#/components/schemas/CartAdd' },
  );
  assert.ok(
    cartAddSchema.safeParse(
      spec.paths['/cart/items'].post.requestBody.content['application/json']
        .example,
    ).success,
  );
  assert.deepEqual(
    spec.paths['/cart/items/{itemId}'].patch.requestBody.content[
      'application/json'
    ].schema,
    { $ref: '#/components/schemas/CartQuantityUpdate' },
  );
  assert.ok(
    cartQuantityUpdateSchema.safeParse(
      spec.paths['/cart/items/{itemId}'].patch.requestBody.content[
        'application/json'
      ].example,
    ).success,
  );
});
