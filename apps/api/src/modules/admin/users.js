import { z } from 'zod';
import {
  adminUserQuerySchema,
  adminUserStatusInputSchema,
  adminManagedUserSchema,
  adminUserListResponseSchema,
  allowedAdminUserStatuses,
} from '@marthub/contracts';
import { ApiError } from '../../middleware/platform.js';
import { writeAdminAudit } from './audit.js';

const select = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  role: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  archivedAt: true,
};
const project = (row) =>
  adminManagedUserSchema.parse({
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    archivedAt: row.archivedAt?.toISOString() ?? null,
  });
function parse(schema, value) {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  throw new ApiError(
    422,
    'VALIDATION_ERROR',
    'Check the submitted fields.',
    result.error.issues.map((i) => ({
      field: i.path.join('.'),
      message: i.message,
    })),
  );
}
function id(value) {
  if (!z.uuid().safeParse(value).success)
    throw new ApiError(404, 'NOT_FOUND', 'Resource not found.');
  return value;
}
function snapshot(user, reason) {
  return {
    userId: user.id,
    role: user.role,
    status: user.status,
    archivedAt: user.archivedAt?.toISOString() ?? null,
    ...(reason === undefined ? {} : { reason }),
  };
}
export function createAdminUserService({ prisma }) {
  return {
    async list(input) {
      const q = parse(adminUserQuerySchema, input);
      const where = {
        ...(q.role ? { role: q.role } : {}),
        ...(q.status ? { status: q.status } : {}),
        ...(q.q
          ? {
              OR: ['email', 'firstName', 'lastName'].map((field) => ({
                [field]: {
                  contains: q.q.replace(/[\\%_]/gu, '\\$&'),
                  mode: 'insensitive',
                },
              })),
            }
          : {}),
      };
      const direction = q.sort === 'oldest' ? 'asc' : 'desc';
      return prisma.$transaction(
        async (tx) => {
          const totalItems = await tx.user.count({ where });
          const rows = await tx.user.findMany({
            where,
            select,
            orderBy:
              q.sort === 'email'
                ? [{ email: 'asc' }, { id: 'asc' }]
                : [{ createdAt: direction }, { id: direction }],
            skip: (q.page - 1) * q.perPage,
            take: q.perPage,
          });
          return adminUserListResponseSchema.parse({
            data: rows.map(project),
            meta: {
              page: q.page,
              perPage: q.perPage,
              totalItems,
              totalPages: Math.ceil(totalItems / q.perPage),
            },
          });
        },
        { isolationLevel: 'RepeatableRead' },
      );
    },
    async detail(value) {
      const row = await prisma.user.findUnique({
        where: { id: id(value) },
        select,
      });
      if (!row) throw new ApiError(404, 'NOT_FOUND', 'Resource not found.');
      return project(row);
    },
    async changeStatus(value, input, audit) {
      const userId = id(value);
      const command = parse(adminUserStatusInputSchema, input);
      if (userId === audit.actorUserId)
        throw new ApiError(
          409,
          'ADMIN_SELF_STATUS_CHANGE_FORBIDDEN',
          'You cannot change your own account status.',
        );
      return prisma.$transaction(
        async (tx) => {
          const reference = await tx.user.findUnique({
            where: { id: userId },
            select: { role: true },
          });
          if (!reference)
            throw new ApiError(404, 'NOT_FOUND', 'Resource not found.');
          // Admin population changes serialize before target locking/counting.
          // Include suspended Admins to coordinate reactivation and cross-disable.
          if (reference.role === 'ADMIN')
            await tx.$queryRaw`SELECT "id" FROM "users" WHERE "role" = 'ADMIN' ORDER BY "id" ASC FOR UPDATE`;
          else
            await tx.$queryRaw`SELECT "id" FROM "users" WHERE "id" = ${userId}::uuid FOR UPDATE`;
          const actor = await tx.user.findFirst({
            where: {
              id: audit.actorUserId,
              role: 'ADMIN',
              status: 'ACTIVE',
              archivedAt: null,
            },
            select: { id: true },
          });
          if (!actor)
            throw new ApiError(401, 'UNAUTHORIZED', 'Please sign in again.');
          const row = await tx.user.findUnique({
            where: { id: userId },
            select,
          });
          if (row.status === command.toStatus) return project(row);
          if (row.status !== command.expectedStatus)
            throw new ApiError(
              409,
              'USER_STATUS_CONFLICT',
              'The account status has changed.',
              [
                {
                  currentStatus: row.status,
                  expectedStatus: command.expectedStatus,
                },
              ],
            );
          if (!allowedAdminUserStatuses(row).includes(command.toStatus))
            throw new ApiError(
              409,
              'INVALID_USER_STATUS_TRANSITION',
              'This account status transition is not allowed.',
            );
          if (row.role === 'ADMIN' && command.toStatus === 'SUSPENDED') {
            const active = await tx.user.count({
              where: { role: 'ADMIN', status: 'ACTIVE', archivedAt: null },
            });
            if (active <= 1)
              throw new ApiError(
                409,
                'LAST_ACTIVE_ADMIN_REQUIRED',
                'At least one active Admin must remain.',
              );
          }
          const [{ now }] =
            await tx.$queryRaw`SELECT clock_timestamp() AS "now"`;
          const updated = await tx.user.update({
            where: { id: userId },
            data: {
              status: command.toStatus,
              archivedAt: command.toStatus === 'ARCHIVED' ? now : null,
            },
            select,
          });
          if (command.toStatus !== 'ACTIVE')
            await tx.refreshSession.updateMany({
              where: { userId, revokedAt: null },
              data: { revokedAt: now, revokeReason: 'ACCOUNT_DISABLED' },
            });
          await writeAdminAudit(tx, audit, {
            action: 'USER_STATUS_CHANGE',
            entityType: 'USER',
            entityId: userId,
            before: snapshot(row),
            after: snapshot(updated, command.reason),
          });
          return project(updated);
        },
        { isolationLevel: 'ReadCommitted' },
      );
    },
  };
}
