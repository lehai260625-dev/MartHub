import { z } from 'zod';
import { personNameSchema, phoneSchema } from './auth.js';

const plainText = (maximum, minimum = 1) =>
  z
    .string()
    .trim()
    .min(minimum)
    .max(maximum)
    .regex(
      // eslint-disable-next-line no-control-regex -- Explicit boundary rejection.
      /^[^<>\u0000-\u001f\u007f]+$/u,
      'Use plain text without control characters.',
    );

const addressFields = {
  label: plainText(40),
  recipientName: personNameSchema,
  phone: phoneSchema,
  line1: plainText(160),
  line2: plainText(160).nullable().optional(),
  ward: plainText(100),
  district: plainText(100),
  province: plainText(100),
  postalCode: z
    .string()
    .trim()
    .min(3)
    .max(12)
    .regex(/^[A-Za-z0-9 -]+$/, 'Enter a valid postal code.')
    .nullable()
    .optional(),
};

export const addressCreateSchema = z
  .object({ ...addressFields, isDefault: z.boolean().optional() })
  .strict();

export const addressUpdateSchema = z
  .object(addressFields)
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Update at least one field.',
  });

export const addressFormSchema = z
  .object({
    ...addressFields,
    line2: z.union([plainText(160), z.literal('')]),
    postalCode: z.union([
      z
        .string()
        .trim()
        .min(3)
        .max(12)
        .regex(/^[A-Za-z0-9 -]+$/, 'Enter a valid postal code.'),
      z.literal(''),
    ]),
    isDefault: z.boolean(),
  })
  .strict();

export const addressSchema = z
  .object({
    id: z.uuid(),
    ...addressFields,
    line2: z.string().nullable(),
    postalCode: z.string().nullable(),
    isDefault: z.boolean(),
  })
  .strict();

export const addressResponseSchema = z.object({ data: addressSchema }).strict();
export const addressListResponseSchema = z
  .object({ data: z.array(addressSchema) })
  .strict();
