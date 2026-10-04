import { Router } from 'express';
import { adminSessionResponseSchema } from '@marthub/contracts';
import { requireAuthentication, requireRoles } from '../auth/authorization.js';
import { createAdminCategoryRouter } from './category-routes.js';
import { createAdminProductRouter } from './product-routes.js';
import { createAdminInventoryRouter } from './inventory-routes.js';
import { createAdminPromotionRouter } from './promotion-routes.js';
import { createAdminOrderRouter } from './order-routes.js';
import { createAdminUserRouter } from './user-routes.js';
import { createAdminStatisticsRouter } from './statistics-routes.js';

export function createAdminRouter({ prisma, config, media }) {
  const router = Router();

  router.use(requireAuthentication({ prisma, config }), requireRoles('ADMIN'));

  router.get('/', (req, res) => {
    res.json(
      adminSessionResponseSchema.parse({
        data: { user: req.auth.user },
      }),
    );
  });
  router.use('/categories', createAdminCategoryRouter({ prisma }));
  router.use('/products', createAdminProductRouter({ prisma, media }));
  router.use('/inventory', createAdminInventoryRouter({ prisma }));
  router.use('/promotions', createAdminPromotionRouter({ prisma, media }));
  router.use('/orders', createAdminOrderRouter({ prisma }));
  router.use('/users', createAdminUserRouter({ prisma }));
  router.use('/statistics', createAdminStatisticsRouter({ prisma }));

  return router;
}
