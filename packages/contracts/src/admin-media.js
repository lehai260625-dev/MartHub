import { z } from './schema-runtime.js';

const plainText = (maximum) =>
  z
    .string()
    .trim()
    .min(1)
    .max(maximum)
    .regex(/^[^<>]+$/u, 'Use plain text.');

export const adminProductImageIdSchema = z.uuid();
export const adminProductImageAltTextSchema = plainText(180);
export const adminProductImageSortOrderSchema = z.int().min(0).max(1_000_000);
export const cloudinaryPublicIdSchema = z
  .string()
  .min(1)
  .max(255)
  .regex(/^[A-Za-z0-9/_-]+$/u, 'Use a valid Cloudinary public ID.');
export const cloudinarySignatureSchema = z.string().regex(/^[a-f0-9]{40}$/u);

export const adminMediaSignatureResponseSchema = z
  .object({
    data: z
      .object({
        cloudName: z.string(),
        apiKey: z.string(),
        uploadUrl: z.url().startsWith('https://'),
        expiresAt: z.iso.datetime(),
        parameters: z
          .object({
            allowed_formats: z.literal('jpg,png,webp'),
            folder: z.string(),
            max_file_size: z.literal(4_194_304),
            public_id: cloudinaryPublicIdSchema,
            timestamp: z.int().positive(),
            signature: cloudinarySignatureSchema,
          })
          .strict(),
      })
      .strict(),
  })
  .strict();

export const adminProductImageRegisterSchema = z
  .object({
    publicId: cloudinaryPublicIdSchema,
    uploadTimestamp: z.int().positive(),
    uploadSignature: cloudinarySignatureSchema,
    altText: adminProductImageAltTextSchema,
    sortOrder: adminProductImageSortOrderSchema,
    isPrimary: z.boolean().optional().default(false),
  })
  .strict();

export const adminProductImageUpdateSchema = z
  .object({
    altText: adminProductImageAltTextSchema.optional(),
    sortOrder: adminProductImageSortOrderSchema.optional(),
    isPrimary: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Update at least one field.',
  });

export const adminProductImageSchema = z
  .object({
    id: adminProductImageIdSchema,
    url: z.url().startsWith('https://'),
    altText: z.string(),
    width: z.int().positive(),
    height: z.int().positive(),
    sortOrder: z.int().nonnegative(),
    isPrimary: z.boolean(),
  })
  .strict();
export const adminProductImageResponseSchema = z
  .object({ data: adminProductImageSchema })
  .strict();

export const adminMediaCleanupSchema = z
  .object({
    imageId: adminProductImageIdSchema,
    status: z.enum(['PENDING', 'FAILED', 'COMPLETED']),
    attemptCount: z.int().min(0).max(5),
  })
  .strict();
export const adminMediaCleanupResponseSchema = z
  .object({ data: adminMediaCleanupSchema })
  .strict();
