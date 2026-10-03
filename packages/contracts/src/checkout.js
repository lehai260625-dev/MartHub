import { z } from 'zod';
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
