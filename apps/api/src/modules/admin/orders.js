import {
  adminOrderDetailSchema,
  adminOrderIdSchema,
  adminOrderListResponseSchema,
  adminOrderQuerySchema,
  adminOrderTransitionInputSchema,
} from '@marthub/contracts';
import { Prisma } from '@prisma/client';
import { ApiError } from '../../middleware/platform.js';
import {
  checkoutOrderSelect,
  projectCheckoutOrder,
} from '../checkout/orders.js';
import { orderStatusAuditSnapshot, writeAdminAudit } from './audit.js';

export const ADMIN_ORDER_TRANSITION_MATRIX = Object.freeze({
  PENDING: Object.freeze(['CONFIRMED', 'CANCELLED']),
  CONFIRMED: Object.freeze(['PACKING', 'CANCELLED']),
  PACKING: Object.freeze(['SHIPPING', 'CANCELLED']),
  SHIPPING: Object.freeze(['DELIVERED']),
  DELIVERED: Object.freeze([]),
  CANCELLED: Object.freeze([]),
});

export function isAdminOrderTransitionAllowed(fromStatus, toStatus) {
  return ADMIN_ORDER_TRANSITION_MATRIX[fromStatus]?.includes(toStatus) ?? false;
}

const queueSelect = {
  id: true,
  orderNumber: true,
  status: true,
  createdAt: true,
  subtotal: true,
  shippingFee: true,
  discountTotal: true,
  total: true,
  currency: true,
  paymentMethod: true,
  user: { select: { id: true, email: true } },
  items: { select: { quantity: true } },
};

const detailSelect = {
  ...checkoutOrderSelect,
  requestFingerprint: false,
  createdAt: true,
  user: {
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      phone: true,
      status: true,
    },
  },
  statusHistory: {
    select: {
      id: true,
      toStatus: true,
      actorUserId: true,
      reason: true,
      createdAt: true,
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  },
};
const transitionDetailSelect = {
  ...detailSelect,
  userId: true,
  cancellationReason: true,
};

function validationError(error) {
  return new ApiError(
    422,
    'VALIDATION_ERROR',
    'Check the query parameters.',
    error.issues.map((issue) => ({
      field: issue.path.join('.'),
      message: issue.message,
    })),
  );
}

function parseQuery(input) {
  const result = adminOrderQuerySchema.safeParse(input);
  if (!result.success) throw validationError(result.error);
  return result.data;
}

function parseTransition(input) {
  const result = adminOrderTransitionInputSchema.safeParse(input);
  if (!result.success)
    throw new ApiError(
      422,
      'VALIDATION_ERROR',
      'Check the transition input.',
      result.error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
      })),
    );
  return result.data;
}

function orderId(value) {
  const result = adminOrderIdSchema.safeParse(value);
  if (!result.success)
    throw new ApiError(404, 'NOT_FOUND', 'Resource not found.');
  return result.data;
}

function projectSummary({ items, user, ...row }) {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    subtotal: row.subtotal.toString(),
    shippingFee: row.shippingFee.toString(),
    discountTotal: row.discountTotal.toString(),
    total: row.total.toString(),
    itemCount: items.reduce((total, item) => total + item.quantity, 0),
    customer: { userId: user.id, email: user.email },
  };
}

function projectDetail(row) {
  return adminOrderDetailSchema.parse({
    ...projectCheckoutOrder(row),
    createdAt: row.createdAt.toISOString(),
    customer: {
      userId: row.user.id,
      email: row.user.email,
      firstName: row.user.firstName,
      lastName: row.user.lastName,
      phone: row.user.phone,
      status: row.user.status,
    },
    statusHistory: row.statusHistory.map((history) => ({
      id: history.id,
      status: history.toStatus,
      actorUserId: history.actorUserId,
      reason: history.reason,
      createdAt: history.createdAt.toISOString(),
    })),
  });
}

