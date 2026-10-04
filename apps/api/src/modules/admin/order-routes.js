import { Router } from 'express';
import { adminOrderDetailResponseSchema } from '@marthub/contracts';
import { ApiError } from '../../middleware/platform.js';
import { auditContext } from './audit.js';
import { createAdminOrderService } from './orders.js';

function noQuery(req) {
  if (Object.keys(req.query).length)
    throw new ApiError(
      422,
      'VALIDATION_ERROR',
      'This endpoint does not accept query options.',
    );
}

export function createAdminOrderRouter({ prisma }) {
  const router = Router();
  const orders = createAdminOrderService({ prisma });

  router.get('/', async (req, res) => {
    res.json(await orders.list(req.query));
  });

  router.get('/:orderId', async (req, res) => {
    noQuery(req);
    res.json(
      adminOrderDetailResponseSchema.parse({
        data: await orders.detail(req.params.orderId),
      }),
    );
  });

  router.post('/:orderId/transitions', async (req, res) => {
    noQuery(req);
    res.json(
      adminOrderDetailResponseSchema.parse({
        data: await orders.transition(
          req.params.orderId,
          req.body,
          auditContext(req),
        ),
      }),
    );
  });

  return router;
}
