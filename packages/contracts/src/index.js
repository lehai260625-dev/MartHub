import { z } from 'zod';
export * from './auth.js';
export * from './admin.js';
export * from './admin-category.js';
export * from './address.js';
export * from './money.js';
export * from './catalog.js';
export * from './cart.js';
export * from './wishlist.js';
export * from './checkout.js';

export const STORE_NAME = 'MartHub';
export const API_VERSION = 'v1';
export const API_BASE_PATH = `/api/${API_VERSION}`;
export const CURRENCY = 'VND';
export const requestIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
export const healthSchema = z.object({
  data: z.object({
    status: z.enum(['ok', 'ready']),
    version: z.literal(API_VERSION),
  }),
});
export const errorSchema = z.object({
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
    details: z.array(z.record(z.string(), z.unknown())).optional(),
    requestId: requestIdSchema,
  }),
});

export * from './admin-product.js';

export * from './admin-media.js';

export * from './admin-price.js';

export * from './admin-inventory.js';

export * from './admin-promotion.js';
export * from './orders.js';
export * from './my-items.js';
export * from './reorder.js';
export * from './recommendations.js';
