import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { z } from 'zod';
import {
  adminCategoryCreateSchema,
  adminCategoryListResponseSchema,
  adminCategoryResponseSchema,
  adminCategoryUpdateSchema,
} from '../src/index.js';

test('admin category inputs enforce immutable slugs and bounded tree fields', () => {
  assert.deepEqual(
    adminCategoryCreateSchema.parse({
      name: '  Home care  ',
      slug: 'home-care',
      description: '  Daily essentials  ',
      parentId: null,
      sortOrder: 8,
    }),
    {
      name: 'Home care',
      slug: 'home-care',
      description: 'Daily essentials',
      parentId: null,
      sortOrder: 8,
    },
  );
  assert.equal(
    adminCategoryUpdateSchema.safeParse({ name: 'Updated', sortOrder: 2 })
      .success,
    true,
  );
  for (const input of [
    { name: 'Invalid', slug: 'Invalid Slug' },
    { name: '<script>', slug: 'safe' },
    { name: 'Valid', slug: 'valid', sortOrder: -1 },
    { name: 'Valid', slug: 'valid', unknown: true },
  ])
    assert.equal(adminCategoryCreateSchema.safeParse(input).success, false);
  for (const input of [{}, { slug: 'changed-slug' }, { status: 'ARCHIVED' }])
    assert.equal(adminCategoryUpdateSchema.safeParse(input).success, false);
});

test('admin category OpenAPI paths use shared schemas and Admin security', async () => {
  const spec = JSON.parse(
    await readFile(new URL('../openapi.json', import.meta.url), 'utf8'),
  );
  const collection = spec.paths['/admin/categories'];
  const detail = spec.paths['/admin/categories/{categoryId}'];
  const archive = spec.paths['/admin/categories/{categoryId}/archive'];

  for (const operation of [
    collection.get,
    collection.post,
    detail.get,
    detail.patch,
    archive.post,
  ])
    assert.deepEqual(operation.security, [{ BearerAuth: [] }]);

  assert.deepEqual(
    collection.get.responses['200'].content['application/json'].schema,
    { $ref: '#/components/schemas/AdminCategoryListResponse' },
  );
  assert.deepEqual(
    collection.post.requestBody.content['application/json'].schema,
    { $ref: '#/components/schemas/AdminCategoryCreate' },
  );
  assert.deepEqual(
    detail.patch.requestBody.content['application/json'].schema,
    { $ref: '#/components/schemas/AdminCategoryUpdate' },
  );
  assert.equal(archive.post.requestBody, undefined);

  for (const [name, schema] of [
    ['AdminCategoryCreate', adminCategoryCreateSchema],
    ['AdminCategoryUpdate', adminCategoryUpdateSchema],
    ['AdminCategoryResponse', adminCategoryResponseSchema],
    ['AdminCategoryListResponse', adminCategoryListResponseSchema],
  ])
    assert.deepEqual(spec.components.schemas[name], z.toJSONSchema(schema));
});
