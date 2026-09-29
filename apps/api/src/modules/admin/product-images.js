import { randomUUID } from 'node:crypto';
import {
  adminMediaCleanupResponseSchema,
  adminMediaSignatureResponseSchema,
  adminProductIdSchema,
  adminProductImageIdSchema,
  adminProductImageRegisterSchema,
  adminProductImageResponseSchema,
  adminProductImageUpdateSchema,
} from '@marthub/contracts';
import {
  PRODUCT_IMAGE_FORMATS,
  PRODUCT_IMAGE_MAX_BYTES,
} from '../../config/media.js';
import { ApiError } from '../../middleware/platform.js';
import { attemptMediaCleanup } from '../media/cleanup.js';

const imageSelect = {
  id: true,
  url: true,
  altText: true,
  width: true,
  height: true,
  sortOrder: true,
  isPrimary: true,
};

function validationError(error) {
  return new ApiError(
    422,
    'VALIDATION_ERROR',
    'Check the submitted fields.',
    error.issues.map((issue) => ({
      field: issue.path.join('.'),
      message: issue.message,
    })),
  );
}
function parse(schema, input) {
  const result = schema.safeParse(input);
  if (!result.success) throw validationError(result.error);
  return result.data;
}
function id(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new ApiError(404, 'NOT_FOUND', 'Resource not found.');
  return result.data;
}
function noMedia() {
  throw new ApiError(
    503,
    'MEDIA_UNAVAILABLE',
    'Media management is not configured.',
  );
}
async function product(db, value, { editable = false } = {}) {
  const row = await db.product.findUnique({
    where: { id: id(adminProductIdSchema, value) },
    select: { id: true, status: true },
  });
  if (!row) throw new ApiError(404, 'NOT_FOUND', 'Resource not found.');
  if (editable && row.status === 'ARCHIVED')
    throw new ApiError(
      409,
      'PRODUCT_STATUS_CONFLICT',
      'Archived products cannot be edited.',
    );
  return row;
}
function toImage(row) {
  return adminProductImageResponseSchema.parse({ data: row }).data;
}
function toCleanup(row) {
  return adminMediaCleanupResponseSchema.parse({
    data: {
      imageId: row.productImageId,
      status: row.status,
      attemptCount: row.attemptCount,
    },
  }).data;
}
async function scheduleCleanup(
  prisma,
  { productId, productImageId, cloudinaryPublicId },
) {
  return prisma.mediaCleanup.upsert({
    where: { cloudinaryPublicId },
    create: {
      productId,
      productImageId,
      cloudinaryPublicId,
      status: 'PENDING',
    },
    update: {},
  });
}
function resourceError(message, field = 'publicId') {
  throw new ApiError(422, 'INVALID_MEDIA', message, [{ field, message }]);
}
function verifyResource(resource, expectedPublicId, productId) {
  const format = resource.format === 'jpeg' ? 'jpg' : resource.format;
  if (resource.public_id !== expectedPublicId)
    resourceError('Cloudinary returned a different public ID.');
  if (!expectedPublicId.startsWith(`marthub/products/${productId}/`))
    resourceError('The uploaded asset does not belong to this product.');
  if (!PRODUCT_IMAGE_FORMATS.includes(format))
    resourceError('Use a JPEG, PNG, or WebP image.');
  if (
    !Number.isInteger(resource.bytes) ||
    resource.bytes < 1 ||
    resource.bytes > PRODUCT_IMAGE_MAX_BYTES
  )
    resourceError('Image size must not exceed 4 MB.');
  if (
    !Number.isInteger(resource.width) ||
    resource.width < 1 ||
    !Number.isInteger(resource.height) ||
    resource.height < 1
  )
    resourceError('Cloudinary returned invalid image dimensions.');
  if (resource.resource_type && resource.resource_type !== 'image')
    resourceError('The uploaded asset is not an image.');
  if (resource.type && resource.type !== 'upload')
    resourceError('The uploaded asset type is not supported.');
  return { format, width: resource.width, height: resource.height };
}

