import { Router } from 'express';
import {
  adminInventoryAdjustmentResponseSchema,
  adminInventoryListResponseSchema,
  adminInventoryMovementListResponseSchema,
} from '@marthub/contracts';
import { ApiError } from '../../middleware/platform.js';
import { auditContext } from './audit.js';
import { createAdminInventoryService } from './inventory.js';

function noQuery(req) {
  if (Object.keys(req.query).length)
    throw new ApiError(
      422,
      'VALIDATION_ERROR',
      'This endpoint does not accept query options.',
    );
}

export function createAdminInventoryRouter({ prisma }) {
  const router = Router();
  const inventory = createAdminInventoryService({ prisma });
  router.get('/', async (req, res) => {
    res.json(
      adminInventoryListResponseSchema.parse(await inventory.list(req.query)),
    );
  });
  router.get('/:productId/movements', async (req, res) => {
    res.json(
      adminInventoryMovementListResponseSchema.parse(
        await inventory.movements(req.params.productId, req.query),
      ),
    );
  });
  router.post('/:productId/adjustments', async (req, res) => {
    noQuery(req);
    res
      .status(201)
      .json(
        adminInventoryAdjustmentResponseSchema.parse(
          await inventory.adjust(
            req.params.productId,
            req.body,
            req.auth.user.id,
            auditContext(req),
          ),
        ),
      );
  });
  return router;
}
