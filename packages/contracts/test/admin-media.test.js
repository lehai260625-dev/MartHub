import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { z } from 'zod';
import {
  adminMediaCleanupResponseSchema,
  adminMediaSignatureResponseSchema,
  adminProductImageRegisterSchema,
  adminProductImageResponseSchema,
  adminProductImageUpdateSchema,
} from '../src/admin-media.js';

test('media contracts enforce registration metadata and immutable provider fields', () => {
  const valid = {
    publicId: 'marthub/products/b2ecb79a-b74a-4748-93dc-f2fc02b93b3d/asset_1',
    uploadTimestamp: 1_790_000_000,
    uploadSignature: 'a'.repeat(40),
    altText: 'Front view of the product',
    sortOrder: 0,
    isPrimary: true,
  };
  assert.equal(adminProductImageRegisterSchema.safeParse(valid).success, true);
  for (const change of [
    { publicId: '../outside' },
    { altText: '<b>unsafe</b>' },
    { sortOrder: -1 },
    { uploadSignature: 'secret' },
    { width: 100 },
  ])
    assert.equal(
      adminProductImageRegisterSchema.safeParse({ ...valid, ...change })
        .success,
      false,
    );
  assert.equal(
    adminProductImageUpdateSchema.safeParse({ sortOrder: 2, isPrimary: true })
      .success,
    true,
  );
  assert.equal(
    adminProductImageUpdateSchema.safeParse({ url: 'https://evil.test' })
      .success,
    false,
  );
});

test('signature response contract fixes format, size, and expiry-safe fields', () => {
  const response = {
    data: {
      cloudName: 'marthub-test',
      apiKey: '123',
      uploadUrl: 'https://api.cloudinary.com/upload',
      expiresAt: '2026-09-20T00:05:00.000Z',
      parameters: {
        allowed_formats: 'jpg,png,webp',
        folder: 'marthub/products/id',
        max_file_size: 4_194_304,
        public_id: 'marthub/products/id/asset',
        timestamp: 1_790_000_000,
        signature: 'a'.repeat(40),
      },
    },
  };
  assert.equal(
    adminMediaSignatureResponseSchema.safeParse(response).success,
    true,
  );
  assert.equal(
    adminMediaSignatureResponseSchema.safeParse({
      ...response,
      data: { ...response.data, apiSecret: 'never' },
    }).success,
    false,
  );
});

test('OpenAPI documents the protected media endpoints with exact shared schemas', async () => {
  const spec = JSON.parse(
    await readFile(new URL('../openapi.json', import.meta.url), 'utf8'),
  );
  for (const [path, methods] of Object.entries({
    '/admin/products/{productId}/images/signature': ['post'],
    '/admin/products/{productId}/images': ['post'],
    '/admin/products/{productId}/images/{imageId}': ['patch', 'delete'],
  }))
    for (const method of methods)
      assert.deepEqual(spec.paths[path][method].security, [{ BearerAuth: [] }]);
  for (const [name, schema] of Object.entries({
    AdminMediaSignatureResponse: adminMediaSignatureResponseSchema,
    AdminProductImageRegister: adminProductImageRegisterSchema,
    AdminProductImageUpdate: adminProductImageUpdateSchema,
    AdminProductImageResponse: adminProductImageResponseSchema,
    AdminMediaCleanupResponse: adminMediaCleanupResponseSchema,
  }))
    assert.deepEqual(spec.components.schemas[name], z.toJSONSchema(schema));
  assert.equal(
    spec.paths['/admin/products/{productId}/images/{imageId}'].delete.responses[
      '202'
    ].content['application/json'].schema.$ref,
    '#/components/schemas/AdminMediaCleanupResponse',
  );
});
