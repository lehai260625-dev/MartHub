import { Router } from 'express';
import {
  checkoutQuoteResponseSchema,
  checkoutOrderResponseSchema,
} from '@marthub/contracts';
import { ApiError } from '../../middleware/platform.js';
import { requireAuthentication, requireRoles } from '../auth/authorization.js';
import { createCheckoutService } from './service.js';
import { createOrderService } from './orders.js';

export function createCheckoutRouter({ prisma, config, shippingPolicy }) {
  const router = Router();
  const service = createCheckoutService({ prisma, shippingPolicy });
  const orders = createOrderService({ prisma, shippingPolicy });
  router.use(
    requireAuthentication({ prisma, config }),
    requireRoles('CUSTOMER'),
  );
  router.post('/quote', async (req, res) => {
    if (Object.keys(req.query).length)
      throw new ApiError(
        422,
        'VALIDATION_ERROR',
        'This endpoint does not accept query options.',
      );
    res.json(
      checkoutQuoteResponseSchema.parse({
        data: await service.quote(req.auth, req.body),
      }),
    );
  });
  router.post('/orders', async (req, res) => {
    if (Object.keys(req.query).length)
      throw new ApiError(
        422,
        'VALIDATION_ERROR',
        'This endpoint does not accept query options.',
      );
    const result = await orders.create(
      req.auth,
      req.body,
      req.get('Idempotency-Key'),
    );
    res
      .status(result.created ? 201 : 200)
      .json(checkoutOrderResponseSchema.parse({ data: result.order }));
  });
  return router;
}
