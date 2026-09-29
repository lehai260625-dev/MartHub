import { z } from 'zod';
import { moneySchema } from './money.js';

export const categorySummarySchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    slug: z.string(),
  })
  .strict();

export const categorySchema = categorySummarySchema
  .extend({
    description: z.string().nullable(),
    image: z.object({ url: z.url(), altText: z.string() }).strict().nullable(),
    children: z.array(categorySummarySchema),
  })
  .strict();

export const categoryListResponseSchema = z
  .object({ data: z.array(categorySchema) })
  .strict();
export const categoryResponseSchema = z
  .object({
    data: categorySchema.extend({ parent: categorySummarySchema.nullable() }),
  })
  .strict();

const productImageSchema = z
  .object({
    id: z.uuid(),
    url: z.url(),
    altText: z.string(),
    width: z.int().positive(),
    height: z.int().positive(),
  })
  .strict();

export const productCardSchema = z
  .object({
    id: z.uuid(),
    slug: z.string(),
    sku: z.string(),
    name: z.string(),
    shortDescription: z.string().nullable(),
    image: productImageSchema.pick({ url: true, altText: true }).nullable(),
    price: moneySchema,
    compareAtPrice: moneySchema.nullable(),
    currency: z.literal('VND'),
    sellingUnit: z.string(),
    badges: z.array(z.enum(['SALE', 'NEW'])),
    availability: z
      .object({
        status: z.enum(['IN_STOCK', 'OUT_OF_STOCK']),
        canAddToCart: z.boolean(),
      })
      .strict(),
  })
  .strict();

export const productDetailSchema = productCardSchema
  .extend({
    description: z.string().nullable(),
    brand: z.string().nullable(),
    category: categorySummarySchema,
    images: z.array(productImageSchema),
  })
  .strict();

const positivePage = z
  .string()
  .regex(/^[1-9][0-9]*$/)
  .transform(Number)
  .pipe(z.int().min(1).max(1000));
const perPage = z
  .string()
  .regex(/^[1-9][0-9]*$/)
  .transform(Number)
  .pipe(z.int().min(1).max(60));
const searchText = z
  .string()
  .transform((value) => value.trim().replace(/\s+/gu, ' '))
  .pipe(
    z
      .string()
      .min(2)
      .max(80)
      .regex(/^[\p{L}\p{N}][\p{L}\p{N} .&'/-]*$/u),
  );
const queryBoolean = z
  .enum(['true', 'false'])
  .transform((value) => value === 'true');

export const productQuerySchema = z
  .object({
    q: searchText.optional(),
    category: z
      .string()
      .min(1)
      .max(160)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .optional(),
    minPrice: moneySchema.optional(),
    maxPrice: moneySchema.optional(),
    availability: z.literal('in-stock').optional(),
    featured: queryBoolean.optional(),
    new: queryBoolean.optional(),
    popular: queryBoolean.optional(),
    sort: z
      .enum(['relevance', 'newest', 'price-asc', 'price-desc', 'popular'])
      .optional(),
    page: positivePage.prefault('1'),
    perPage: perPage.prefault('24'),
  })
  .strict()
  .superRefine((query, context) => {
    if (
      query.minPrice !== undefined &&
      query.maxPrice !== undefined &&
      BigInt(query.minPrice) > BigInt(query.maxPrice)
    )
      context.addIssue({
        code: 'custom',
        path: ['maxPrice'],
        message: 'Maximum price must be at least minimum price.',
      });
    if (query.sort === 'relevance' && !query.q)
      context.addIssue({
        code: 'custom',
        path: ['sort'],
        message: 'Relevance sorting requires a search query.',
      });
  })
  .transform((query) => ({
    ...query,
    sort: query.sort ?? (query.q ? 'relevance' : 'newest'),
  }));

export const productListResponseSchema = z
  .object({
    data: z.array(productCardSchema),
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
export const productResponseSchema = z
  .object({ data: productDetailSchema })
  .strict();

export const promotionSchema = z
  .object({
    id: z.uuid(),
    title: z.string(),
    subtitle: z.string().nullable(),
    image: z.object({ url: z.url(), altText: z.string() }).strict().nullable(),
    internalHref: z.string().startsWith('/'),
    placement: z.enum(['HERO_PRIMARY', 'HERO_SECONDARY', 'EDITORIAL']),
  })
  .strict();

export const homepageResponseSchema = z
  .object({
    data: z
      .object({
        promotions: z.array(promotionSchema).max(8),
        categories: z.array(categorySchema).max(8),
        deals: z.array(productCardSchema).max(12),
        newProducts: z.array(productCardSchema).max(12),
        popularProducts: z.array(productCardSchema).max(12),
      })
      .strict(),
  })
  .strict();
