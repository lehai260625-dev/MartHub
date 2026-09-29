import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { z } from 'zod';
import {
  adminPromotionCreateSchema,
  adminPromotionUpdateSchema,
  adminPromotionMediaRegisterSchema,
  adminPromotionResponseSchema,
  adminPromotionListResponseSchema,
  adminPromotionMediaCleanupResponseSchema,
} from '../src/admin-promotion.js';
test('promotion contracts validate placement, internal link, schedule, order, and strict fields', () => {
  const valid = {
    title: 'Autumn table',
    subtitle: null,
    internalHref: '/category/tabletop',
    placement: 'HERO_PRIMARY',
    sortOrder: 0,
    startsAt: '2026-09-21T00:00:00.000Z',
    endsAt: '2026-10-01T00:00:00.000Z',
  };
  assert.equal(adminPromotionCreateSchema.safeParse(valid).success, true);
  for (const change of [
    { placement: 'SIDE' },
    { internalHref: 'https://evil.test' },
    { internalHref: '//evil.test' },
    { endsAt: valid.startsAt },
    { sortOrder: -1 },
    { status: 'ACTIVE' },
  ])
    assert.equal(
      adminPromotionCreateSchema.safeParse({ ...valid, ...change }).success,
      false,
    );
  assert.equal(
    adminPromotionUpdateSchema.safeParse({ title: 'Updated' }).success,
    true,
  );
  assert.equal(
    adminPromotionUpdateSchema.safeParse({ imageUrl: 'https://evil.test' })
      .success,
    false,
  );
});
test('promotion media registration is dedicated and strict', () => {
  const valid = {
    publicId: 'marthub/promotions/id/asset',
    uploadTimestamp: 1790000000,
    uploadSignature: 'a'.repeat(40),
  };
  assert.equal(
    adminPromotionMediaRegisterSchema.safeParse(valid).success,
    true,
  );
  assert.equal(
    adminPromotionMediaRegisterSchema.safeParse({ ...valid, width: 1 }).success,
    false,
  );
});
test('OpenAPI promotion operations agree with shared schemas', async () => {
  const spec = JSON.parse(
    await readFile(new URL('../openapi.json', import.meta.url), 'utf8'),
  );
  for (const path of [
    '/admin/promotions',
    '/admin/promotions/{promotionId}',
    '/admin/promotions/{promotionId}/publish',
    '/admin/promotions/{promotionId}/archive',
    '/admin/promotions/{promotionId}/media/signature',
    '/admin/promotions/{promotionId}/media',
  ])
    for (const operation of Object.values(spec.paths[path]).filter(
      (x) => x?.security,
    ))
      assert.deepEqual(operation.security, [{ BearerAuth: [] }]);
  for (const [name, schema] of Object.entries({
    AdminPromotionCreate: adminPromotionCreateSchema,
    AdminPromotionUpdate: adminPromotionUpdateSchema,
    AdminPromotionMediaRegister: adminPromotionMediaRegisterSchema,
    AdminPromotionResponse: adminPromotionResponseSchema,
    AdminPromotionListResponse: adminPromotionListResponseSchema,
    AdminPromotionMediaCleanupResponse:
      adminPromotionMediaCleanupResponseSchema,
  }))
    assert.deepEqual(spec.components.schemas[name], z.toJSONSchema(schema));
});
