import { z } from 'zod';
import { productCardSchema } from './catalog.js';

export const recommendationsQuerySchema = z.object({}).strict();
const eligibleCard = productCardSchema.extend({
  availability: z
    .object({ status: z.literal('IN_STOCK'), canAddToCart: z.literal(true) })
    .strict(),
});
export const recommendationsResponseSchema = z
  .object({
    data: z.discriminatedUnion('label', [
      z
        .object({
          label: z.literal('PERSONALIZED'),
          products: z.array(eligibleCard).min(1).max(8),
        })
        .strict(),
      z
        .object({
          label: z.literal('POPULAR'),
          products: z.array(eligibleCard).max(8),
        })
        .strict(),
    ]),
  })
  .strict();
