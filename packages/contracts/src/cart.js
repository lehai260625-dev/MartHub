import { z } from 'zod';
import { productCardSchema } from './catalog.js';

export const MAX_CART_ITEM_QUANTITY = 99;

export const cartAddSchema = z
  .object({
    productId: z.uuid(),
    quantity: z.int().min(1).max(MAX_CART_ITEM_QUANTITY),
  })
  .strict();

export const cartItemSchema = z
  .object({
    id: z.uuid(),
    productId: z.uuid(),
    quantity: z.int().min(1).max(MAX_CART_ITEM_QUANTITY),
    availability: z.enum(['IN_STOCK', 'OUT_OF_STOCK', 'UNAVAILABLE']),
    product: productCardSchema.nullable(),
  })
  .strict();

export const cartSchema = z
  .object({
    id: z.uuid().nullable(),
    items: z.array(cartItemSchema),
    itemCount: z.int().nonnegative(),
  })
  .strict();

export const cartResponseSchema = z.object({ data: cartSchema }).strict();
