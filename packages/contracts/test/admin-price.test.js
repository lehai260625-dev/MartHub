import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { z } from 'zod';
import {
  adminProductPriceCreateSchema,
  adminProductPriceHistoryResponseSchema,
  adminProductPriceResponseSchema,
} from '../src/admin-price.js';

test('price successor contract enforces exact positive VND and compare invariant', () => {
  const valid = {
    price: '9007199254741993',
    compareAtPrice: '9007199254742993',
    startsAt: '2026-10-01T00:00:00.000Z',
  };
  assert.equal(adminProductPriceCreateSchema.safeParse(valid).success, true);
  for (const change of [
    { price: '0' },
    { price: '1.5' },
    { price: '9223372036854775808' },
    { compareAtPrice: valid.price },
    { compareAtPrice: '1' },
    { startsAt: 'tomorrow' },
    { startsAt: '2026-10-01T00:00:00.000001Z' },
    { endsAt: null },
  ])
    assert.equal(
      adminProductPriceCreateSchema.safeParse({ ...valid, ...change }).success,
      false,
    );
});

test('price history contract preserves exact values, actor, and current state', () => {
  const row = {
    id: '7984f43d-f8fb-45a7-94d6-cdb60e278081',
    productId: '0e7b73b7-9db0-4ae0-80b5-08e4049162cf',
    price: '349000',
    compareAtPrice: '399000',
    startsAt: '2026-09-21T00:00:00.000Z',
    endsAt: null,
    createdAt: '2026-09-21T00:00:00.000Z',
    isCurrent: true,
    createdBy: {
      id: 'b2ecb79a-b74a-4748-93dc-f2fc02b93b3d',
      email: 'admin@example.test',
      firstName: 'Admin',
      lastName: 'User',
    },
  };
  assert.equal(
    adminProductPriceResponseSchema.safeParse({ data: row }).success,
    true,
  );
  assert.equal(
    adminProductPriceHistoryResponseSchema.safeParse({ data: [row] }).success,
    true,
  );
});

test('OpenAPI documents protected price history routes with exact schemas', async () => {
  const spec = JSON.parse(
    await readFile(new URL('../openapi.json', import.meta.url), 'utf8'),
  );
  const path = spec.paths['/admin/products/{productId}/prices'];
  assert.deepEqual(path.get.security, [{ BearerAuth: [] }]);
  assert.deepEqual(path.post.security, [{ BearerAuth: [] }]);
  assert.equal(
    path.post.requestBody.content['application/json'].schema.$ref,
    '#/components/schemas/AdminProductPriceCreate',
  );
  for (const [name, schema] of Object.entries({
    AdminProductPriceCreate: adminProductPriceCreateSchema,
    AdminProductPriceResponse: adminProductPriceResponseSchema,
    AdminProductPriceHistoryResponse: adminProductPriceHistoryResponseSchema,
  }))
    assert.deepEqual(spec.components.schemas[name], z.toJSONSchema(schema));
  assert.equal(
    path.post.responses['409'].$ref,
    '#/components/responses/AuthError',
  );
});
