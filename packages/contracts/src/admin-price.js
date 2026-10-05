import { z } from './schema-runtime.js';
import { moneySchema } from './money.js';
import { adminProductIdSchema } from './admin-product.js';

export const adminPositivePriceSchema = moneySchema.refine(
  (value) => value !== '0',
  'Price must be greater than zero.',
);

export const adminProductPriceCreateSchema = z
  .object({
    price: adminPositivePriceSchema,
    compareAtPrice: adminPositivePriceSchema
      .nullable()
      .optional()
      .default(null),
    startsAt: z.iso.datetime({ precision: 3 }),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.compareAtPrice !== null &&
      /^[0-9]+$/u.test(value.compareAtPrice) &&
      /^[0-9]+$/u.test(value.price) &&
      BigInt(value.compareAtPrice) <= BigInt(value.price)
    )
      context.addIssue({
        code: 'custom',
        path: ['compareAtPrice'],
        message: 'Compare price must be greater than the selling price.',
      });
  });

const adminPriceActorSchema = z
  .object({
    id: z.uuid(),
    email: z.email(),
    firstName: z.string(),
    lastName: z.string(),
  })
  .strict();

export const adminProductPriceSchema = z
  .object({
    id: z.uuid(),
    productId: adminProductIdSchema,
    price: adminPositivePriceSchema,
    compareAtPrice: adminPositivePriceSchema.nullable(),
    startsAt: z.iso.datetime(),
    endsAt: z.iso.datetime().nullable(),
    createdAt: z.iso.datetime(),
    isCurrent: z.boolean(),
    createdBy: adminPriceActorSchema.nullable(),
  })
  .strict();

export const adminProductPriceResponseSchema = z
  .object({ data: adminProductPriceSchema })
  .strict();
export const adminProductPriceHistoryResponseSchema = z
  .object({ data: z.array(adminProductPriceSchema) })
  .strict();
