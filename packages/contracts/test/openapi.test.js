import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { healthSchema, errorSchema } from '@marthub/contracts';
import { z } from 'zod';
import {
  registerSchema,
  loginSchema,
  publicUserSchema,
  authResponseSchema,
  profileResponseSchema,
  profileUpdateSchema,
} from '../src/auth.js';
import {
  addressCreateSchema,
  addressResponseSchema,
  addressUpdateSchema,
} from '../src/address.js';

test('OpenAPI exposes only implemented paths and agrees on required response fields', async () => {
  const spec = JSON.parse(
    await readFile(new URL('../openapi.json', import.meta.url), 'utf8'),
  );
  assert.equal(spec.openapi, '3.1.0');
  assert.deepEqual(Object.keys(spec.paths).sort(), [
    '/admin',
    '/admin/categories',
    '/admin/categories/{categoryId}',
    '/admin/categories/{categoryId}/archive',
    '/admin/inventory',
    '/admin/inventory/{productId}/adjustments',
    '/admin/inventory/{productId}/movements',
    '/admin/products',
    '/admin/products/{productId}',
    '/admin/products/{productId}/archive',
    '/admin/products/{productId}/images',
    '/admin/products/{productId}/images/signature',
    '/admin/products/{productId}/images/{imageId}',
    '/admin/products/{productId}/prices',
    '/admin/products/{productId}/publish',
    '/admin/promotions',
    '/admin/promotions/{promotionId}',
    '/admin/promotions/{promotionId}/archive',
    '/admin/promotions/{promotionId}/media',
    '/admin/promotions/{promotionId}/media/signature',
    '/admin/promotions/{promotionId}/publish',
    '/auth/login',
    '/auth/logout',
    '/auth/logout-all',
    '/auth/refresh',
    '/auth/register',
    '/cart',
    '/cart/items',
    '/cart/items/{itemId}',
    '/categories',
    '/categories/{slug}',
    '/checkout/orders',
    '/checkout/quote',
    '/health/live',
    '/health/ready',
    '/homepage',
    '/products',
    '/products/{slug}',
    '/users/me',
    '/users/me/addresses',
    '/users/me/addresses/{addressId}',
    '/users/me/addresses/{addressId}/default',
    '/wishlist',
    '/wishlist/items/{productId}',
  ]);
  assert.equal(spec.servers[0].url, '/api/v1');
  assert.deepEqual(spec.paths['/auth/logout-all'].post.security, [
    { BearerAuth: [] },
  ]);
  for (const name of ['logout', 'logout-all']) {
    assert.equal(
      spec.paths['/auth/' + name].post.responses['204'].$ref,
      '#/components/responses/AuthLoggedOut',
    );
    assert.equal(spec.paths['/auth/' + name].post.requestBody.required, false);
  }
  assert.equal(
    spec.components.responses.AuthLoggedOut.headers['Cache-Control'].schema
      .const,
    'no-store',
  );
  const health = {
    data: {
      status: 'ok',
      version:
        spec.components.schemas.Health.properties.data.properties.version.const,
    },
  };
  assert.ok(healthSchema.safeParse(health).success);
  const error = {
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred.',
      requestId: 'req_test',
    },
  };
  for (const field of spec.components.schemas.Error.properties.error.required)
    assert.ok(field in error.error);
  assert.ok(errorSchema.safeParse(error).success);
  assert.equal(
    spec.paths['/health/ready'].get.responses['503'].$ref,
    '#/components/responses/Error',
  );
});

