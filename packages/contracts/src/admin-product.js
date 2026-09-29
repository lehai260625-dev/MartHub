import { z } from 'zod';
import { moneySchema } from './money.js';
import { adminProductImageSchema } from './admin-media.js';

const plainText = (maximum) =>
  z
    .string()
    .trim()
    .min(1)
    .max(maximum)
    .regex(/^[^<>]+$/u, 'Use plain text.');
const optionalText = (maximum) =>
  z
    .string()
    .trim()
    .max(maximum)
    .nullable()
    .refine(
      (value) => value === null || !/[<>]/u.test(value),
      'Use plain text.',
    );
const positiveMoneySchema = moneySchema.refine(
  (value) => /^[0-9]+$/u.test(value) && value !== '0',
  'Price must be greater than zero.',
);

export const adminProductIdSchema = z.uuid();
export const adminProductSkuSchema = plainText(80).regex(
  /^[A-Z0-9][A-Z0-9._-]*$/,
  'Use uppercase letters, numbers, dots, hyphens, or underscores.',
);
export const adminProductSlugSchema = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use a lowercase URL slug.');

const writableCatalogFields = {
  categoryId: z.uuid(),
  name: plainText(180),
  shortDescription: optionalText(300).optional().default(null),
  description: optionalText(5000).optional().default(null),
  brand: optionalText(120).optional().default(null),
  sellingUnit: plainText(80),
  isFeatured: z.boolean().optional().default(false),
  isNew: z.boolean().optional().default(false),
  isPopular: z.boolean().optional().default(false),
};

export const adminProductCreateSchema = z
  .object({
    ...writableCatalogFields,
    sku: adminProductSkuSchema,
    slug: adminProductSlugSchema,
    price: positiveMoneySchema,
    compareAtPrice: positiveMoneySchema.nullable().optional().default(null),
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

export const adminProductUpdateSchema = z
  .object({
    categoryId: writableCatalogFields.categoryId.optional(),
    name: writableCatalogFields.name.optional(),
    shortDescription: optionalText(300).optional(),
    description: optionalText(5000).optional(),
    brand: optionalText(120).optional(),
    sellingUnit: writableCatalogFields.sellingUnit.optional(),
    isFeatured: z.boolean().optional(),
    isNew: z.boolean().optional(),
    isPopular: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Update at least one field.',
  });

export const adminProductQuerySchema = z
  .object({
    q: z.string().trim().min(1).max(80).optional(),
    status: z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']).optional(),
    categoryId: z.uuid().optional(),
    page: z.coerce.number().int().min(1).max(1000).default(1),
    perPage: z.coerce.number().int().min(1).max(60).default(24),
  })
  .strict();

const categorySchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    slug: z.string(),
    status: z.enum(['ACTIVE', 'ARCHIVED']),
  })
  .strict();

export const adminProductSchema = z
  .object({
    id: adminProductIdSchema,
    categoryId: z.uuid(),
    sku: z.string(),
    name: z.string(),
    slug: z.string(),
    shortDescription: z.string().nullable(),
    description: z.string().nullable(),
    brand: z.string().nullable(),
    sellingUnit: z.string(),
    status: z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']),
    isFeatured: z.boolean(),
    isNew: z.boolean(),
    isPopular: z.boolean(),
    publishedAt: z.iso.datetime().nullable(),
    archivedAt: z.iso.datetime().nullable(),
    category: categorySchema,
    price: positiveMoneySchema,
    compareAtPrice: positiveMoneySchema.nullable(),
    quantityOnHand: z.int().nonnegative(),
    imageCount: z.int().nonnegative(),
    images: z.array(adminProductImageSchema).optional().default([]),
  })
  .strict();

export const adminProductResponseSchema = z
  .object({ data: adminProductSchema })
  .strict();
export const adminProductListResponseSchema = z
  .object({
    data: z.array(adminProductSchema),
    meta: z
      .object({
        page: z.int().min(1),
        perPage: z.int().min(1).max(60),
        totalItems: z.int().nonnegative(),
        totalPages: z.int().nonnegative(),
      })
      .strict(),
  })
  .strict();
