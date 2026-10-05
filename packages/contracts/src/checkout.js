import { z } from './schema-runtime.js';
import { addressSchema } from './address.js';
import { moneySchema } from './money.js';
import { MAX_CART_ITEM_QUANTITY } from './cart.js';

export const checkoutQuoteInputSchema = z
  .object({ addressId: z.uuid() })
  .strict();
export const checkoutQuoteItemSchema = z
  .object({
    itemId: z.uuid(),
    productId: z.uuid(),
    sku: z.string().min(1),
    name: z.string().min(1),
    quantity: z.number().int().min(1).max(MAX_CART_ITEM_QUANTITY),
    stock: z.number().int().nonnegative(),
    unitPrice: moneySchema,
    compareAtPrice: moneySchema.nullable(),
    lineTotal: moneySchema,
  })
  .strict();
export const checkoutQuoteSchema = z
  .object({
    cartId: z.uuid(),
    address: addressSchema,
    currency: z.literal('VND'),
    items: z.array(checkoutQuoteItemSchema).min(1),
    subtotal: moneySchema,
    shippingFee: moneySchema,
    discountTotal: z.literal('0'),
    total: moneySchema,
    quotedAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
  })
  .strict();
export const checkoutQuoteResponseSchema = z
  .object({ data: checkoutQuoteSchema })
  .strict();

const intentId = z.uuid().transform((value) => value.toLowerCase());
export const idempotencyKeySchema = intentId;
export const checkoutOrderInputSchema = z
  .object({
    cartId: intentId,
    addressId: intentId,
    customerNote: z
      .string()
      .transform((value) => value.trim())
      .pipe(z.string().max(500))
      .nullable()
      .optional()
      .transform((value) => value || null)
      .describe(
        'Trim before enforcing a maximum of 500 characters; omitted, null, empty, and whitespace-only become null.',
      ),
  })
  .strict();

export const orderDeliverySchema = addressSchema.omit({
  id: true,
  label: true,
  isDefault: true,
});
export const checkoutOrderSchema = z
  .object({
    id: z.uuid(),
    orderNumber: z.string().min(1),
    status: z.enum([
      'PENDING',
      'CONFIRMED',
      'PACKING',
      'SHIPPING',
      'DELIVERED',
      'CANCELLED',
    ]),
    paymentMethod: z.literal('COD'),
    currency: z.literal('VND'),
    subtotal: moneySchema,
    shippingFee: moneySchema,
    discountTotal: moneySchema,
    total: moneySchema,
    address: orderDeliverySchema,
    customerNote: z.string().nullable(),
    placedAt: z.iso.datetime(),
    items: z
      .array(
        z
          .object({
            id: z.uuid(),
            productId: z.uuid(),
            sku: z.string(),
            productName: z.string(),
            imageUrl: z.url().nullable(),
            sellingUnit: z.string(),
            unitPrice: moneySchema,
            compareAtPrice: moneySchema.nullable(),
            quantity: z.number().int().positive(),
            lineTotal: moneySchema,
          })
          .strict(),
      )
      .min(1),
  })
  .strict();
export const checkoutOrderResponseSchema = z
  .object({ data: checkoutOrderSchema })
  .strict();
