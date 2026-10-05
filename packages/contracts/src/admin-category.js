import { z } from './schema-runtime.js';

const plainText = (maximum) =>
  z
    .string()
    .trim()
    .min(1)
    .max(maximum)
    .regex(/^[^<>]+$/u, 'Use plain text.');

export const adminCategoryIdSchema = z.uuid();
export const adminCategoryNameSchema = plainText(120);
export const adminCategorySlugSchema = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use a lowercase URL slug.');
export const adminCategoryDescriptionSchema = z
  .string()
  .trim()
  .max(1000)
  .nullable();
export const adminCategorySortOrderSchema = z.int().min(0).max(1_000_000);

export const adminCategoryCreateSchema = z
  .object({
    name: adminCategoryNameSchema,
    slug: adminCategorySlugSchema,
    description: adminCategoryDescriptionSchema.optional().default(null),
    parentId: adminCategoryIdSchema.nullable().optional().default(null),
    sortOrder: adminCategorySortOrderSchema.optional().default(0),
  })
  .strict();

export const adminCategoryUpdateSchema = z
  .object({
    name: adminCategoryNameSchema.optional(),
    description: adminCategoryDescriptionSchema.optional(),
    parentId: adminCategoryIdSchema.nullable().optional(),
    sortOrder: adminCategorySortOrderSchema.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Update at least one field.',
  });

const adminCategoryParentSchema = z
  .object({
    id: adminCategoryIdSchema,
    name: z.string(),
    slug: z.string(),
  })
  .strict();

export const adminCategorySchema = z
  .object({
    id: adminCategoryIdSchema,
    parentId: adminCategoryIdSchema.nullable(),
    name: z.string(),
    slug: z.string(),
    description: z.string().nullable(),
    status: z.enum(['ACTIVE', 'ARCHIVED']),
    sortOrder: z.int(),
    archivedAt: z.iso.datetime().nullable(),
    parent: adminCategoryParentSchema.nullable(),
    childCount: z.int().nonnegative(),
    productCount: z.int().nonnegative(),
  })
  .strict();

export const adminCategoryResponseSchema = z
  .object({ data: adminCategorySchema })
  .strict();

export const adminCategoryListResponseSchema = z
  .object({ data: z.array(adminCategorySchema) })
  .strict();
