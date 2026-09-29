import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PRODUCT_IMAGE_MAX_BYTES,
  readMediaConfig,
} from '../src/config/media.js';
import {
  createCloudinaryAdapter,
  MediaProviderError,
} from '../src/modules/media/cloudinary.js';

const config = {
  cloudName: 'marthub-test',
  apiKey: '123456789',
  apiSecret: 'test-secret-value-123',
};
const productId = 'b2ecb79a-b74a-4748-93dc-f2fc02b93b3d';

test('media configuration requires server-only Cloudinary credentials', () => {
  assert.deepEqual(
    readMediaConfig({
      CLOUDINARY_CLOUD_NAME: config.cloudName,
      CLOUDINARY_API_KEY: config.apiKey,
      CLOUDINARY_API_SECRET: config.apiSecret,
    }),
    config,
  );
  for (const input of [
    {},
    {
      CLOUDINARY_CLOUD_NAME: 'bad name',
      CLOUDINARY_API_KEY: 'key',
      CLOUDINARY_API_SECRET: config.apiSecret,
    },
  ])
    assert.throws(() => readMediaConfig(input));
});

test('signed upload contract is product-bound, constrained, secret-free, and expires in five minutes', () => {
  const media = createCloudinaryAdapter({
    config,
    fetchImpl: async () => {
      throw new Error('unused');
    },
  });
  const now = new Date('2026-09-20T00:00:00.000Z');
  const publicId = 'marthub/products/' + productId + '/signed-asset';
  const contract = media.createUploadContract(productId, publicId, now);
  assert.equal(contract.parameters.folder, `marthub/products/${productId}`);
  assert.equal(contract.parameters.allowed_formats, 'jpg,png,webp');
  assert.equal(contract.parameters.max_file_size, PRODUCT_IMAGE_MAX_BYTES);
  assert.equal(contract.expiresAt, '2026-09-20T00:05:00.000Z');
  assert.equal(JSON.stringify(contract).includes(config.apiSecret), false);
  assert.equal(
    media.verifyUploadContract(
      productId,
      publicId,
      contract.parameters.timestamp,
      contract.parameters.signature,
      new Date('2026-09-20T00:04:59.999Z'),
    ),
    true,
  );
  assert.equal(
    media.verifyUploadContract(
      productId,
      publicId,
      contract.parameters.timestamp,
      contract.parameters.signature,
      new Date('2026-09-20T00:05:00.000Z'),
    ),
    false,
  );
  assert.equal(
    media.verifyUploadContract(
      '0e7b73b7-9db0-4ae0-80b5-08e4049162cf',
      publicId,
      contract.parameters.timestamp,
      contract.parameters.signature,
      now,
    ),
    false,
  );
});

test('signed promotion upload is owner-bound, secret-free, and expires at five minutes', () => {
  const media = createCloudinaryAdapter({
    config,
    fetchImpl: async () => {
      throw new Error('unused');
    },
  });
  const now = new Date('2026-09-21T00:00:00.000Z');
  const publicId = `marthub/promotions/${productId}/hero`;
  const contract = media.createPromotionUploadContract(
    productId,
    publicId,
    now,
  );
  assert.equal(contract.parameters.folder, `marthub/promotions/${productId}`);
  assert.equal(contract.parameters.allowed_formats, 'jpg,png,webp');
  assert.equal(contract.parameters.max_file_size, PRODUCT_IMAGE_MAX_BYTES);
  assert.equal(contract.expiresAt, '2026-09-21T00:05:00.000Z');
  assert.equal(JSON.stringify(contract).includes(config.apiSecret), false);
  assert.equal(
    media.verifyPromotionUploadContract(
      productId,
      publicId,
      contract.parameters.timestamp,
      contract.parameters.signature,
      new Date('2026-09-21T00:04:59.999Z'),
    ),
    true,
  );
  assert.equal(
    media.verifyPromotionUploadContract(
      productId,
      publicId,
      contract.parameters.timestamp,
      contract.parameters.signature,
      new Date('2026-09-21T00:05:00.000Z'),
    ),
    false,
  );
});
test('adapter verifies provider metadata and builds optimized delivery URLs', async () => {
  let call;
  const media = createCloudinaryAdapter({
    config,
    fetchImpl: async (url, options) => {
      call = { url, options };
      return new Response(
        JSON.stringify({
          public_id: `marthub/products/${productId}/asset`,
          format: 'webp',
          bytes: 1200,
          width: 900,
          height: 700,
          secure_url: 'https://provider/source.webp',
        }),
        { status: 200 },
      );
    },
  });
  const publicId = `marthub/products/${productId}/asset`;
  const resource = await media.inspect(publicId);
  assert.equal(resource.bytes, 1200);
  assert.match(call.options.headers.Authorization, /^Basic /u);
  assert.equal(call.url.includes(config.apiSecret), false);
  assert.equal(
    media.deliveryUrl(publicId),
    `https://res.cloudinary.com/${config.cloudName}/image/upload/f_auto,q_auto,c_limit,w_1200/marthub/products/${productId}/asset`,
  );
});

test('adapter deletion treats missing assets as success and reports provider failures safely', async () => {
  const results = ['not found', 'ok'];
  const media = createCloudinaryAdapter({
    config,
    fetchImpl: async (url, options) => {
      assert.match(url, /\/destroy$/u);
      assert.equal(String(options.body).includes(config.apiSecret), false);
      return new Response(JSON.stringify({ result: results.shift() }), {
        status: 200,
      });
    },
  });
  assert.deepEqual(await media.destroy('marthub/products/test/missing'), {
    alreadyMissing: true,
  });
  assert.deepEqual(await media.destroy('marthub/products/test/present'), {
    alreadyMissing: false,
  });

  const failing = createCloudinaryAdapter({
    config,
    fetchImpl: async () =>
      new Response(JSON.stringify({ error: { message: 'provider detail' } }), {
        status: 503,
      }),
  });
  await assert.rejects(
    () => failing.destroy('marthub/products/test/error'),
    (error) =>
      error instanceof MediaProviderError &&
      error.code === 'CLOUDINARY_ERROR' &&
      !error.message.includes('provider detail'),
  );
});
