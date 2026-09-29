import { createHash, timingSafeEqual } from 'node:crypto';
import {
  PRODUCT_IMAGE_FORMATS,
  PRODUCT_IMAGE_MAX_BYTES,
  UPLOAD_SIGNATURE_SECONDS,
} from '../../config/media.js';

export class MediaProviderError extends Error {
  constructor(code, message, { retryable = true, status } = {}) {
    super(message);
    this.name = 'MediaProviderError';
    this.code = code;
    this.retryable = retryable;
    this.status = status;
  }
}

function parameterString(parameters) {
  return Object.entries(parameters)
    .filter(
      ([, value]) => value !== undefined && value !== null && value !== '',
    )
    .sort(([left], [right]) => left.localeCompare(right))
    .map(
      ([key, value]) =>
        `${key}=${Array.isArray(value) ? value.join(',') : value}`,
    )
    .join('&');
}

function signature(parameters, secret) {
  return createHash('sha1')
    .update(parameterString(parameters) + secret)
    .digest('hex');
}

function sameSignature(left, right) {
  if (!/^[a-f0-9]{40}$/u.test(left) || !/^[a-f0-9]{40}$/u.test(right))
    return false;
  return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}

function publicIdPath(publicId) {
  return publicId.split('/').map(encodeURIComponent).join('/');
}

async function providerJson(fetchImpl, url, options, operation) {
  let response;
  try {
    response = await fetchImpl(url, options);
  } catch {
    throw new MediaProviderError(
      'CLOUDINARY_UNAVAILABLE',
      `${operation} could not reach Cloudinary.`,
    );
  }
  let body;
  try {
    body = await response.json();
  } catch {
    throw new MediaProviderError(
      'CLOUDINARY_INVALID_RESPONSE',
      `${operation} received an invalid Cloudinary response.`,
    );
  }
  if (!response.ok)
    throw new MediaProviderError(
      response.status === 404 ? 'CLOUDINARY_NOT_FOUND' : 'CLOUDINARY_ERROR',
      `${operation} failed at Cloudinary.`,
      {
        retryable: response.status === 404 || response.status >= 500,
        status: response.status,
      },
    );
  return body;
}

export function createCloudinaryAdapter({ config, fetchImpl = fetch }) {
  const baseUploadUrl = `https://api.cloudinary.com/v1_1/${config.cloudName}/image`;
  const folderFor = (ownerPath) => 'marthub/' + ownerPath;
  const uploadParameters = (ownerPath, publicId, timestamp) => ({
    allowed_formats: PRODUCT_IMAGE_FORMATS.join(','),
    folder: folderFor(ownerPath),
    max_file_size: PRODUCT_IMAGE_MAX_BYTES,
    public_id: publicId,
    timestamp,
  });

  return {
    createUploadContract(productId, publicId, now = new Date()) {
      const timestamp = Math.floor(now.getTime() / 1000);
      const parameters = uploadParameters(
        'products/' + productId,
        publicId,
        timestamp,
      );
      return {
        cloudName: config.cloudName,
        apiKey: config.apiKey,
        uploadUrl: `${baseUploadUrl}/upload`,
        expiresAt: new Date(
          (timestamp + UPLOAD_SIGNATURE_SECONDS) * 1000,
        ).toISOString(),
        parameters: {
          ...parameters,
          signature: signature(parameters, config.apiSecret),
        },
      };
    },

    verifyUploadContract(
      productId,
      publicId,
      timestamp,
      suppliedSignature,
      now = new Date(),
    ) {
      const nowSeconds = Math.floor(now.getTime() / 1000);
      if (
        timestamp > nowSeconds + 30 ||
        nowSeconds >= timestamp + UPLOAD_SIGNATURE_SECONDS
      )
        return false;
      const expected = signature(
        uploadParameters('products/' + productId, publicId, timestamp),
        config.apiSecret,
      );
      return sameSignature(expected, suppliedSignature);
    },

    createPromotionUploadContract(promotionId, publicId, now = new Date()) {
      const timestamp = Math.floor(now.getTime() / 1000);
      const parameters = uploadParameters(
        'promotions/' + promotionId,
        publicId,
        timestamp,
      );
      return {
        cloudName: config.cloudName,
        apiKey: config.apiKey,
        uploadUrl: baseUploadUrl + '/upload',
        expiresAt: new Date(
          (timestamp + UPLOAD_SIGNATURE_SECONDS) * 1000,
        ).toISOString(),
        parameters: {
          ...parameters,
          signature: signature(parameters, config.apiSecret),
        },
      };
    },

    verifyPromotionUploadContract(
      promotionId,
      publicId,
      timestamp,
      suppliedSignature,
      now = new Date(),
    ) {
      const nowSeconds = Math.floor(now.getTime() / 1000);
      if (
        timestamp > nowSeconds + 30 ||
        nowSeconds >= timestamp + UPLOAD_SIGNATURE_SECONDS
      )
        return false;
      const expected = signature(
        uploadParameters('promotions/' + promotionId, publicId, timestamp),
        config.apiSecret,
      );
      return sameSignature(expected, suppliedSignature);
    },
    async inspect(publicId) {
      return providerJson(
        fetchImpl,
        `https://api.cloudinary.com/v1_1/${config.cloudName}/resources/image/upload/${publicIdPath(publicId)}`,
        {
          headers: {
            Authorization: `Basic ${Buffer.from(`${config.apiKey}:${config.apiSecret}`).toString('base64')}`,
          },
        },
        'Media verification',
      );
    },

    deliveryUrl(publicId) {
      return `https://res.cloudinary.com/${config.cloudName}/image/upload/f_auto,q_auto,c_limit,w_1200/${publicIdPath(publicId)}`;
    },

    async destroy(publicId, now = new Date()) {
      const parameters = {
        invalidate: 'true',
        public_id: publicId,
        timestamp: Math.floor(now.getTime() / 1000),
        type: 'upload',
      };
      const form = new URLSearchParams({
        ...parameters,
        api_key: config.apiKey,
        signature: signature(parameters, config.apiSecret),
      });
      const body = await providerJson(
        fetchImpl,
        `${baseUploadUrl}/destroy`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: form,
        },
        'Media deletion',
      );
      if (!['ok', 'not found'].includes(body.result))
        throw new MediaProviderError(
          'CLOUDINARY_DELETE_REJECTED',
          'Cloudinary did not confirm media deletion.',
        );
      return { alreadyMissing: body.result === 'not found' };
    },
  };
}
