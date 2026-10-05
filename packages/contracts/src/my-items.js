import { z } from './schema-runtime.js';
import { productCardSchema } from './catalog.js';
import { checkoutOrderSchema } from './checkout.js';
import { moneySchema } from './money.js';
import {
  customerOrderQuerySchema,
  customerOrderListResponseSchema,
} from './orders.js';

export const myItemsQuerySchema = z
  .object({
    page: customerOrderQuerySchema.shape.page,
    perPage: customerOrderQuerySchema.shape.perPage,
    sort: z.enum(['recent', 'frequent']).default('recent'),
  })
  .strict()
  .refine((query) => (query.page - 1) * query.perPage <= 2147483647, {
    message: 'Pagination offset exceeds the supported integer range.',
    path: ['page'],
  });
export const myItemSchema = z
  .object({
    productId: z.uuid(),
    purchaseCount: z.int().positive(),
    lastPurchasedAt: z.iso.datetime(),
    orderId: z.uuid(),
    snapshot: checkoutOrderSchema.shape.items.element.pick({
      sku: true,
      productName: true,
      imageUrl: true,
      sellingUnit: true,
    }),
    currentProduct: productCardSchema.nullable(),
    currentPrice: moneySchema.nullable(),
    availability: z.enum(['IN_STOCK', 'OUT_OF_STOCK', 'UNAVAILABLE']),
  })
  .strict();
export const myItemsResponseSchema = z
  .object({
    data: z.array(myItemSchema),
    meta: customerOrderListResponseSchema.shape.meta,
  })
  .strict();
