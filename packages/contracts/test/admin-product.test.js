import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import {
  adminProductCreateSchema,
  adminProductListResponseSchema,
  adminProductQuerySchema,
  adminProductResponseSchema,
  adminProductUpdateSchema,
} from '../src/admin-product.js';

test('admin product create validates identity, category, and exact VND price', () => {
  const valid = {
    categoryId: 'b2ecb79a-b74a-4748-93dc-f2fc02b93b3d',
    sku: 'MHB-OPS-001',
    slug: 'oak-desk-lamp',
    name: 'Oak desk lamp',
    sellingUnit: 'each',
    price: '349000',
    compareAtPrice: '399000',
  };
  assert.equal(adminProductCreateSchema.safeParse(valid).success, true);
  for (const change of [
    { sku: 'lowercase sku' },
    { slug: 'Not-Lowercase' },
    { categoryId: 'missing' },
    { price: '0' },
    { price: '349000.50' },
    { compareAtPrice: '349000' },
    { status: 'ACTIVE' },
  ])
    assert.equal(
      adminProductCreateSchema.safeParse({ ...valid, ...change }).success,
      false,
    );
});

test('admin product update preserves stable identities and dedicated commands', () => {
  assert.equal(
    adminProductUpdateSchema.safeParse({ name: 'New name' }).success,
    true,
  );
  for (const input of [
    {},
    { sku: 'MHB-NEW' },
    { slug: 'new-slug' },
    { price: '1000' },
    { status: 'ACTIVE' },
  ])
    assert.equal(adminProductUpdateSchema.safeParse(input).success, false);
});

test('admin product list query is bounded and strict', () => {
  assert.deepEqual(adminProductQuerySchema.parse({}), { page: 1, perPage: 24 });
  assert.equal(
    adminProductQuerySchema.safeParse({ status: 'ACTIVE', page: '2' }).success,
    true,
  );
  assert.equal(
    adminProductQuerySchema.safeParse({ status: 'HIDDEN' }).success,
    false,
  );
  assert.equal(
    adminProductQuerySchema.safeParse({ perPage: '61' }).success,
    false,
  );
  assert.equal(
    adminProductQuerySchema.safeParse({ unknown: 'field' }).success,
    false,
  );
});

test('admin product OpenAPI matches shared schemas and protects every route', async () => {
  const spec = JSON.parse(
    await readFile(new URL('../openapi.json', import.meta.url), 'utf8'),
  );
  for (const [name, schema] of Object.entries({
    AdminProductCreate: adminProductCreateSchema,
    AdminProductUpdate: adminProductUpdateSchema,
    AdminProductResponse: adminProductResponseSchema,
    AdminProductListResponse: adminProductListResponseSchema,
  }))
    assert.deepEqual(spec.components.schemas[name], z.toJSONSchema(schema));
  for (const [path, methods] of Object.entries({
    '/admin/products': ['get', 'post'],
    '/admin/products/{productId}': ['get', 'patch'],
    '/admin/products/{productId}/publish': ['post'],
    '/admin/products/{productId}/archive': ['post'],
  }))
    for (const method of methods) {
      assert.deepEqual(spec.paths[path][method].security, [{ BearerAuth: [] }]);
      const success =
        spec.paths[path][method].responses[
          method === 'post' && path === '/admin/products' ? '201' : '200'
        ];
      assert.equal(success.headers['Cache-Control'].schema.const, 'no-store');
    }
});
