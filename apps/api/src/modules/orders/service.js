import {
  customerOrderQuerySchema,
  customerOrderListResponseSchema,
  customerOrderDetailSchema,
} from '@marthub/contracts';
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
          return customerOrderDetailSchema.parse({
            ...projectCheckoutOrder(row),
            createdAt: row.createdAt.toISOString(),
            statusHistory: row.statusHistory.map((history) => ({
              ...history,
              createdAt: history.createdAt.toISOString(),
            })),
          });
        },
        { isolationLevel: 'RepeatableRead' },
      );
    },
  };
}