export function createAdminOrderService({ prisma }) {
  return {
    async list(input) {
      const query = parseQuery(input);
      const where = {
        ...(query.status ? { status: query.status } : {}),
        ...(query.q
          ? {
              OR: [
                {
                  orderNumber: {
                    contains: query.q,
                    mode: 'insensitive',
                  },
                },
                {
                  recipientName: {
                    contains: query.q,
                    mode: 'insensitive',
                  },
                },
                {
                  user: {
                    email: { contains: query.q, mode: 'insensitive' },
                  },
                },
              ],
            }
          : {}),
      };
      const direction = query.sort === 'oldest' ? 'asc' : 'desc';
      return prisma.$transaction(
        async (tx) => {
          const totalItems = await tx.order.count({ where });
          const rows = await tx.order.findMany({
            where,
            select: queueSelect,
            orderBy: [{ createdAt: direction }, { id: direction }],
            skip: (query.page - 1) * query.perPage,
            take: query.perPage,
          });
          return adminOrderListResponseSchema.parse({
            data: rows.map(projectSummary),
            meta: {
              page: query.page,
              perPage: query.perPage,
              totalItems,
              totalPages: Math.ceil(totalItems / query.perPage),
            },
          });
        },
        { isolationLevel: 'RepeatableRead' },
      );
    },

    async detail(id) {
      const row = await prisma.order.findUnique({
        where: { id: orderId(id) },
        select: detailSelect,
      });
      if (!row) throw new ApiError(404, 'NOT_FOUND', 'Resource not found.');
      return projectDetail(row);
    },

    async transition(id, input, audit) {
      const resolvedId = orderId(id);
      const command = parseTransition(input);
      return prisma.$transaction(
        async (tx) => {
          const reference = await tx.order.findUnique({
            where: { id: resolvedId },
            select: { userId: true },
          });
          if (!reference)
            throw new ApiError(404, 'NOT_FOUND', 'Resource not found.');

          // Customer checkout and cancellation serialize on the owning User.
          // Keep that lock first before Order and product-sorted Inventory locks.
          await tx.$queryRaw`SELECT "id" FROM "users" WHERE "id" = ${reference.userId}::uuid FOR UPDATE`;
          const locked =
            await tx.$queryRaw`SELECT "id" FROM "orders" WHERE "id" = ${resolvedId}::uuid FOR UPDATE`;
          if (!locked.length)
            throw new ApiError(404, 'NOT_FOUND', 'Resource not found.');
          const row = await tx.order.findUnique({
            where: { id: resolvedId },
            select: transitionDetailSelect,
          });

          if (row.status === command.toStatus) return projectDetail(row);
          if (row.status !== command.expectedStatus)
            throw new ApiError(
              409,
              'ORDER_STATUS_CONFLICT',
              'The order status changed before this command was applied.',
              [
                {
                  currentStatus: row.status,
                  expectedStatus: command.expectedStatus,
                },
              ],
            );
          if (!isAdminOrderTransitionAllowed(row.status, command.toStatus))
            throw new ApiError(
              409,
              'INVALID_ORDER_TRANSITION',
              'This order transition is not allowed.',
            );

          const isCancellation = command.toStatus === 'CANCELLED';
          const items = [...row.items].sort((left, right) =>
            left.productId.localeCompare(right.productId),
          );
          if (isCancellation && items.length)
            await tx.$queryRaw(Prisma.sql`
              SELECT i."id" FROM "inventory" i
              WHERE i."product_id" IN (${Prisma.join(items.map((item) => Prisma.sql`${item.productId}::uuid`))})
              ORDER BY i."product_id" ASC FOR UPDATE OF i
            `);

          const [{ now }] =
            await tx.$queryRaw`SELECT clock_timestamp() AS "now"`;
          if (isCancellation)
            for (const item of items) {
              const inventory = await tx.inventory.update({
                where: { productId: item.productId },
                data: { quantityOnHand: { increment: item.quantity } },
                select: { quantityOnHand: true },
              });
              await tx.inventoryMovement.create({
                data: {
                  productId: item.productId,
                  type: 'ORDER_CANCEL_RESTORE',
                  quantityDelta: item.quantity,
                  quantityAfter: inventory.quantityOnHand,
                  orderId: resolvedId,
                  actorUserId: audit.actorUserId,
                  reason: command.reason,
                },
              });
            }

          const updated = await tx.order.update({
            where: { id: resolvedId },
            data: {
              status: command.toStatus,
              ...(isCancellation
                ? {
                    cancellationReason: command.reason,
                    cancelledAt: now,
                  }
                : {}),
              ...(command.toStatus === 'DELIVERED' ? { deliveredAt: now } : {}),
              statusHistory: {
                create: {
                  fromStatus: row.status,
                  toStatus: command.toStatus,
                  actorUserId: audit.actorUserId,
                  reason: isCancellation ? command.reason : null,
                  createdAt: now,
                },
              },
            },
            select: transitionDetailSelect,
          });
          await writeAdminAudit(tx, audit, {
            action: 'ORDER_STATUS_TRANSITION',
            entityType: 'ORDER',
            entityId: resolvedId,
            before: orderStatusAuditSnapshot(row, {
              includeCancellationReason: isCancellation,
            }),
            after: orderStatusAuditSnapshot(updated, {
              includeCancellationReason: isCancellation,
            }),
          });
          return projectDetail(updated);
        },
        { isolationLevel: 'ReadCommitted' },
      );
    },
  };
}
