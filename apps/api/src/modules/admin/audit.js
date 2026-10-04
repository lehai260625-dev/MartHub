import { Prisma } from '@prisma/client';

export function auditContext(req) {
  return { actorUserId: req.auth.user.id, requestId: req.requestId };
}

export async function writeAdminAudit(
  tx,
  { actorUserId, requestId },
  { action, entityType, entityId, before = null, after = null },
) {
  return tx.adminAuditLog.create({
    data: {
      actorUserId,
      requestId,
      action,
      entityType,
      entityId,
      beforeJson: before === null ? Prisma.JsonNull : before,
      afterJson: after === null ? Prisma.JsonNull : after,
    },
  });
}

export function changed(before, after) {
  return JSON.stringify(before) !== JSON.stringify(after);
}

export function categoryAuditSnapshot(value) {
  return {
    id: value.id,
    parentId: value.parentId,
    name: value.name,
    slug: value.slug,
    description: value.description,
    status: value.status,
    sortOrder: value.sortOrder,
    archivedAt: value.archivedAt ?? null,
  };
}

export function productAuditSnapshot(value) {
  return {
    id: value.id,
    categoryId: value.categoryId,
    sku: value.sku,
    name: value.name,
    slug: value.slug,
    shortDescription: value.shortDescription,
    description: value.description,
    brand: value.brand,
    sellingUnit: value.sellingUnit,
    status: value.status,
    isFeatured: value.isFeatured,
    isNew: value.isNew,
    isPopular: value.isPopular,
    publishedAt: value.publishedAt ?? null,
    archivedAt: value.archivedAt ?? null,
  };
}

export function productImageAuditSnapshot(value, productId) {
  return {
    id: value.id,
    productId,
    publicId: value.cloudinaryPublicId,
    url: value.url,
    altText: value.altText,
    width: value.width,
    height: value.height,
    sortOrder: value.sortOrder,
    isPrimary: value.isPrimary,
  };
}

export function priceAuditSnapshot(value) {
  return {
    id: value.id,
    productId: value.productId,
    price: value.price.toString(),
    compareAtPrice: value.compareAtPrice?.toString() ?? null,
    startsAt:
      value.startsAt instanceof Date
        ? value.startsAt.toISOString()
        : value.startsAt,
    endsAt:
      value.endsAt instanceof Date
        ? value.endsAt.toISOString()
        : (value.endsAt ?? null),
  };
}

export function inventoryQuantityAuditSnapshot({
  inventoryId,
  productId,
  quantityOnHand,
}) {
  return { inventoryId, productId, quantityOnHand };
}
export function inventoryAuditSnapshot({
  inventoryId,
  productId,
  adjustment,
  quantityBefore,
  quantityAfter,
  reason,
}) {
  return {
    inventoryId,
    productId,
    adjustment,
    quantityBefore,
    quantityAfter,
    reason,
  };
}

export function orderStatusAuditSnapshot(
  value,
  { includeCancellationReason = false } = {},
) {
  return {
    orderNumber: value.orderNumber,
    status: value.status,
    ...(includeCancellationReason
      ? { cancellationReason: value.cancellationReason }
      : {}),
  };
}

export function promotionAuditSnapshot(value) {
  return {
    id: value.id,
    title: value.title,
    subtitle: value.subtitle,
    imagePublicId: value.image?.publicId ?? value.imagePublicId ?? null,
    imageUrl: value.image?.url ?? value.imageUrl ?? null,
    internalHref: value.internalHref,
    placement: value.placement,
    status: value.status,
    sortOrder: value.sortOrder,
    startsAt:
      value.startsAt instanceof Date
        ? value.startsAt.toISOString()
        : value.startsAt,
    endsAt:
      value.endsAt instanceof Date
        ? value.endsAt.toISOString()
        : (value.endsAt ?? null),
    archivedAt:
      value.archivedAt instanceof Date
        ? value.archivedAt.toISOString()
        : (value.archivedAt ?? null),
  };
}

export function mediaSignatureAuditSnapshot(contract, ownerKey, ownerId) {
  return {
    [ownerKey]: ownerId,
    publicId: contract.parameters.public_id,
    allowedFormats: contract.parameters.allowed_formats,
    maximumBytes: contract.parameters.max_file_size,
    expiresAt: contract.expiresAt,
  };
}
