import { z } from './schema-runtime.js';
import { moneySchema } from './money.js';
import { MAX_CART_ITEM_QUANTITY } from './cart.js';

export const reorderInputSchema = z.object({}).strict();
export const reorderResponseSchema = z
  .object({
    data: z
      .object({
        cartId: z.uuid().nullable(),
        added: z.array(
          z
            .object({
              productId: z.uuid(),
              quantity: z.int().min(1).max(MAX_CART_ITEM_QUANTITY),
              currentUnitPrice: moneySchema,
            })
            .strict(),
        ),
        skipped: z.array(
          z
            .object({
              productId: z.uuid(),
              reason: z.enum([
                'UNAVAILABLE',
                'OUT_OF_STOCK',
                'QUANTITY_LIMITED',
              ]),
            })
            .strict(),
        ),
      })
      .strict(),
  })
  .strict();