test('OpenAPI address CRUD uses ownership paths, bearer auth, and shared inputs', async () => {
  const spec = JSON.parse(
    await readFile(new URL('../openapi.json', import.meta.url), 'utf8'),
  );
  assert.deepEqual(
    spec.components.schemas.AddressCreate,
    z.toJSONSchema(addressCreateSchema),
  );
  assert.deepEqual(
    spec.components.schemas.AddressUpdate,
    z.toJSONSchema(addressUpdateSchema),
  );
  for (const [path, methods] of Object.entries({
    '/users/me/addresses': ['get', 'post'],
    '/users/me/addresses/{addressId}': ['patch', 'delete'],
    '/users/me/addresses/{addressId}/default': ['put'],
  }))
    for (const method of methods)
      assert.deepEqual(spec.paths[path][method].security, [{ BearerAuth: [] }]);
  assert.ok(
    addressCreateSchema.safeParse(
      spec.paths['/users/me/addresses'].post.requestBody.content[
        'application/json'
      ].example,
    ).success,
  );
  const responseExample = {
    data: {
      id: 'b2ecb79a-b74a-4748-93dc-f2fc02b93b3d',
      ...spec.paths['/users/me/addresses'].post.requestBody.content[
        'application/json'
      ].example,
    },
  };
  assert.ok(addressResponseSchema.safeParse(responseExample).success);
});

test('OpenAPI profile endpoint uses bearer auth and exact shared schemas', async () => {
  const spec = JSON.parse(
    await readFile(new URL('../openapi.json', import.meta.url), 'utf8'),
  );
  assert.deepEqual(spec.paths['/users/me'].get.security, [{ BearerAuth: [] }]);
  assert.deepEqual(spec.paths['/users/me'].patch.security, [
    { BearerAuth: [] },
  ]);
  assert.deepEqual(
    spec.components.schemas.ProfileUpdate,
    z.toJSONSchema(profileUpdateSchema),
  );
  assert.deepEqual(
    spec.components.schemas.ProfileResponse,
    z.toJSONSchema(profileResponseSchema),
  );
  assert.ok(
    profileUpdateSchema.safeParse(
      spec.paths['/users/me'].patch.requestBody.content['application/json']
        .example,
    ).success,
  );
});

test('OpenAPI auth schemas match shared validators and document cookie/origin/security contracts', async () => {
  const spec = JSON.parse(
    await readFile(new URL('../openapi.json', import.meta.url), 'utf8'),
  );
  for (const [name, schema] of Object.entries({
    RegisterInput: registerSchema,
    LoginInput: loginSchema,
    PublicUser: publicUserSchema,
    AuthResponse: authResponseSchema,
  })) {
    assert.deepEqual(spec.components.schemas[name], z.toJSONSchema(schema));
  }
  assert.equal(spec.components.parameters.Origin.required, true);
  assert.equal(
    spec.components.securitySchemes.RefreshCookie.name,
    'mh_refresh',
  );
  for (const [path, status] of [
    ['register', '201'],
    ['login', '200'],
    ['refresh', '200'],
  ]) {
    const operation = spec.paths['/auth/' + path].post;
    assert.ok(
      operation.parameters.some(
        (entry) => entry.$ref === '#/components/parameters/Origin',
      ),
    );
    assert.equal(
      operation.responses[status].$ref,
      '#/components/responses/AuthSession',
    );
    assert.equal(
      operation.responses['429'].$ref,
      '#/components/responses/AuthRateLimited',
    );
    assert.deepEqual(
      operation.security,
      path === 'refresh' ? [{ RefreshCookie: [] }] : [],
    );
    const example = operation.requestBody.content['application/json'].example;
    if (path !== 'refresh')
      assert.ok(
        (path === 'register' ? registerSchema : loginSchema).safeParse(example)
          .success,
      );
  }
  assert.equal(spec.paths['/auth/refresh'].post.requestBody.required, false);
  assert.equal(spec.components.schemas.EmptyInput.additionalProperties, false);
  for (const name of ['AuthSession', 'AuthError', 'AuthRateLimited'])
    assert.equal(
      spec.components.responses[name].headers['Cache-Control'].schema.const,
      'no-store',
    );
  assert.ok(spec.components.responses.AuthRateLimited.headers['Retry-After']);
  const response = spec.components.responses.AuthSession;
  assert.ok(
    authResponseSchema.safeParse(response.content['application/json'].example)
      .success,
  );
  for (const attribute of [
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    'Path=/api/v1/auth',
  ])
    assert.ok(response.headers['Set-Cookie'].example.includes(attribute));
});
