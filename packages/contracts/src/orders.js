import { z } from 'zod';
import { checkoutOrderSchema } from './checkout.js';
import { moneySchema } from './money.js';

export const customerOrderStatusSchema = checkoutOrderSchema.shape.status;
const integerQuery = z
  .string()
  .regex(/^[1-9]\d*$/)
  .transform(Number)
  .pipe(z.int().min(1));
export const customerOrderQuerySchema = z
  .object({
    page: integerQuery.optional().default(1),
    perPage: integerQuery.pipe(z.int().max(50)).optional().default(20),
    status: customerOrderStatusSchema.optional(),
    sort: z.enum(['newest', 'oldest']).default('newest'),
  })
  .strict()
  .refine((query) => (query.page - 1) * query.perPage <= 2147483647, {
    message: 'Pagination offset exceeds the supported integer range.',
    path: ['page'],
  });

export const customerOrderSummarySchema = z
  .object({
    id: z.uuid(),
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
  })
  .strict();
export const customerOrderHistorySchema = z
  .object({
    fromStatus: customerOrderStatusSchema.nullable(),
    toStatus: customerOrderStatusSchema,
    reason: z.string().nullable(),
    createdAt: z.iso.datetime(),
  })
  .strict();
export const customerOrderDetailSchema = checkoutOrderSchema
  .extend({
    createdAt: z.iso.datetime(),
    statusHistory: z.array(customerOrderHistorySchema),
  })
  .strict();
export const customerOrderListResponseSchema = z
  .object({
    data: z.array(customerOrderSummarySchema),
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
export const customerOrderDetailResponseSchema = z
  .object({ data: customerOrderDetailSchema })
  .strict();