export function createAdminProductImageService({ prisma, media }) {
  async function cleanupOrphan(productId, publicId, now) {
    const cleanup = await scheduleCleanup(prisma, {
      productId,
      productImageId: randomUUID(),
      cloudinaryPublicId: publicId,
    });
    if (media) await attemptMediaCleanup({ prisma, media, cleanup, now });
  }

  return {
    async signature(productIdValue, now = new Date()) {
      if (!media) noMedia();
      const target = await product(prisma, productIdValue, { editable: true });
      const productImageId = randomUUID();
      const publicId = `marthub/products/${target.id}/${randomUUID()}`;
      const contract = media.createUploadContract(target.id, publicId, now);
      await prisma.mediaCleanup.create({
        data: {
          productId: target.id,
          productImageId,
          cloudinaryPublicId: publicId,
          status: 'PENDING',
          nextAttemptAt: new Date(contract.expiresAt),
        },
      });
      return adminMediaSignatureResponseSchema.parse({ data: contract }).data;
    },

    async register(productIdValue, input, now = new Date()) {
      if (!media) noMedia();
      const target = await product(prisma, productIdValue, { editable: true });
      const data = parse(adminProductImageRegisterSchema, input);
      if (!data.publicId.startsWith(`marthub/products/${target.id}/`))
        resourceError('The uploaded asset does not belong to this product.');
      if (
        !media.verifyUploadContract(
          target.id,
          data.publicId,
          data.uploadTimestamp,
          data.uploadSignature,
          now,
        )
      ) {
        await cleanupOrphan(target.id, data.publicId, now);
        throw new ApiError(
          422,
          'UPLOAD_CONTRACT_EXPIRED',
          'Request a new upload signature and upload again.',
        );
      }
      const uploadIntent = await prisma.mediaCleanup.findUnique({
        where: { cloudinaryPublicId: data.publicId },
      });
      if (
        !uploadIntent ||
        uploadIntent.productId !== target.id ||
        uploadIntent.status !== 'PENDING'
      )
        throw new ApiError(
          422,
          'MEDIA_NOT_VERIFIED',
          'The signed upload intent is unavailable. Request a new signature.',
        );
      const attached = await prisma.productImage.findUnique({
        where: { cloudinaryPublicId: data.publicId },
        select: { id: true },
      });
      if (attached)
        throw new ApiError(
          409,
          'MEDIA_CONFLICT',
          'This Cloudinary asset is already attached.',
        );
      let resource;
      try {
        resource = await media.inspect(data.publicId);
        verifyResource(resource, data.publicId, target.id);
      } catch (error) {
        await cleanupOrphan(target.id, data.publicId, now);
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
      try {
        const row = await prisma.$transaction(async (tx) => {
          await tx.$queryRawUnsafe(
            'SELECT "id" FROM "product_images" WHERE "product_id" = $1::uuid ORDER BY "id" FOR UPDATE',
            target.id,
          );
          const intent = await tx.mediaCleanup.findUnique({
            where: { cloudinaryPublicId: data.publicId },
          });
          if (!intent || intent.status !== 'PENDING')
            throw new ApiError(
              409,
              'MEDIA_CONFLICT',
              'The upload intent is no longer available.',
            );
          await tx.mediaCleanup.delete({ where: { id: intent.id } });
          const count = await tx.productImage.count({
            where: { productId: target.id },
          });
          const makePrimary = data.isPrimary || count === 0;
          if (makePrimary)
            await tx.productImage.updateMany({
              where: { productId: target.id, isPrimary: true },
              data: { isPrimary: false },
            });
          return tx.productImage.create({
            data: {
              productId: target.id,
              cloudinaryPublicId: data.publicId,
              url: media.deliveryUrl(data.publicId),
              altText: data.altText,
              width: resource.width,
              height: resource.height,
              sortOrder: data.sortOrder,
              isPrimary: makePrimary,
            },
            select: imageSelect,
          });
        });
        return toImage(row);
      } catch (error) {
        const raced = await prisma.productImage.findUnique({
          where: { cloudinaryPublicId: data.publicId },
          select: { id: true },
        });
        if (raced)
          throw new ApiError(
            409,
            'MEDIA_CONFLICT',
            'This Cloudinary asset is already attached.',
          );
        await cleanupOrphan(target.id, data.publicId, now);
        if (error?.code === 'P2002')
          throw new ApiError(
            409,
            'IMAGE_ORDER_CONFLICT',
            'Another image already uses this display order.',
            [
              {
                field: 'sortOrder',
                message: 'Choose a different display order.',
              },
            ],
          );
        throw error;
      }
    },

    async update(productIdValue, imageIdValue, input) {
      const target = await product(prisma, productIdValue, { editable: true });
      const imageId = id(adminProductImageIdSchema, imageIdValue);
      const data = parse(adminProductImageUpdateSchema, input);
      return prisma.$transaction(async (tx) => {
        await tx.$queryRawUnsafe(
          'SELECT "id" FROM "product_images" WHERE "product_id" = $1::uuid ORDER BY "id" FOR UPDATE',
          target.id,
        );
        const existing = await tx.productImage.findFirst({
          where: { id: imageId, productId: target.id },
          select: imageSelect,
        });
        if (!existing)
          throw new ApiError(404, 'NOT_FOUND', 'Resource not found.');
        if (
          data.sortOrder !== undefined &&
          data.sortOrder !== existing.sortOrder
        ) {
          const occupant = await tx.productImage.findFirst({
            where: { productId: target.id, sortOrder: data.sortOrder },
            select: { id: true },
          });
          if (occupant) {
            const maximum = await tx.productImage.aggregate({
              where: { productId: target.id },
              _max: { sortOrder: true },
            });
            const temporary = (maximum._max.sortOrder ?? 0) + 1;
            await tx.productImage.update({
              where: { id: occupant.id },
              data: { sortOrder: temporary },
            });
            await tx.productImage.update({
              where: { id: existing.id },
              data: { sortOrder: data.sortOrder },
            });
            await tx.productImage.update({
              where: { id: occupant.id },
              data: { sortOrder: existing.sortOrder },
            });
          }
        }
        if (data.isPrimary === true)
          await tx.productImage.updateMany({
            where: {
              productId: target.id,
              isPrimary: true,
              id: { not: existing.id },
            },
            data: { isPrimary: false },
          });
        const row = await tx.productImage.update({
          where: { id: existing.id },
          data: {
            ...(data.altText !== undefined ? { altText: data.altText } : {}),
            ...(data.sortOrder !== undefined
              ? { sortOrder: data.sortOrder }
              : {}),
            ...(data.isPrimary !== undefined
              ? { isPrimary: data.isPrimary }
              : {}),
          },
          select: imageSelect,
        });
        return toImage(row);
      });
    },

    async remove(productIdValue, imageIdValue, now = new Date()) {
      if (!media) noMedia();
      const target = await product(prisma, productIdValue);
      const imageId = id(adminProductImageIdSchema, imageIdValue);
      let cleanup = await prisma.$transaction(async (tx) => {
        await tx.$queryRawUnsafe(
          'SELECT "id" FROM "product_images" WHERE "product_id" = $1::uuid ORDER BY "id" FOR UPDATE',
          target.id,
        );
        const image = await tx.productImage.findFirst({
          where: { id: imageId, productId: target.id },
        });
        if (!image) {
          const existing = await tx.mediaCleanup.findUnique({
            where: { productImageId: imageId },
          });
          if (!existing || existing.productId !== target.id)
            throw new ApiError(404, 'NOT_FOUND', 'Resource not found.');
          return existing;
        }
        await tx.productImage.delete({ where: { id: image.id } });
        if (image.isPrimary) {
          const next = await tx.productImage.findFirst({
            where: { productId: target.id },
            orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
            select: { id: true },
          });
          if (next)
            await tx.productImage.update({
              where: { id: next.id },
              data: { isPrimary: true },
            });
        }
        return tx.mediaCleanup.create({
          data: {
            productId: target.id,
            productImageId: image.id,
            cloudinaryPublicId: image.cloudinaryPublicId,
          },
        });
      });
      if (cleanup.status !== 'COMPLETED' && cleanup.attemptCount < 5)
        cleanup = await attemptMediaCleanup({ prisma, media, cleanup, now });
      return toCleanup(cleanup);
    },
  };
}
