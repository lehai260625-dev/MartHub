import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { z } from 'zod';
import { adminSessionResponseSchema, adminUserSchema } from '../src/index.js';

const admin = {
  id: 'b2ecb79a-b74a-4748-93dc-f2fc02b93b3d',
  email: 'admin@example.test',
  firstName: 'Admin',
  lastName: 'User',
  phone: null,
  role: 'ADMIN',
  status: 'ACTIVE',
};

test('admin session contract requires an ADMIN and matches OpenAPI', async () => {
  assert.deepEqual(
    adminSessionResponseSchema.parse({ data: { user: admin } }),
    {
      data: { user: admin },
    },
  );
  assert.equal(
    adminUserSchema.safeParse({ ...admin, role: 'CUSTOMER' }).success,
    false,
  );

  const spec = JSON.parse(
    await readFile(new URL('../openapi.json', import.meta.url), 'utf8'),
  );
  const route = spec.paths['/admin'].get;
  assert.deepEqual(route.security, [{ BearerAuth: [] }]);
  assert.deepEqual(route.responses['200'].content['application/json'].schema, {
    $ref: '#/components/schemas/AdminSessionResponse',
  });
  assert.deepEqual(route.responses['401'], {
    $ref: '#/components/responses/AuthError',
  });
  assert.deepEqual(route.responses['403'], {
    $ref: '#/components/responses/AuthError',
  });
  assert.deepEqual(
    spec.components.schemas.AdminSessionResponse,
    z.toJSONSchema(adminSessionResponseSchema),
  );
});
