import { Router } from 'express';
import {
  adminCategoryListResponseSchema,
  adminCategoryResponseSchema,
} from '@marthub/contracts';
import { ApiError } from '../../middleware/platform.js';
import { auditContext } from './audit.js';
import { createAdminCategoryService } from './categories.js';

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

export function createAdminCategoryRouter({ prisma }) {
  const router = Router();
  const categories = createAdminCategoryService({ prisma });

  router.get('/', async (req, res) => {
    noQuery(req);
    res.json(
      adminCategoryListResponseSchema.parse({
        data: await categories.list(),
      }),
    );
  });

  router.post('/', async (req, res) => {
    noQuery(req);
    res.status(201).json(
      adminCategoryResponseSchema.parse({
        data: await categories.create(req.body, auditContext(req)),
      }),
    );
  });

  router.get('/:categoryId', async (req, res) => {
    noQuery(req);
    res.json(
      adminCategoryResponseSchema.parse({
        data: await categories.get(req.params.categoryId),
      }),
    );
  });

  router.patch('/:categoryId', async (req, res) => {
    noQuery(req);
    res.json(
      adminCategoryResponseSchema.parse({
        data: await categories.update(
          req.params.categoryId,
          req.body,
          auditContext(req),
        ),
      }),
    );
  });

  router.post('/:categoryId/archive', async (req, res) => {
    noQuery(req);
    noBody(req);
    res.json(
      adminCategoryResponseSchema.parse({
        data: await categories.archive(
          req.params.categoryId,
          auditContext(req),
        ),
      }),
    );
  });

  return router;
}
