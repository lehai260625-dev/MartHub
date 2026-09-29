import { Router } from 'express';
import {
  addressListResponseSchema,
  addressResponseSchema,
} from '@marthub/contracts';
import { ApiError } from '../../middleware/platform.js';
import { createAddressService } from './service.js';

export function createAddressesRouter({ prisma }) {
  const router = Router();
  const addresses = createAddressService({ prisma });

  router.get('/', async (req, res) => {
    res.json(
      addressListResponseSchema.parse({ data: await addresses.list(req.auth) }),
    );
  });
  router.post('/', async (req, res) => {
    const address = await addresses.create(req.auth, req.body);
    res.status(201).json(addressResponseSchema.parse({ data: address }));
  });
  router.patch('/:addressId', async (req, res) => {
    const address = await addresses.update(
      req.auth,
      req.params.addressId,
      req.body,
    );
    res.json(addressResponseSchema.parse({ data: address }));
  });
  router.delete('/:addressId', async (req, res) => {
    await addresses.remove(req.auth, req.params.addressId);
    res.status(204).end();
  });
  router.put('/:addressId/default', async (req, res) => {
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
    const address = await addresses.makeDefault(req.auth, req.params.addressId);
    res.json(addressResponseSchema.parse({ data: address }));
  });
  return router;
}
