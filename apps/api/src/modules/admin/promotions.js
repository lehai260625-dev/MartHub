import { randomUUID } from 'node:crypto';
import {
  adminMediaSignatureResponseSchema,
  adminPromotionCreateSchema,
  adminPromotionIdSchema,
  adminPromotionListResponseSchema,
  adminPromotionMediaCleanupResponseSchema,
  adminPromotionMediaRegisterSchema,
  adminPromotionQuerySchema,
  adminPromotionResponseSchema,
  adminPromotionUpdateSchema,
} from '@marthub/contracts';
import {
  PRODUCT_IMAGE_FORMATS,
  PRODUCT_IMAGE_MAX_BYTES,
} from '../../config/media.js';
import { ApiError } from '../../middleware/platform.js';
import { attemptMediaCleanup } from '../media/cleanup.js';

const actorSelect = { id: true, email: true, firstName: true, lastName: true };
const select = {
  id: true,
  title: true,
  subtitle: true,
  imagePublicId: true,
  imageUrl: true,
  internalHref: true,
  placement: true,
  status: true,
  sortOrder: true,
  startsAt: true,
  endsAt: true,
  archivedAt: true,
  createdAt: true,
  updatedAt: true,
  createdBy: { select: actorSelect },
};
function parse(schema, input) {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  throw new ApiError(
    422,
    'VALIDATION_ERROR',
    'Check the submitted fields.',
    result.error.issues.map((issue) => ({
      field: issue.path.join('.'),
      message: issue.message,
    })),
  );
}
function id(value) {
  const result = adminPromotionIdSchema.safeParse(value);
  if (!result.success)
    throw new ApiError(404, 'NOT_FOUND', 'Resource not found.');
  return result.data;
}
function notFound() {
  throw new ApiError(404, 'NOT_FOUND', 'Resource not found.');
}
function noMedia() {
  throw new ApiError(
    503,
    'MEDIA_UNAVAILABLE',
    'Media management is not configured.',
  );
}
function output(row) {
  return adminPromotionResponseSchema.parse({
    data: {
      id: row.id,
      title: row.title,
      subtitle: row.subtitle,
      image: row.imagePublicId
        ? { publicId: row.imagePublicId, url: row.imageUrl }
        : null,
      internalHref: row.internalHref,
      placement: row.placement,
      status: row.status,
      sortOrder: row.sortOrder,
      startsAt: row.startsAt.toISOString(),
      endsAt: row.endsAt?.toISOString() ?? null,
      archivedAt: row.archivedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      createdBy: row.createdBy,
    },
  }).data;
}
async function find(db, value, editable = false) {
  const row = await db.promotion.findUnique({
    where: { id: id(value) },
    select,
  });
  if (!row) notFound();
  if (editable && row.status === 'ARCHIVED')
    throw new ApiError(
      409,
      'PROMOTION_STATUS_CONFLICT',
      'Archived promotions cannot be edited.',
    );
  return row;
}
function schedule(startsAt, endsAt) {
  if (endsAt && endsAt <= startsAt)
    throw new ApiError(422, 'VALIDATION_ERROR', 'Check the submitted fields.', [
      { field: 'endsAt', message: 'End time must be after start time.' },
    ]);
}
function invalidMedia(message) {
  throw new ApiError(422, 'INVALID_MEDIA', message, [
    { field: 'publicId', message },
  ]);
}
function verifyResource(resource, publicId, promotionId) {
  const format = resource.format === 'jpeg' ? 'jpg' : resource.format;
  if (resource.public_id !== publicId)
    invalidMedia('Cloudinary returned a different public ID.');
  if (!publicId.startsWith('marthub/promotions/' + promotionId + '/'))
    invalidMedia('The uploaded asset does not belong to this promotion.');
  if (!PRODUCT_IMAGE_FORMATS.includes(format))
    invalidMedia('Use a JPEG, PNG, or WebP image.');
  if (
    !Number.isInteger(resource.bytes) ||
    resource.bytes < 1 ||
    resource.bytes > PRODUCT_IMAGE_MAX_BYTES
  )
    invalidMedia('Image size must not exceed 4 MB.');
  if (
    !Number.isInteger(resource.width) ||
    resource.width < 1 ||
    !Number.isInteger(resource.height) ||
    resource.height < 1
  )
    invalidMedia('Cloudinary returned invalid image dimensions.');
  if (resource.resource_type && resource.resource_type !== 'image')
    invalidMedia('The uploaded asset is not an image.');
  if (resource.type && resource.type !== 'upload')
    invalidMedia('The uploaded asset type is not supported.');
}

