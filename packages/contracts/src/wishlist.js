import { z } from './schema-runtime.js';
import { productCardSchema } from './catalog.js';

export const wishlistItemSchema = z
  .object({
    id: z.uuid(),
    productId: z.uuid(),
    availability: z.enum(['IN_STOCK', 'OUT_OF_STOCK', 'UNAVAILABLE']),
    product: productCardSchema.nullable(),
  })
  .strict();

export const wishlistSchema = z
  .object({
    id: z.uuid().nullable(),
    items: z.array(wishlistItemSchema),
    itemCount: z.int().nonnegative(),
  })
  .strict();

export const wishlistResponseSchema = z
  .object({ data: wishlistSchema })
  .strict();
