import { z } from './schema-runtime.js';

export const adminUserStatusSchema = z.enum([
  'ACTIVE',
  'SUSPENDED',
  'ARCHIVED',
]);
export const adminUserRoleSchema = z.enum(['CUSTOMER', 'ADMIN']);
const integerQuery = z
  .string()
  .regex(/^[1-9]\d*$/u)
  .transform(Number)
  .pipe(z.int().min(1));
export const adminUserQuerySchema = z
  .object({
    q: z.preprocess(
      (v) =>
        typeof v === 'string' ? v.trim().replace(/\s+/gu, ' ') || undefined : v,
      z.string().max(100).optional(),
    ),
    role: adminUserRoleSchema.optional(),
    status: adminUserStatusSchema.optional(),
    sort: z.enum(['newest', 'oldest', 'email']).optional().default('newest'),
    page: integerQuery.optional().default(1),
    perPage: integerQuery.pipe(z.int().max(50)).optional().default(20),
  })
  .strict()
  .refine((v) => (v.page - 1) * v.perPage <= 2147483647, {
    path: ['page'],
    message: 'Pagination offset is too large.',
  });
export const adminManagedUserSchema = z
  .object({
    id: z.uuid(),
    email: z.email(),
    firstName: z.string(),
    lastName: z.string(),
    role: adminUserRoleSchema,
    status: adminUserStatusSchema,
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    archivedAt: z.iso.datetime().nullable(),
  })
  .strict();
export const adminUserDetailResponseSchema = z
  .object({ data: adminManagedUserSchema })
  .strict();
export const adminUserListResponseSchema = z
  .object({
    data: z.array(adminManagedUserSchema),
    meta: z
      .object({
        page: z.int().min(1),
        perPage: z.int().min(1).max(50),
        totalItems: z.int().nonnegative(),
        totalPages: z.int().nonnegative(),
      })
      .strict(),
  })
  .strict();
const reasonSchema = z.preprocess(
  (v) => (typeof v === 'string' ? v.trim() : v),
  z.string().min(1).max(240),
);
export const adminUserStatusInputSchema = z.discriminatedUnion('toStatus', [
  z
    .object({
      expectedStatus: adminUserStatusSchema,
      toStatus: z.literal('ACTIVE'),
    })
    .strict(),
  z
    .object({
      expectedStatus: adminUserStatusSchema,
      toStatus: z.literal('SUSPENDED'),
      reason: reasonSchema,
    })
    .strict(),
  z
    .object({
      expectedStatus: adminUserStatusSchema,
      toStatus: z.literal('ARCHIVED'),
      reason: reasonSchema,
    })
    .strict(),
]);
export function allowedAdminUserStatuses(user) {
  if (user.status === 'ARCHIVED') return [];
  if (user.status === 'ACTIVE')
    return user.role === 'ADMIN' ? ['SUSPENDED'] : ['SUSPENDED', 'ARCHIVED'];
  return user.role === 'ADMIN' ? ['ACTIVE'] : ['ACTIVE', 'ARCHIVED'];
}
