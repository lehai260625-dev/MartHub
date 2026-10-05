import { z } from './schema-runtime.js';
import {
  cloudinaryPublicIdSchema,
  cloudinarySignatureSchema,
} from './admin-media.js';

const plainText = (maximum) =>
  z
    .string()
    .trim()
    .min(1)
    .max(maximum)
    .regex(/^[^<>]+$/u, 'Use plain text.');
const optionalText = (maximum) =>
  z
    .string()
    .trim()
    .max(maximum)
    .nullable()
    .refine(
      (value) => value === null || !/[<>]/u.test(value),
      'Use plain text.',
    );
const internalHrefSchema = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .regex(
    // eslint-disable-next-line no-control-regex -- Reject ASCII controls in internal paths.
    /^\/(?!\/)[^\u0000-\u001f\u007f\\]*$/u,
    'Use a MartHub internal path.',
  );
const placementSchema = z.enum(['HERO_PRIMARY', 'HERO_SECONDARY', 'EDITORIAL']);
const sortOrderSchema = z.int().min(0).max(1_000_000);
const scheduleFields = {
  startsAt: z.iso.datetime({ precision: 3 }),
  endsAt: z.iso.datetime({ precision: 3 }).nullable().optional().default(null),
};
function validSchedule(value, context) {
  if (
    value.startsAt &&
    value.endsAt &&
    new Date(value.endsAt) <= new Date(value.startsAt)
  )
    context.addIssue({
      code: 'custom',
      path: ['endsAt'],
      message: 'End time must be after start time.',
    });
}
const writable = {
  title: plainText(180),
  subtitle: optionalText(300).optional().default(null),
  internalHref: internalHrefSchema,
  placement: placementSchema,
  sortOrder: sortOrderSchema,
  ...scheduleFields,
};

export const adminPromotionIdSchema = z.uuid();
export const adminPromotionCreateSchema = z
  .object(writable)
  .strict()
  .superRefine(validSchedule);
export const adminPromotionUpdateSchema = z
  .object({
    title: writable.title.optional(),
    subtitle: optionalText(300).optional(),
    internalHref: internalHrefSchema.optional(),
    placement: placementSchema.optional(),
    sortOrder: sortOrderSchema.optional(),
    startsAt: scheduleFields.startsAt.optional(),
    endsAt: z.iso.datetime({ precision: 3 }).nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Update at least one field.',
  })
  .superRefine(validSchedule);

export const adminPromotionQuerySchema = z
  .object({
    q: z.string().trim().min(1).max(80).optional(),
    status: z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']).optional(),
    placement: placementSchema.optional(),
    schedule: z.enum(['LIVE', 'UPCOMING', 'ENDED']).optional(),
    page: z.coerce.number().int().min(1).max(1000).default(1),
    perPage: z.coerce.number().int().min(1).max(60).default(24),
  })
  .strict();

export const adminPromotionMediaRegisterSchema = z
  .object({
    publicId: cloudinaryPublicIdSchema,
    uploadTimestamp: z.int().positive(),
    uploadSignature: cloudinarySignatureSchema,
  })
  .strict();

const actorSchema = z
  .object({
    id: z.uuid(),
    email: z.email(),
    firstName: z.string(),
    lastName: z.string(),
  })
  .strict();

export const adminPromotionSchema = z
  .object({
    id: adminPromotionIdSchema,
    title: z.string(),
    subtitle: z.string().nullable(),
    image: z
      .object({
        publicId: cloudinaryPublicIdSchema,
        url: z.url().startsWith('https://'),
      })
      .strict()
      .nullable(),
    internalHref: internalHrefSchema,
    placement: placementSchema,
    status: z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']),
    sortOrder: z.int().nonnegative(),
    startsAt: z.iso.datetime(),
    endsAt: z.iso.datetime().nullable(),
    archivedAt: z.iso.datetime().nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    createdBy: actorSchema.nullable(),
  })
  .strict();

const metaSchema = z
  .object({
    page: z.int().min(1),
    perPage: z.int().min(1).max(60),
    totalItems: z.int().nonnegative(),
    totalPages: z.int().nonnegative(),
  })
  .strict();

export const adminPromotionResponseSchema = z
  .object({ data: adminPromotionSchema })
  .strict();
export const adminPromotionListResponseSchema = z
  .object({ data: z.array(adminPromotionSchema), meta: metaSchema })
  .strict();
export const adminPromotionMediaCleanupResponseSchema = z
  .object({
    data: z
      .object({
        promotionId: adminPromotionIdSchema,
        status: z.enum(['PENDING', 'FAILED', 'COMPLETED']),
        attemptCount: z.int().min(0).max(5),
      })
      .strict(),
  })
  .strict();
