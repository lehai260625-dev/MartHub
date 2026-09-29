import { Router } from 'express';
import {
  adminMediaSignatureResponseSchema,
  adminPromotionListResponseSchema,
  adminPromotionMediaCleanupResponseSchema,
  adminPromotionResponseSchema,
} from '@marthub/contracts';
import { ApiError } from '../../middleware/platform.js';
import { createAdminPromotionService } from './promotions.js';

function noQuery(req) {
  if (Object.keys(req.query).length)
    throw new ApiError(
      422,
      'VALIDATION_ERROR',
      'This endpoint does not accept query options.',
    );
}
function noBody(req) {
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
export function createAdminPromotionRouter({ prisma, media }) {
  const router = Router();
  const promotions = createAdminPromotionService({ prisma, media });
  router.get('/', async (req, res) =>
    res.json(
      adminPromotionListResponseSchema.parse(await promotions.list(req.query)),
    ),
  );
  router.post('/', async (req, res) => {
    noQuery(req);
    res.status(201).json(
      adminPromotionResponseSchema.parse({
        data: await promotions.create(req.body, req.auth.user.id),
      }),
    );
  });
  router.post('/:promotionId/media/signature', async (req, res) => {
    noQuery(req);
    noBody(req);
    res.json(
      adminMediaSignatureResponseSchema.parse({
        data: await promotions.signature(req.params.promotionId),
      }),
    );
  });
  router.post('/:promotionId/media', async (req, res) => {
    noQuery(req);
    res.status(201).json(
      adminPromotionResponseSchema.parse({
        data: await promotions.register(req.params.promotionId, req.body),
      }),
    );
  });
  router.delete('/:promotionId/media', async (req, res) => {
    noQuery(req);
    noBody(req);
    const result = await promotions.removeMedia(req.params.promotionId);
    res
      .status(result.data.status === 'COMPLETED' ? 200 : 202)
      .json(adminPromotionMediaCleanupResponseSchema.parse(result));
  });
  router.get('/:promotionId', async (req, res) => {
    noQuery(req);
    res.json(
      adminPromotionResponseSchema.parse({
        data: await promotions.get(req.params.promotionId),
      }),
    );
  });
  router.patch('/:promotionId', async (req, res) => {
    noQuery(req);
    res.json(
      adminPromotionResponseSchema.parse({
        data: await promotions.update(req.params.promotionId, req.body),
      }),
    );
  });
  router.post('/:promotionId/publish', async (req, res) => {
    noQuery(req);
    noBody(req);
    res.json(
      adminPromotionResponseSchema.parse({
        data: await promotions.publish(req.params.promotionId),
      }),
    );
  });
  router.post('/:promotionId/archive', async (req, res) => {
    noQuery(req);
    noBody(req);
    res.json(
      adminPromotionResponseSchema.parse({
        data: await promotions.archive(req.params.promotionId),
      }),
    );
  });
  return router;
}
