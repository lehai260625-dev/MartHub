import {
  adminInventoryAdjustmentResponseSchema,
  adminInventoryAdjustmentSchema,
  adminInventoryListResponseSchema,
  adminInventoryMovementListResponseSchema,
  adminInventoryMovementQuerySchema,
  adminInventoryQuerySchema,
  adminProductIdSchema,
} from '@marthub/contracts';
import { ApiError } from '../../middleware/platform.js';
import {
  inventoryAuditSnapshot,
  inventoryQuantityAuditSnapshot,
  writeAdminAudit,
} from './audit.js';

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
function productId(value) {
  const result = adminProductIdSchema.safeParse(value);
  if (!result.success)
    throw new ApiError(404, 'NOT_FOUND', 'Resource not found.');
  return result.data;
}
const productSelect = { sku: true, name: true, status: true };
const actorSelect = { id: true, email: true, firstName: true, lastName: true };
function metadata(query, totalItems) {
  return {
    page: query.page,
    perPage: query.perPage,
    totalItems,
    totalPages: Math.ceil(totalItems / query.perPage),
  };
}
function toItem(row) {
  return {
    productId: row.productId,
    sku: row.product.sku,
    name: row.product.name,
    status: row.product.status,
    quantityOnHand: row.quantityOnHand,
    updatedAt: row.updatedAt.toISOString(),
  };
}
function toMovement(row) {
  return {
    id: row.id,
    productId: row.productId,
    type: row.type,
    adjustment: row.quantityDelta,
    quantityBefore: row.quantityAfter - row.quantityDelta,
    quantityAfter: row.quantityAfter,
    orderId: row.orderId,
    reason: row.reason,
    createdAt: row.createdAt.toISOString(),
    actor: row.actor,
  };
}

export function createAdminInventoryService({ prisma }) {
  return {
    async list(input) {
      const query = parse(adminInventoryQuerySchema, input);
      const where = {
        ...(query.maxQuantity === undefined
          ? {}
          : { quantityOnHand: { lte: query.maxQuantity } }),
        product: {
          ...(query.status ? { status: query.status } : {}),
          ...(query.q
            ? {
                OR: [
                  { name: { contains: query.q, mode: 'insensitive' } },
                  { sku: { contains: query.q, mode: 'insensitive' } },
                ],
              }
            : {}),
        },
      };
      const [totalItems, rows] = await prisma.$transaction([
        prisma.inventory.count({ where }),
        prisma.inventory.findMany({
          where,
          orderBy: [{ quantityOnHand: 'asc' }, { productId: 'asc' }],
          skip: (query.page - 1) * query.perPage,
          take: query.perPage,
          select: {
            id: true,
            productId: true,
            quantityOnHand: true,
            updatedAt: true,
            product: { select: productSelect },
          },
        }),
      ]);
      return adminInventoryListResponseSchema.parse({
        data: rows.map(toItem),
        meta: metadata(query, totalItems),
      });
    },

    async movements(id, input) {
      const resolvedId = productId(id);
      const query = parse(adminInventoryMovementQuerySchema, input);
      const inventory = await prisma.inventory.findUnique({
        where: { productId: resolvedId },
        select: { id: true },
      });
      if (!inventory)
        throw new ApiError(404, 'NOT_FOUND', 'Resource not found.');
      const where = { productId: resolvedId };
      const [totalItems, rows] = await prisma.$transaction([
        prisma.inventoryMovement.count({ where }),
        prisma.inventoryMovement.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: (query.page - 1) * query.perPage,
          take: query.perPage,
          select: {
            id: true,
            productId: true,
            type: true,
            quantityDelta: true,
            quantityAfter: true,
            orderId: true,
            reason: true,
            createdAt: true,
            actor: { select: actorSelect },
          },
        }),
      ]);
      return adminInventoryMovementListResponseSchema.parse({
        data: rows.map(toMovement),
        meta: metadata(query, totalItems),
      });
    },

    async adjust(id, input, actorUserId, audit) {
      const resolvedId = productId(id);
      const data = parse(adminInventoryAdjustmentSchema, input);
      return prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw`
          SELECT i."id", i."product_id" AS "productId", i."quantity_on_hand" AS "quantityOnHand"
          FROM "inventory" i
          WHERE i."product_id" = ${resolvedId}::uuid
          FOR UPDATE OF i
        `;
        const current = rows[0];
        if (!current)
          throw new ApiError(404, 'NOT_FOUND', 'Resource not found.');
        const quantityAfter = current.quantityOnHand + data.adjustment;
        if (quantityAfter < 0)
          throw new ApiError(
            409,
            'INSUFFICIENT_STOCK',
            'The adjustment would make stock negative.',
            [
              {
                field: 'adjustment',
                productId: resolvedId,
                available: current.quantityOnHand,
              },
            ],
          );
        if (quantityAfter > 2147483647)
          throw new ApiError(
            422,
            'VALIDATION_ERROR',
            'Check the submitted fields.',
            [
              {
                field: 'adjustment',
                message: 'Resulting stock is too large.',
              },
            ],
          );
        const inventory = await tx.inventory.update({
          where: { productId: resolvedId },
          data: { quantityOnHand: quantityAfter },
          select: {
            id: true,
            productId: true,
            quantityOnHand: true,
            updatedAt: true,
            product: { select: productSelect },
          },
        });
        const movement = await tx.inventoryMovement.create({
          data: {
            productId: resolvedId,
            type: 'ADJUSTMENT',
            quantityDelta: data.adjustment,
            quantityAfter,
            actorUserId,
            reason: data.reason,
          },
          select: {
            id: true,
            productId: true,
            type: true,
            quantityDelta: true,
            quantityAfter: true,
            orderId: true,
            reason: true,
            createdAt: true,
            actor: { select: actorSelect },
          },
        });
        await writeAdminAudit(tx, audit, {
          action: 'INVENTORY_ADJUST',
          entityType: 'INVENTORY',
          entityId: inventory.id,
          before: inventoryQuantityAuditSnapshot({
            inventoryId: inventory.id,
            productId: resolvedId,
            quantityOnHand: current.quantityOnHand,
          }),
          after: inventoryAuditSnapshot({
            inventoryId: inventory.id,
            productId: resolvedId,
            adjustment: data.adjustment,
            quantityBefore: current.quantityOnHand,
            quantityAfter,
            reason: data.reason,
          }),
        });
        return adminInventoryAdjustmentResponseSchema.parse({
          data: {
            inventory: toItem(inventory),
            movement: toMovement(movement),
          },
        });
      });
    },
  };
}
