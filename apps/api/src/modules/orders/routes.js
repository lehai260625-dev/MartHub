import { Router } from 'express';
import { customerOrderDetailResponseSchema } from '@marthub/contracts';
import { ApiError } from '../../middleware/platform.js';
import { requireAuthentication, requireRoles } from '../auth/authorization.js';
import { createCustomerOrderService } from './service.js';

export function createCustomerOrderRouter({ prisma, config }) {
  const router = Router();
  const service = createCustomerOrderService({ prisma });
  router.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  router.use(
    requireAuthentication({ prisma, config }),
    requireRoles('CUSTOMER'),
  );
  router.get('/', async (req, res) =>
    res.json(await service.list(req.auth, req.query)),
  );
  router.get('/:orderId', async (req, res) => {
    if (Object.keys(req.query).length)
      throw new ApiError(
        422,
        'VALIDATION_ERROR',
        'This endpoint does not accept query options.',
      );
    res.json(
      customerOrderDetailResponseSchema.parse({
        data: await service.detail(req.auth, req.params.orderId),
      }),
    );
  });
  router.post('/:orderId/cancel', async (req, res) => {
    if (Object.keys(req.query).length)
      throw new ApiError(
        422,
        'VALIDATION_ERROR',
        'This endpoint does not accept query options.',
      );
    res.json(
      customerOrderDetailResponseSchema.parse({
        data: await service.cancel(
          req.auth,
          req.params.orderId,
          req.body ?? {},
        ),
      }),
    );
  });
  return router;
}
