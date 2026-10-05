import { z } from './schema-runtime.js';
import { adminProductIdSchema } from './admin-product.js';

const actorSchema = z
  .object({
    id: z.uuid(),
    email: z.email(),
    firstName: z.string(),
    lastName: z.string(),
  })
  .strict();

const paginationSchema = z
  .object({
    page: z.int().min(1),
    perPage: z.int().min(1).max(60),
    totalItems: z.int().nonnegative(),
    totalPages: z.int().nonnegative(),
  })
  .strict();

export const adminInventoryQuerySchema = z
  .object({
    q: z.string().trim().min(1).max(80).optional(),
    status: z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']).optional(),
    maxQuantity: z.coerce.number().int().min(0).max(2147483647).optional(),
    page: z.coerce.number().int().min(1).max(1000).default(1),
    perPage: z.coerce.number().int().min(1).max(60).default(24),
  })
  .strict();

export const adminInventoryMovementQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(1000).default(1),
    perPage: z.coerce.number().int().min(1).max(60).default(20),
  })
  .strict();

export const adminInventoryAdjustmentSchema = z
  .object({
    adjustment: z
      .number()
      .int()
      .min(-2147483648)
      .max(2147483647)
      .refine((value) => value !== 0, 'Adjustment must not be zero.'),
    reason: z
      .string()
      .trim()
      .min(1)
      .max(240)
      .regex(/^[^<>]+$/u, 'Use plain text.'),
  })
  .strict();

export const adminInventoryItemSchema = z
  .object({
    productId: adminProductIdSchema,
    sku: z.string(),
    name: z.string(),
    status: z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']),
    quantityOnHand: z.int().nonnegative(),
    updatedAt: z.iso.datetime(),
  })
  .strict();

export const adminInventoryMovementSchema = z
  .object({
    id: z.uuid(),
    productId: adminProductIdSchema,
    type: z.enum([
      'INITIAL',
      'ADJUSTMENT',
      'ORDER_DEBIT',
      'ORDER_CANCEL_RESTORE',
    ]),
    adjustment: z.int(),
    quantityBefore: z.int().nonnegative(),
    quantityAfter: z.int().nonnegative(),
    orderId: z.uuid().nullable(),
    reason: z.string().nullable(),
    createdAt: z.iso.datetime(),
    actor: actorSchema.nullable(),
  })
  .strict();

export const adminInventoryListResponseSchema = z
  .object({ data: z.array(adminInventoryItemSchema), meta: paginationSchema })
  .strict();
export const adminInventoryMovementListResponseSchema = z
  .object({
    data: z.array(adminInventoryMovementSchema),
    meta: paginationSchema,
  })
  .strict();
export const adminInventoryAdjustmentResponseSchema = z
  .object({
    data: z
      .object({
        inventory: adminInventoryItemSchema,
        movement: adminInventoryMovementSchema,
      })
      .strict(),
  })
  .strict();
