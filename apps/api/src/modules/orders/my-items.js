import { Prisma } from '@prisma/client';
import { myItemsQuerySchema, myItemsResponseSchema } from '@marthub/contracts';
import { ApiError } from '../../middleware/platform.js';
import { createCatalogService } from '../catalog/service.js';

export function createMyItemsService({ prisma }) {
  return {
    async list(auth, input) {
      const parsed = myItemsQuerySchema.safeParse(input);
      if (!parsed.success)
        throw new ApiError(
          422,
          'VALIDATION_ERROR',
          'Check the query parameters.',
          parsed.error.issues.map((issue) => ({
            field: issue.path.join('.'),
            message: issue.message,
          })),
        );
      const { page, perPage, sort } = parsed.data;
      return prisma.$transaction(
        async (tx) => {
          // One delivery timestamp per source order prevents history joins from
          // multiplying quantities. Every valid delivery has transition history.
          const purchases = Prisma.sql`
          SELECT oi.product_id, oi.order_id, oi.quantity, oi.sku, oi.product_name, oi.image_url, oi.selling_unit,
            delivery.created_at AS last_purchased_at
          FROM order_items oi JOIN orders o ON o.id = oi.order_id
          JOIN LATERAL (
            SELECT h.created_at FROM order_status_history h
            WHERE h.order_id = o.id AND h.to_status = 'DELIVERED'
            ORDER BY h.created_at DESC, h.id DESC LIMIT 1
          ) delivery ON true
          WHERE o.user_id = ${auth.user.id}::uuid AND o.status = 'DELIVERED'
        `;
          const [{ totalItems }] = await tx.$queryRaw(Prisma.sql`
          WITH purchases AS (${purchases})
          SELECT COUNT(DISTINCT product_id) AS "totalItems" FROM purchases
        `);
          const order =
            sort === 'frequent'
              ? Prisma.sql`purchase_count DESC, last_purchased_at DESC, product_id ASC`
              : Prisma.sql`last_purchased_at DESC, product_id ASC`;
          const rows = await tx.$queryRaw(Prisma.sql`
          WITH purchases AS (${purchases}), ranked AS (
            SELECT *, SUM(quantity) OVER (PARTITION BY product_id) AS purchase_count,
              ROW_NUMBER() OVER (PARTITION BY product_id ORDER BY last_purchased_at DESC, order_id DESC) AS source_rank
            FROM purchases
          )
          SELECT product_id AS "productId", order_id AS "orderId", purchase_count AS "purchaseCount",
            last_purchased_at AS "lastPurchasedAt", sku, product_name AS "productName",
            image_url AS "imageUrl", selling_unit AS "sellingUnit"
          FROM ranked WHERE source_rank = 1 ORDER BY ${order}
          LIMIT ${perPage} OFFSET ${(page - 1) * perPage}
        `);
          const cards = await createCatalogService({
            prisma: tx,
          }).getProductCardsByIds(rows.map((row) => row.productId));
          const byId = new Map(cards.map((card) => [card.id, card]));
          return myItemsResponseSchema.parse({
            data: rows.map((row) => {
              const currentProduct = byId.get(row.productId) ?? null;
              return {
                productId: row.productId,
                orderId: row.orderId,
                purchaseCount: Number(row.purchaseCount),
                lastPurchasedAt: row.lastPurchasedAt.toISOString(),
                snapshot: {
                  sku: row.sku,
                  productName: row.productName,
                  imageUrl: row.imageUrl,
                  sellingUnit: row.sellingUnit,
                },
                currentProduct,
                currentPrice: currentProduct?.price ?? null,
                availability:
                  currentProduct?.availability.status ?? 'UNAVAILABLE',
              };
            }),
            meta: {
              page,
              perPage,
              totalItems: Number(totalItems),
              totalPages: Math.ceil(Number(totalItems) / perPage),
            },
          });
        },
        { isolationLevel: 'RepeatableRead' },
      );
    },
  };
}
