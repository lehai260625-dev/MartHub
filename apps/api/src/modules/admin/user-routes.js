import { Router } from 'express';
import { adminUserDetailResponseSchema } from '@marthub/contracts';
import { ApiError } from '../../middleware/platform.js';
import { auditContext } from './audit.js';
import { createAdminUserService } from './users.js';
function noQuery(req) {
  if (Object.keys(req.query).length)
    throw new ApiError(
      422,
      'VALIDATION_ERROR',
      'This endpoint does not accept query options.',
    );
}
export function createAdminUserRouter({ prisma }) {
  const router = Router();
  const users = createAdminUserService({ prisma });
  router.get('/', async (req, res) => res.json(await users.list(req.query)));
  router.get('/:userId', async (req, res) => {
    noQuery(req);
    res.json(
      adminUserDetailResponseSchema.parse({
        data: await users.detail(req.params.userId),
      }),
    );
  });
  router.patch('/:userId/status', async (req, res) => {
    noQuery(req);
    res.json(
      adminUserDetailResponseSchema.parse({
        data: await users.changeStatus(
          req.params.userId,
          req.body,
          auditContext(req),
        ),
      }),
    );
  });
  return router;
}
