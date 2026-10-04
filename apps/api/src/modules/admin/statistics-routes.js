import { Router } from 'express';
import {
  statisticsOverviewResponseSchema,
  statisticsTopProductsResponseSchema,
  statisticsLowStockResponseSchema,
} from '@marthub/contracts';
import { createAdminStatisticsService } from './statistics.js';
export function createAdminStatisticsRouter({ prisma }) {
  const router = Router();
  const service = createAdminStatisticsService({ prisma });
  for (const [path, method, schema] of [
    ['overview', 'overview', statisticsOverviewResponseSchema],
    ['top-products', 'topProducts', statisticsTopProductsResponseSchema],
    ['low-stock', 'lowStock', statisticsLowStockResponseSchema],
  ]) {
    router.get('/' + path, async (req, res) =>
      res.json(schema.parse({ data: await service[method](req.query) })),
    );
  }
  return router;
}
