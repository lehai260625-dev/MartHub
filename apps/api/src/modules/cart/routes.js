import { Router } from 'express';
import { cartResponseSchema } from '@marthub/contracts';
import { ApiError } from '../../middleware/platform.js';
import { requireAuthentication, requireRoles } from '../auth/authorization.js';
import { createCartService } from './service.js';

function noQuery(req) {
  if (Object.keys(req.query).length)
    throw new ApiError(
      422,
      'VALIDATION_ERROR',
      'This endpoint does not accept query options.',
    );
}

export function createCartRouter({ prisma, config }) {
  const router = Router();
  const cart = createCartService({ prisma });
  router.use(
    requireAuthentication({ prisma, config }),
    requireRoles('CUSTOMER'),
  );

  router.get('/', async (req, res) => {
    noQuery(req);
    res.json(cartResponseSchema.parse({ data: await cart.get(req.auth) }));
  });
  router.post('/items', async (req, res) => {
    noQuery(req);
    res.json(
      cartResponseSchema.parse({ data: await cart.add(req.auth, req.body) }),
    );
  });

  return router;
}