export function createAdminPromotionService({ prisma, media }) {
  const cleanup = (row, now) =>
    media ? attemptMediaCleanup({ prisma, media, cleanup: row, now }) : row;
  return {
    async list(input) {
      const query = parse(adminPromotionQuerySchema, input);
      return prisma.$transaction(async (tx) => {
        const [{ now }] = await tx.$queryRawUnsafe(
          'SELECT transaction_timestamp() AS "now"',
        );
        const scheduleWhere =
          query.schedule === 'LIVE'
            ? {
                startsAt: { lte: now },
                OR: [{ endsAt: null }, { endsAt: { gt: now } }],
              }
            : query.schedule === 'UPCOMING'
              ? { startsAt: { gt: now } }
              : query.schedule === 'ENDED'
                ? { endsAt: { lte: now } }
                : {};
        const where = {
          ...scheduleWhere,
          ...(query.status ? { status: query.status } : {}),
          ...(query.placement ? { placement: query.placement } : {}),
          ...(query.q
            ? {
                OR: [
                  { title: { contains: query.q, mode: 'insensitive' } },
                  { subtitle: { contains: query.q, mode: 'insensitive' } },
                ],
              }
            : {}),
        };
        const totalItems = await tx.promotion.count({ where });
        const rows = await tx.promotion.findMany({
          where,
          orderBy: [
            { placement: 'asc' },
            { sortOrder: 'asc' },
            { startsAt: 'desc' },
            { id: 'asc' },
          ],
          skip: (query.page - 1) * query.perPage,
          take: query.perPage,
          select,
        });
        return adminPromotionListResponseSchema.parse({
          data: rows.map(output),
          meta: {
            page: query.page,
            perPage: query.perPage,
            totalItems,
            totalPages: Math.ceil(totalItems / query.perPage),
          },
        });
      });
    },
    async get(value) {
      return output(await find(prisma, value));
    },
    async create(input, actorId) {
      const data = parse(adminPromotionCreateSchema, input);
      const startsAt = new Date(data.startsAt);
      const endsAt = data.endsAt ? new Date(data.endsAt) : null;
      schedule(startsAt, endsAt);
      return output(
        await prisma.promotion.create({
          data: {
            ...data,
            startsAt,
            endsAt,
            status: 'DRAFT',
            createdByUserId: actorId,
          },
          select,
        }),
      );
    },
    async update(value, input) {
      const data = parse(adminPromotionUpdateSchema, input);
      return prisma.$transaction(async (tx) => {
        const current = await find(tx, value, true);
        const startsAt = data.startsAt
          ? new Date(data.startsAt)
          : current.startsAt;
        const endsAt =
          data.endsAt !== undefined
            ? data.endsAt
              ? new Date(data.endsAt)
              : null
            : current.endsAt;
        schedule(startsAt, endsAt);
        return output(
          await tx.promotion.update({
            where: { id: current.id },
            data: {
              ...data,
              ...(data.startsAt ? { startsAt } : {}),
              ...(data.endsAt !== undefined ? { endsAt } : {}),
            },
            select,
          }),
        );
      });
    },
    async publish(value) {
      const current = await find(prisma, value, true);
      return output(
        current.status === 'ACTIVE'
          ? current
          : await prisma.promotion.update({
              where: { id: current.id },
              data: { status: 'ACTIVE', archivedAt: null },
              select,
            }),
      );
    },
    async archive(value, now = new Date()) {
      const current = await find(prisma, value);
      return output(
        current.status === 'ARCHIVED'
          ? current
          : await prisma.promotion.update({
              where: { id: current.id },
              data: { status: 'ARCHIVED', archivedAt: now },
              select,
            }),
      );
    },
    async signature(value, now = new Date()) {
      if (!media) noMedia();
      const current = await find(prisma, value, true);
      const publicId = 'marthub/promotions/' + current.id + '/' + randomUUID();
      const contract = media.createPromotionUploadContract(
        current.id,
        publicId,
        now,
      );
      await prisma.mediaCleanup.create({
        data: {
          ownerType: 'PROMOTION_MEDIA',
          promotionId: current.id,
          cloudinaryPublicId: publicId,
          nextAttemptAt: new Date(contract.expiresAt),
        },
      });
      return adminMediaSignatureResponseSchema.parse({ data: contract }).data;
    },
    async register(value, input, now = new Date()) {
      if (!media) noMedia();
      const current = await find(prisma, value, true);
      const data = parse(adminPromotionMediaRegisterSchema, input);
      if (!data.publicId.startsWith('marthub/promotions/' + current.id + '/'))
        invalidMedia('The uploaded asset does not belong to this promotion.');
      const intent = await prisma.mediaCleanup.findUnique({
        where: { cloudinaryPublicId: data.publicId },
      });
      if (
        !intent ||
        intent.ownerType !== 'PROMOTION_MEDIA' ||
        intent.promotionId !== current.id ||
        intent.status !== 'PENDING'
      )
        throw new ApiError(
          422,
          'MEDIA_NOT_VERIFIED',
          'The signed upload intent is unavailable. Request a new signature.',
        );
      if (
        !media.verifyPromotionUploadContract(
          current.id,
          data.publicId,
          data.uploadTimestamp,
          data.uploadSignature,
          now,
        )
      ) {
        await cleanup(intent, now);
        throw new ApiError(
          422,
          'UPLOAD_CONTRACT_EXPIRED',
          'Request a new upload signature and upload again.',
        );
      }
      try {
        verifyResource(
          await media.inspect(data.publicId),
          data.publicId,
          current.id,
        );
      } catch (error) {
        await cleanup(intent, now);
        if (error instanceof ApiError) throw error;
        throw new ApiError(
          error.code === 'CLOUDINARY_NOT_FOUND' ? 422 : 503,
          error.code === 'CLOUDINARY_NOT_FOUND'
            ? 'MEDIA_NOT_VERIFIED'
            : 'MEDIA_PROVIDER_ERROR',
          error.code === 'CLOUDINARY_NOT_FOUND'
            ? 'The uploaded image could not be verified.'
            : 'Cloudinary verification is temporarily unavailable.',
        );
      }
      let oldCleanup;
      const row = await prisma.$transaction(async (tx) => {
        await tx.$queryRawUnsafe(
          'SELECT "id" FROM "promotions" WHERE "id" = $1::uuid FOR UPDATE',
          current.id,
        );
        const locked = await tx.promotion.findUniqueOrThrow({
          where: { id: current.id },
          select,
        });
        if (locked.status === 'ARCHIVED')
          throw new ApiError(
            409,
            'PROMOTION_STATUS_CONFLICT',
            'Archived promotions cannot be edited.',
          );
        const liveIntent = await tx.mediaCleanup.findUnique({
          where: { cloudinaryPublicId: data.publicId },
        });
        if (!liveIntent || liveIntent.status !== 'PENDING')
          throw new ApiError(
            409,
            'MEDIA_CONFLICT',
            'The upload intent is no longer available.',
          );
        await tx.mediaCleanup.delete({ where: { id: liveIntent.id } });
        if (locked.imagePublicId && locked.imagePublicId !== data.publicId)
          oldCleanup = await tx.mediaCleanup.create({
            data: {
              ownerType: 'PROMOTION_MEDIA',
              promotionId: current.id,
              cloudinaryPublicId: locked.imagePublicId,
            },
          });
        return tx.promotion.update({
          where: { id: current.id },
          data: {
            imagePublicId: data.publicId,
            imageUrl: media.deliveryUrl(data.publicId),
          },
          select,
        });
      });
      if (oldCleanup) await cleanup(oldCleanup, now);
      return output(row);
    },
    async removeMedia(value, now = new Date()) {
      if (!media) noMedia();
      const promotionId = id(value);
      let task = await prisma.$transaction(async (tx) => {
        await tx.$queryRawUnsafe(
          'SELECT "id" FROM "promotions" WHERE "id" = $1::uuid FOR UPDATE',
          promotionId,
        );
        const current = await tx.promotion.findUnique({
          where: { id: promotionId },
          select,
        });
        if (!current) notFound();
        if (!current.imagePublicId) {
          const existing = await tx.mediaCleanup.findFirst({
            where: { ownerType: 'PROMOTION_MEDIA', promotionId },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          });
          if (!existing) notFound();
          return existing;
        }
        await tx.promotion.update({
          where: { id: promotionId },
          data: { imagePublicId: null, imageUrl: null },
        });
        return tx.mediaCleanup.create({
          data: {
            ownerType: 'PROMOTION_MEDIA',
            promotionId,
            cloudinaryPublicId: current.imagePublicId,
          },
        });
      });
      if (task.status !== 'COMPLETED' && task.attemptCount < 5)
        task = await cleanup(task, now);
      return adminPromotionMediaCleanupResponseSchema.parse({
        data: {
          promotionId: task.promotionId,
          status: task.status,
          attemptCount: task.attemptCount,
        },
      });
    },
  };
}
