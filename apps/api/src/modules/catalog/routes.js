import { Router } from 'express';
import {
  categoryListResponseSchema,
  categoryResponseSchema,
  homepageResponseSchema,
  productListResponseSchema,
  productQuerySchema,
  productResponseSchema,
} from '@marthub/contracts';
import { ApiError } from '../../middleware/platform.js';
import { createCatalogService } from './service.js';

function noQuery(req) {
  if (Object.keys(req.query).length)
    throw new ApiError(
      422,
      'VALIDATION_ERROR',
      'This endpoint does not accept query options yet.',
    );
}

export function createCatalogRouters({ prisma }) {
  const catalog = createCatalogService({ prisma });
  const homepage = Router();
  const categories = Router();
  const products = Router();
  homepage.get('/', async (req, res) => {
    noQuery(req);
    res.set(
      'Cache-Control',
      'public, max-age=60, s-maxage=300, stale-while-revalidate=600',
    );
    res.json(
      homepageResponseSchema.parse({ data: await catalog.getHomepage() }),
    );
  });
  categories.get('/', async (req, res) => {
    noQuery(req);
    res.json(
      categoryListResponseSchema.parse({
        data: await catalog.listCategories(),
      }),
    );
  });
  categories.get('/:slug', async (req, res) => {
    noQuery(req);
    res.json(
      categoryResponseSchema.parse({
        data: await catalog.getCategory(req.params.slug),
      }),
    );
  });
  products.get('/', async (req, res) => {
    const parsed = productQuerySchema.safeParse(req.query);
    if (!parsed.success)
      throw new ApiError(
        422,
        'VALIDATION_ERROR',
        'Check the query parameters.',
        parsed.error.issues.map((issue) => ({
          field: issue.path.join('.'),
          message: issue.message,
        })),
      );
    res.json(
      productListResponseSchema.parse(await catalog.listProducts(parsed.data)),
    );
  });
  products.get('/:slug', async (req, res) => {
    noQuery(req);
    res.json(
      productResponseSchema.parse({
        data: await catalog.getProduct(req.params.slug),
      }),
    );
  });
  return { homepage, categories, products };
}
