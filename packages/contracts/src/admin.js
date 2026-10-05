import { z } from './schema-runtime.js';
import { publicUserSchema } from './auth.js';

export const adminUserSchema = publicUserSchema.extend({
  role: z.literal('ADMIN'),
});

export const adminSessionResponseSchema = z
  .object({
    data: z
      .object({
        user: adminUserSchema,
      })
      .strict(),
  })
  .strict();
