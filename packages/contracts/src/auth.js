import { z } from 'zod';

export const personNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(
    // eslint-disable-next-line no-control-regex -- Explicitly reject control characters at the boundary.
    /^[^<>\u0000-\u001f\u007f]+$/u,
    'Use plain text without control characters.',
  );
export const emailSchema = z.string().trim().toLowerCase().email().max(254);
export const passwordSchema = z
  .string()
  .min(15, 'Use at least 15 characters.')
  .max(128, 'Use at most 128 characters.');
export const registerSchema = z
  .object({
    email: emailSchema,
    password: passwordSchema,
    firstName: personNameSchema,
    lastName: personNameSchema,
  })
  .strict();
export const loginSchema = z
  .object({ email: emailSchema, password: passwordSchema })
  .strict();
export const publicUserSchema = z
  .object({
    id: z.uuid(),
    email: z.email(),
    firstName: z.string(),
    lastName: z.string(),
    role: z.enum(['CUSTOMER', 'ADMIN']),
    phone: z.string().nullable().optional(),
    status: z.enum(['ACTIVE', 'SUSPENDED', 'ARCHIVED']).optional(),
  })
  .strict();
export const authResponseSchema = z
  .object({
    data: z
      .object({
        accessToken: z.string().min(1),
        expiresIn: z.number().int().positive(),
        user: publicUserSchema,
      })
      .strict(),
  })
  .strict();

export const phoneSchema = z
  .string()
  .trim()
  .min(7, 'Enter at least 7 characters.')
  .max(24, 'Enter at most 24 characters.')
  .regex(/^\+?[0-9][0-9 ()-]*$/, 'Enter a valid phone number.');

export const profileUpdateSchema = z
  .object({
    firstName: personNameSchema.optional(),
    lastName: personNameSchema.optional(),
    phone: z.union([phoneSchema, z.null()]).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Update at least one field.',
  });

export const profileFormSchema = z
  .object({
    firstName: personNameSchema,
    lastName: personNameSchema,
    phone: z.union([phoneSchema, z.literal('')]),
  })
  .strict();

export const profileResponseSchema = z
  .object({ data: publicUserSchema })
  .strict();
