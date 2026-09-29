import { Router } from 'express';
import {
  adminMediaCleanupResponseSchema,
  adminMediaSignatureResponseSchema,
  adminProductImageResponseSchema,
  adminProductPriceHistoryResponseSchema,
  adminProductPriceResponseSchema,
  adminProductListResponseSchema,
  adminProductResponseSchema,
} from '@marthub/contracts';
import { ApiError } from '../../middleware/platform.js';
import { auditContext } from './audit.js';
import { createAdminProductService } from './products.js';
import { createAdminProductImageService } from './product-images.js';
import { createAdminPriceService } from './prices.js';

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

export function createAdminProductRouter({ prisma, media }) {
  const router = Router();
  const products = createAdminProductService({ prisma });
  const images = createAdminProductImageService({ prisma, media });
  const prices = createAdminPriceService({ prisma });

  router.get('/', async (req, res) => {
    res.json(
      adminProductListResponseSchema.parse(await products.list(req.query)),
    );
  });
  router.post('/', async (req, res) => {
    noQuery(req);
    res.status(201).json(
      adminProductResponseSchema.parse({
        data: await products.create(
          req.body,
          req.auth.user.id,
          auditContext(req),
        ),
      }),
    );
  });
  router.post('/:productId/images/signature', async (req, res) => {
    noQuery(req);
    noBody(req);
    res.json(
      adminMediaSignatureResponseSchema.parse({
        data: await images.signature(req.params.productId, auditContext(req)),
      }),
    );
  });
  router.post('/:productId/images', async (req, res) => {
    noQuery(req);
    res.status(201).json(
      adminProductImageResponseSchema.parse({
        data: await images.register(
          req.params.productId,
          req.body,
          auditContext(req),
        ),
      }),
    );
  });
  router.patch('/:productId/images/:imageId', async (req, res) => {
    noQuery(req);
    res.json(
      adminProductImageResponseSchema.parse({
        data: await images.update(
          req.params.productId,
          req.params.imageId,
          req.body,
          auditContext(req),
        ),
      }),
    );
  });
  router.delete('/:productId/images/:imageId', async (req, res) => {
    noQuery(req);
    noBody(req);
    const data = await images.remove(
      req.params.productId,
      req.params.imageId,
      auditContext(req),
    );
    res
      .status(data.status === 'COMPLETED' ? 200 : 202)
      .json(adminMediaCleanupResponseSchema.parse({ data }));
  });
  router.get('/:productId/prices', async (req, res) => {
    noQuery(req);
    res.json(
      adminProductPriceHistoryResponseSchema.parse(
        await prices.list(req.params.productId),
      ),
    );
  });
  router.post('/:productId/prices', async (req, res) => {
    noQuery(req);
    res
      .status(201)
      .json(
        adminProductPriceResponseSchema.parse(
          await prices.create(
            req.params.productId,
            req.body,
            req.auth.user.id,
            auditContext(req),
          ),
        ),
      );
  });
  router.get('/:productId', async (req, res) => {
    noQuery(req);
    res.json(
      adminProductResponseSchema.parse({
        data: await products.get(req.params.productId),
      }),
    );
  });
  router.patch('/:productId', async (req, res) => {
    noQuery(req);
    res.json(
      adminProductResponseSchema.parse({
        data: await products.update(
          req.params.productId,
          req.body,
          auditContext(req),
        ),
      }),
    );
  });
  router.post('/:productId/publish', async (req, res) => {
    noQuery(req);
    noBody(req);
    res.json(
      adminProductResponseSchema.parse({
        data: await products.publish(req.params.productId, auditContext(req)),
      }),
    );
  });
  router.post('/:productId/archive', async (req, res) => {
    noQuery(req);
    noBody(req);
    res.json(
      adminProductResponseSchema.parse({
        data: await products.archive(req.params.productId, auditContext(req)),
      }),
    );
  });

  return router;
}
