import {
  adminOrderDetailSchema,
  adminOrderIdSchema,
  adminOrderListResponseSchema,
  adminOrderQuerySchema,
} from '@marthub/contracts';
import { ApiError } from '../../middleware/platform.js';
import {
  checkoutOrderSelect,
  projectCheckoutOrder,
} from '../checkout/orders.js';

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
  };
}
