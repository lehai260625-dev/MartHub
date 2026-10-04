import { Router } from 'express';
import { profileResponseSchema } from '@marthub/contracts';
import { requireAuthentication, requireRoles } from '../auth/authorization.js';
import { createProfileService } from './profile.js';
import { createAddressesRouter } from '../addresses/routes.js';
import { createMyItemsService } from '../orders/my-items.js';
import { createRecommendationsService } from '../orders/recommendations.js';

export function createUsersRouter({ prisma, config }) {
  const router = Router();
  const authenticate = requireAuthentication({ prisma, config });
  const profile = createProfileService({ prisma });
  const myItems = createMyItemsService({ prisma });
  const recommendations = createRecommendationsService({ prisma });

  router.use(authenticate, requireRoles('CUSTOMER'));
  router.get('/me', (req, res) => {
    res.json(profileResponseSchema.parse({ data: req.auth.user }));
  });
  router.get('/me/items', async (req, res) => {
    res.json(await myItems.list(req.auth, req.query));
  });
  router.get('/me/recommendations', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(await recommendations.list(req.auth, req.query));
  });
  router.patch('/me', async (req, res) => {
    const user = await profile.update(req.auth.user.id, req.body);
    res.json(profileResponseSchema.parse({ data: user }));
  });
  router.use('/me/addresses', createAddressesRouter({ prisma }));
  return router;
}
