import {
  recommendationsQuerySchema,
  recommendationsResponseSchema,
} from '@marthub/contracts';
import { ApiError } from '../../middleware/platform.js';
import { createCatalogService } from '../catalog/service.js';

export function affinityGroups(purchases) {
  const totals = new Map();
  for (const row of purchases)
    totals.set(
      row.categoryId,
      (totals.get(row.categoryId) ?? 0n) + BigInt(row.quantity),
    );
  const groups = new Map();
  for (const [categoryId, quantity] of totals) {
    const key = quantity.toString();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(categoryId);
  }
  return [...groups]
    .sort(([a], [b]) =>
      BigInt(a) > BigInt(b) ? -1 : BigInt(a) < BigInt(b) ? 1 : 0,
    )
    .map(([, ids]) => ids.sort());
}

export function createRecommendationsService({ prisma }) {
  return {
    async list(auth, input) {
      if (!recommendationsQuerySchema.safeParse(input).success)
        throw new ApiError(
          422,
          'VALIDATION_ERROR',
          'This endpoint does not accept query options.',
        );
      return prisma.$transaction(
        async (tx) => {
          const purchases = await tx.$queryRaw`
          SELECT oi.product_id AS "productId", p.category_id AS "categoryId", SUM(oi.quantity) AS quantity
          FROM order_items oi JOIN orders o ON o.id = oi.order_id JOIN products p ON p.id = oi.product_id
          WHERE o.user_id = ${auth.user.id}::uuid AND o.status = 'DELIVERED'
          GROUP BY oi.product_id, p.category_id
        `;
          const excludeIds = purchases.map((row) => row.productId);
          const catalog = createCatalogService({ prisma: tx });
          const products = [];
          for (const categoryIds of affinityGroups(purchases)) {
            products.push(
              ...(await catalog.getRecommendationCandidates({
                excludeIds,
                categoryIds,
                take: 8 - products.length,
              })),
            );
            if (products.length === 8) break;
          }
          if (products.length)
            return recommendationsResponseSchema.parse({
              data: { label: 'PERSONALIZED', products },
            });
          return recommendationsResponseSchema.parse({
            data: {
              label: 'POPULAR',
              products: await catalog.getRecommendationCandidates({
                excludeIds,
                popular: true,
                take: 8,
              }),
            },
          });
        },
        { isolationLevel: 'RepeatableRead' },
      );
    },
  };
}
