import {
  customerOrderQuerySchema,
  customerOrderListResponseSchema,
  customerOrderDetailSchema,
  customerOrderCancelInputSchema,
} from '@marthub/contracts';
import { Prisma } from '@prisma/client';
import { ApiError } from '../../middleware/platform.js';
import {
  ownedWhere,
  ownedResourceId,
  requireOwnedResource,
} from '../auth/authorization.js';
import {
  checkoutOrderSelect,
  projectCheckoutOrder,
} from '../checkout/orders.js';

const summarySelect = {
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
  items: { select: { quantity: true } },
};
const detailSelect = {
  ...checkoutOrderSelect,
  requestFingerprint: false,
  createdAt: true,
  statusHistory: {
    select: { fromStatus: true, toStatus: true, reason: true, createdAt: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  },
};

function projectDetail(row) {
  return customerOrderDetailSchema.parse({
    ...projectCheckoutOrder(row),
    createdAt: row.createdAt.toISOString(),
    statusHistory: row.statusHistory.map((history) => ({
      ...history,
      createdAt: history.createdAt.toISOString(),
    })),
  });
}

export function createCustomerOrderService({ prisma }) {
  return {
    async list(auth, input) {
      const parsed = customerOrderQuerySchema.safeParse(input);
      if (!parsed.success)
        throw new ApiError(
          422,
          'VALIDATION_ERROR',
          'Check the query parameters.',
          parsed.error.issues.map((issue) => ({
            field: issue.path.join('.'),
            message: issue.message,
          })),
        );
      const { page, perPage, status, sort } = parsed.data;
      const where = ownedWhere(auth, status ? { status } : {});
      const direction = sort === 'oldest' ? 'asc' : 'desc';
      return prisma.$transaction(
        async (tx) => {
          const totalItems = await tx.order.count({ where });
          const rows = await tx.order.findMany({
            where,
            select: summarySelect,
            orderBy: [{ createdAt: direction }, { id: direction }],
            skip: (page - 1) * perPage,
            take: perPage,
          });
          return customerOrderListResponseSchema.parse({
            data: rows.map(({ items, ...row }) => ({
              ...row,
              createdAt: row.createdAt.toISOString(),
              subtotal: row.subtotal.toString(),
              shippingFee: row.shippingFee.toString(),
              discountTotal: row.discountTotal.toString(),
              total: row.total.toString(),
              itemCount: items.reduce(
                (count, item) => count + item.quantity,
                0,
              ),
            })),
            meta: {
              page,
              perPage,
              totalItems,
              totalPages: Math.ceil(totalItems / perPage),
            },
          });
        },
        { isolationLevel: 'RepeatableRead' },
      );
    },
    async detail(auth, id) {
      const orderId = ownedResourceId(id);
      return prisma.$transaction(
        async (tx) => {
          const row = requireOwnedResource(
            await tx.order.findFirst({
              where: ownedWhere(auth, { id: orderId }),
              select: detailSelect,
            }),
          );
          return projectDetail(row);
        },
        { isolationLevel: 'RepeatableRead' },
      );
    },
    async cancel(auth, id, input) {
      const orderId = ownedResourceId(id);
      const parsed = customerOrderCancelInputSchema.safeParse(input);
      if (!parsed.success)
        throw new ApiError(
          422,
          'VALIDATION_ERROR',
          'Check the cancellation input.',
          parsed.error.issues.map((issue) => ({
            field: issue.path.join('.'),
            message: issue.message,
          })),
        );
      const { reason } = parsed.data;
      return prisma.$transaction(
        async (tx) => {
          // Checkout also locks this User before Inventory. Acquire it first so
          // actor foreign-key checks cannot deadlock with same-Customer checkout.
          await tx.$queryRaw`SELECT "id" FROM "users" WHERE "id" = ${auth.user.id}::uuid FOR UPDATE`;
          // Ownership is part of the lock predicate, preserving concealed 404s.
          const locked = await tx.$queryRaw`SELECT "id" FROM "orders"
          WHERE "id" = ${orderId}::uuid AND "user_id" = ${auth.user.id}::uuid FOR UPDATE`;
          requireOwnedResource(locked[0]);
          const row = await tx.order.findUnique({
            where: { id: orderId },
            select: detailSelect,
          });
          if (row.status === 'CANCELLED') return projectDetail(row);
          if (!['PENDING', 'CONFIRMED'].includes(row.status))
            throw new ApiError(
              409,
              'INVALID_ORDER_TRANSITION',
              'This order cannot be cancelled.',
            );
          const items = [...row.items].sort((a, b) =>
            a.productId.localeCompare(b.productId),
          );
          if (items.length)
            await tx.$queryRaw(Prisma.sql`
            SELECT i."id" FROM "inventory" i
            WHERE i."product_id" IN (${Prisma.join(items.map((item) => Prisma.sql`${item.productId}::uuid`))})
            ORDER BY i."product_id" ASC FOR UPDATE OF i
          `);
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
                orderId,
                actorUserId: auth.user.id,
                reason,
              },
            });
          }
          const [{ now }] =
            await tx.$queryRaw`SELECT clock_timestamp() AS "now"`;
          const cancelled = await tx.order.update({
            where: { id: orderId },
            data: {
              status: 'CANCELLED',
              cancellationReason: reason,
              cancelledAt: now,
              statusHistory: {
                create: {
                  fromStatus: row.status,
                  toStatus: 'CANCELLED',
                  actorUserId: auth.user.id,
                  reason,
                  createdAt: now,
                },
              },
            },
            select: detailSelect,
          });
          return projectDetail(cancelled);
        },
        { isolationLevel: 'ReadCommitted' },
      );
    },
  };
}
