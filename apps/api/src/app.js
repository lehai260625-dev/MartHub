import express from 'express';
import { createAuthRouter } from './modules/auth/routes.js';
import { createUsersRouter } from './modules/users/routes.js';
import { createAdminRouter } from './modules/admin/routes.js';
import { createCatalogRouters } from './modules/catalog/routes.js';
import { createCartRouter } from './modules/cart/routes.js';
import { createWishlistRouter } from './modules/wishlist/routes.js';
import { API_BASE_PATH, API_VERSION, healthSchema } from '@marthub/contracts';
import {
  ApiError,
  installPlatform,
  notFound,
  errorHandler,
} from './middleware/platform.js';

export function createApp({
  readiness = async () => {
    throw new Error('Database is not configured.');
  },
  configureRouter = () => {},
  prisma,
  authConfig,
  mediaAdapter,
  ...platform
} = {}) {
  const app = express();
  app.disable('x-powered-by');
  // Session-bearing responses, including pre-router parser/CORS failures, cannot be cached.
  app.use((req, res, next) => {
    if (/^\/api\/v1\/auth(?:\/|$)/i.test(req.path) || req.get('authorization'))
      res.set('Cache-Control', 'no-store');
    next();
  });
  installPlatform(app, platform);
  const router = express.Router();
  if (prisma && authConfig) {
    router.use('/auth', createAuthRouter({ prisma, config: authConfig }));
    router.use('/users', createUsersRouter({ prisma, config: authConfig }));
    router.use('/cart', createCartRouter({ prisma, config: authConfig }));
    router.use(
      '/wishlist',
      createWishlistRouter({ prisma, config: authConfig }),
    );
    router.use(
      '/admin',
      createAdminRouter({ prisma, config: authConfig, media: mediaAdapter }),
    );
  }
  if (prisma) {
    const catalog = createCatalogRouters({ prisma });
    router.use('/homepage', catalog.homepage);
    router.use('/categories', catalog.categories);
    router.use('/products', catalog.products);
  }
  router.get('/health/live', (req, res) => {
    res.json(
      healthSchema.parse({ data: { status: 'ok', version: API_VERSION } }),
    );
  });
  router.get('/health/ready', async (req, res) => {
    try {
      await readiness();
      res.json(
        healthSchema.parse({ data: { status: 'ready', version: API_VERSION } }),
      );
    } catch {
      throw new ApiError(503, 'SERVICE_UNAVAILABLE', 'Service is not ready.');
    }
  });
  configureRouter(router);
  app.use(API_BASE_PATH, router);
  app.use(notFound);
  app.use(errorHandler);
  return app;
}
