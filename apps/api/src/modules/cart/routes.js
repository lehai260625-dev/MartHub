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

function noFields(req) {
  if (
    req.body !== undefined &&
    (req.body === null ||
      typeof req.body !== 'object' ||
      Array.isArray(req.body) ||
      Object.keys(req.body).length)
  )
    throw new ApiError(
      422,
      'VALIDATION_ERROR',
      'This endpoint does not accept fields.',
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
  router.patch('/items/:itemId', async (req, res) => {
    noQuery(req);
    res.json(
      cartResponseSchema.parse({
        data: await cart.update(req.auth, req.params.itemId, req.body),
      }),
    );
  });
  router.delete('/items/:itemId', async (req, res) => {
    noQuery(req);
    noFields(req);
    res.json(
      cartResponseSchema.parse({
        data: await cart.remove(req.auth, req.params.itemId),
      }),
    );
  });
  router.delete('/items', async (req, res) => {
    noQuery(req);
    noFields(req);
    res.json(cartResponseSchema.parse({ data: await cart.clear(req.auth) }));
  });

  return router;
}
