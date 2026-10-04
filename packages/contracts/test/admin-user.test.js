import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import {
  adminUserQuerySchema,
  adminUserStatusInputSchema,
  adminManagedUserSchema,
  adminUserListResponseSchema,
  adminUserDetailResponseSchema,
  allowedAdminUserStatuses,
} from '../src/index.js';

test('User queries normalize and reject repeated, invalid, unsupported values', () => {
  assert.deepEqual(adminUserQuerySchema.parse({}), {
    sort: 'newest',
    page: 1,
    perPage: 20,
  });
  assert.equal(
    adminUserQuerySchema.parse({ q: '  Minh   Anh ' }).q,
    'Minh Anh',
  );
  assert.equal(adminUserQuerySchema.parse({ q: '   ' }).q, undefined);
  for (const q of [
    { q: 'x'.repeat(101) },
    { role: ['ADMIN', 'CUSTOMER'] },
    { status: 'DISABLED' },
    { page: '0' },
    { page: ['1', '2'] },
    { perPage: '51' },
    { sort: 'random' },
    { secret: true },
  ])
    assert.equal(adminUserQuerySchema.safeParse(q).success, false);
});
test('Status input enforces reasons, immutable role, and the full per-role matrix', () => {
  assert.equal(
    adminUserStatusInputSchema.parse({
      expectedStatus: 'ACTIVE',
      toStatus: 'SUSPENDED',
      reason: '  review  ',
    }).reason,
    'review',
  );
  for (const reason of [null, '', '  ', 'x'.repeat(241)])
    assert.equal(
      adminUserStatusInputSchema.safeParse({
        expectedStatus: 'ACTIVE',
        toStatus: 'SUSPENDED',
        reason,
      }).success,
      false,
    );
  assert.equal(
    adminUserStatusInputSchema.safeParse({
      expectedStatus: 'ACTIVE',
      toStatus: 'SUSPENDED',
      reason: 'x'.repeat(240),
    }).success,
    true,
  );
  assert.equal(
    adminUserStatusInputSchema.safeParse({
      expectedStatus: 'SUSPENDED',
      toStatus: 'ACTIVE',
      reason: null,
    }).success,
    false,
  );
  assert.equal(
    adminUserStatusInputSchema.safeParse({
      expectedStatus: 'SUSPENDED',
      toStatus: 'ACTIVE',
      role: 'ADMIN',
    }).success,
    false,
  );
  for (const role of ['ADMIN', 'CUSTOMER']) {
    assert.deepEqual(
      allowedAdminUserStatuses({ role, status: 'ARCHIVED' }),
      [],
    );
    assert.deepEqual(
      allowedAdminUserStatuses({ role, status: 'ACTIVE' }),
      role === 'ADMIN' ? ['SUSPENDED'] : ['SUSPENDED', 'ARCHIVED'],
    );
    assert.deepEqual(
      allowedAdminUserStatuses({ role, status: 'SUSPENDED' }),
      role === 'ADMIN' ? ['ACTIVE'] : ['ACTIVE', 'ARCHIVED'],
    );
  }
});
test('Safe user projection rejects secrets, relations, aggregates and auth metadata', () => {
  const user = {
    id: 'b2ecb79a-b74a-4748-93dc-f2fc02b93b3d',
    email: 'user@example.test',
    firstName: 'Safe',
    lastName: 'User',
    role: 'CUSTOMER',
    status: 'ACTIVE',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    archivedAt: null,
  };
  assert.deepEqual(adminManagedUserSchema.parse(user), user);
  for (const name of [
    'passwordHash',
    'refreshSessions',
    'phone',
    'lastLoginAt',
    'addresses',
    'orders',
    'orderCount',
    'cart',
    'auditHistory',
  ])
    assert.equal(
      adminManagedUserSchema.safeParse({ ...user, [name]: 'private' }).success,
      false,
    );
});
test('User OpenAPI agrees with runtime contracts and exposes protected operations only', async () => {
  const spec = JSON.parse(
    await readFile(new URL('../openapi.json', import.meta.url), 'utf8'),
  );
  for (const [name, schema] of Object.entries({
    AdminUserStatusInput: adminUserStatusInputSchema,
    AdminUserListResponse: adminUserListResponseSchema,
    AdminUserDetailResponse: adminUserDetailResponseSchema,
  }))
    assert.deepEqual(spec.components.schemas[name], z.toJSONSchema(schema));
  for (const [path, method] of [
    ['/admin/users', 'get'],
    ['/admin/users/{userId}', 'get'],
    ['/admin/users/{userId}/status', 'patch'],
  ]) {
    const op = spec.paths[path][method];
    assert.deepEqual(op.security, [{ BearerAuth: [] }]);
    assert.equal(
      op.responses[200].headers['Cache-Control'].schema.const,
      'no-store',
    );
  }
});
