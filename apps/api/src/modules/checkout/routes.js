import { Router } from 'express';
import { checkoutQuoteResponseSchema } from '@marthub/contracts';
import { ApiError } from '../../middleware/platform.js';
import { requireAuthentication, requireRoles } from '../auth/authorization.js';
import { createCheckoutService } from './service.js';

export function createCheckoutRouter({ prisma, config, shippingPolicy }) {
  const router = Router();
  const service = createCheckoutService({ prisma, shippingPolicy });
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
  return router;
}
