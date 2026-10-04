import { z } from 'zod';
import { checkoutOrderSchema } from './checkout.js';
import { moneySchema } from './money.js';
import { customerOrderStatusSchema } from './orders.js';

const integerQuery = z
  .string()
  .regex(/^[1-9]\d*$/u)
  .transform(Number)
  .pipe(z.int().min(1));

const normalizedSearch = z.preprocess((value) => {
  if (typeof value !== 'string') return value;
  const normalized = value.trim().replace(/\s+/gu, ' ');
  return normalized || undefined;
}, z.string().max(100).optional());

export const adminOrderIdSchema = z.uuid();
export const adminOrderQuerySchema = z
  .object({
    q: normalizedSearch,
    status: customerOrderStatusSchema.optional(),
    sort: z.enum(['newest', 'oldest']).optional().default('newest'),
    page: integerQuery.optional().default(1),
    perPage: integerQuery.pipe(z.int().max(50)).optional().default(20),
  })
  .strict()
  .refine((query) => (query.page - 1) * query.perPage <= 2147483647, {
    message: 'Pagination offset exceeds the supported integer range.',
    path: ['page'],
  });

export const adminOrderQueueCustomerSchema = z
  .object({ userId: z.uuid(), email: z.email() })
  .strict();

export const adminOrderSummarySchema = z
  .object({
    id: adminOrderIdSchema,
    orderNumber: z.string().min(1),
    status: customerOrderStatusSchema,
    createdAt: z.iso.datetime(),
    subtotal: moneySchema,
    shippingFee: moneySchema,
    discountTotal: moneySchema,
    total: moneySchema,
    currency: z.literal('VND'),
    paymentMethod: z.literal('COD'),
    itemCount: z.int().nonnegative(),
    customer: adminOrderQueueCustomerSchema,
  })
  .strict();

export const adminOrderCustomerSchema = adminOrderQueueCustomerSchema
  .extend({
    firstName: z.string(),
    lastName: z.string(),
    phone: z.string().nullable(),
    status: z.enum(['ACTIVE', 'SUSPENDED', 'ARCHIVED']),
  })
  .strict();

export const adminOrderHistorySchema = z
  .object({
    id: z.uuid(),
    status: customerOrderStatusSchema,
    reason: z.string().nullable(),
    createdAt: z.iso.datetime(),
    actorUserId: z.uuid().nullable(),
  })
  .strict();

export const adminOrderDetailSchema = checkoutOrderSchema
  .extend({
    createdAt: z.iso.datetime(),
    customer: adminOrderCustomerSchema,
    statusHistory: z.array(adminOrderHistorySchema),
  })
  .strict();

export const adminOrderListResponseSchema = z
  .object({
    data: z.array(adminOrderSummarySchema),
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

export const adminOrderDetailResponseSchema = z
  .object({ data: adminOrderDetailSchema })
  .strict();
