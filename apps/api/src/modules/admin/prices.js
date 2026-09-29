import {
  adminProductIdSchema,
  adminProductPriceCreateSchema,
  adminProductPriceHistoryResponseSchema,
  adminProductPriceResponseSchema,
} from '@marthub/contracts';
import { ApiError } from '../../middleware/platform.js';

const actorSelect = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
};
const priceSelect = {
  id: true,
  productId: true,
  price: true,
  compareAtPrice: true,
  startsAt: true,
  endsAt: true,
  createdAt: true,
  createdBy: { select: actorSelect },
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
function productId(value) {
  const result = adminProductIdSchema.safeParse(value);
  if (!result.success)
    throw new ApiError(404, 'NOT_FOUND', 'Resource not found.');
  return result.data;
}
function timelineConflict(
  message = 'The requested price conflicts with the existing price timeline.',
) {
  throw new ApiError(409, 'PRICE_TIMELINE_CONFLICT', message, [
    {
      field: 'startsAt',
      message: 'Choose a time after the latest scheduled price.',
    },
  ]);
}
function mapPriceConflict(error) {
  if (error instanceof ApiError) throw error;
  const detail = [error?.message, JSON.stringify(error?.meta ?? {})].join(' ');
  if (
    error?.code === 'P2034' ||
    /product_price_no_overlap|product_price_history_immutable|product_price_history_successor_required|exclusion constraint|serialization/i.test(
      detail,
    )
  )
    timelineConflict();
  throw error;
}
function toPrice(row, now) {
  return {
    id: row.id,
    productId: row.productId,
    price: row.price.toString(),
    compareAtPrice: row.compareAtPrice?.toString() ?? null,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    isCurrent: row.startsAt <= now && (row.endsAt === null || row.endsAt > now),
    createdBy: row.createdBy,
  };
}
async function databaseNow(tx) {
  const [clock] = await tx.$queryRaw`SELECT transaction_timestamp() AS "now"`;
  return clock.now;
}

export function createAdminPriceService({ prisma }) {
  return {
    async list(id) {
      const parsedId = productId(id);
      return prisma.$transaction(async (tx) => {
        const product = await tx.product.findUnique({
          where: { id: parsedId },
          select: { id: true },
        });
        if (!product)
          throw new ApiError(404, 'NOT_FOUND', 'Resource not found.');
        const now = await databaseNow(tx);
        const rows = await tx.productPriceHistory.findMany({
          where: { productId: parsedId },
          orderBy: [{ startsAt: 'desc' }, { id: 'desc' }],
          select: priceSelect,
        });
        return adminProductPriceHistoryResponseSchema.parse({
          data: rows.map((row) => toPrice(row, now)),
        });
      });
    },

    async create(id, input, actorId) {
      const parsedId = productId(id);
      const data = parse(adminProductPriceCreateSchema, input);
      const startsAt = new Date(data.startsAt);
      try {
        return await prisma.$transaction(
          async (tx) => {
            const locked = await tx.$queryRaw`
              SELECT "id", "status"
              FROM "products"
              WHERE "id" = ${parsedId}::uuid
              FOR UPDATE
            `;
            if (!locked.length)
              throw new ApiError(404, 'NOT_FOUND', 'Resource not found.');
            if (locked[0].status === 'ARCHIVED')
              throw new ApiError(
                409,
                'PRODUCT_STATUS_CONFLICT',
                'Archived products cannot receive price changes.',
              );
            const predecessor = await tx.productPriceHistory.findFirst({
              where: { productId: parsedId },
              orderBy: [{ startsAt: 'desc' }, { id: 'desc' }],
              select: { id: true, startsAt: true, endsAt: true },
            });
            if (!predecessor)
              timelineConflict('The product does not have an initial price.');
            if (predecessor.endsAt !== null || startsAt <= predecessor.startsAt)
              timelineConflict();
            const closed = await tx.productPriceHistory.updateMany({
              where: { id: predecessor.id, endsAt: null },
              data: { endsAt: startsAt },
            });
            if (closed.count !== 1) timelineConflict();
            const created = await tx.productPriceHistory.create({
              data: {
                productId: parsedId,
                price: BigInt(data.price),
                compareAtPrice:
                  data.compareAtPrice === null
                    ? null
                    : BigInt(data.compareAtPrice),
                startsAt,
                createdByUserId: actorId,
              },
              select: priceSelect,
            });
            const now = await databaseNow(tx);
            return adminProductPriceResponseSchema.parse({
              data: toPrice(created, now),
            });
          },
          { isolationLevel: 'ReadCommitted' },
        );
      } catch (error) {
        mapPriceConflict(error);
      }
    },
  };
}
