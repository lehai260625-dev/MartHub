import { Router } from 'express';
import { wishlistResponseSchema } from '@marthub/contracts';
import { ApiError } from '../../middleware/platform.js';
import { requireAuthentication, requireRoles } from '../auth/authorization.js';
import { createWishlistService } from './service.js';

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

export function createWishlistRouter({ prisma, config }) {
  const router = Router();
  const wishlist = createWishlistService({ prisma });
  router.use(
    requireAuthentication({ prisma, config }),
    requireRoles('CUSTOMER'),
  );

  router.get('/', async (req, res) => {
    noQuery(req);
    res.json(
      wishlistResponseSchema.parse({ data: await wishlist.get(req.auth) }),
    );
  });
  router.put('/items/:productId', async (req, res) => {
    noQuery(req);
    noFields(req);
    res.json(
      wishlistResponseSchema.parse({
        data: await wishlist.add(req.auth, req.params.productId),
      }),
    );
  });
  router.delete('/items/:productId', async (req, res) => {
    noQuery(req);
    noFields(req);
    await wishlist.remove(req.auth, req.params.productId);
    res.status(204).end();
  });

  return router;
}
