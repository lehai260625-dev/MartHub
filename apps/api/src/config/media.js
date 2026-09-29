export const PRODUCT_IMAGE_FORMATS = Object.freeze(['jpg', 'png', 'webp']);
export const PRODUCT_IMAGE_MAX_BYTES = 4 * 1024 * 1024;
export const UPLOAD_SIGNATURE_SECONDS = 5 * 60;
export const MEDIA_CLEANUP_MAX_ATTEMPTS = 5;

export function readMediaConfig(env = process.env) {
  const cloudName = env.CLOUDINARY_CLOUD_NAME || '';
  const apiKey = env.CLOUDINARY_API_KEY || '';
  const apiSecret = env.CLOUDINARY_API_SECRET || '';
  if (!/^[A-Za-z0-9_-]{1,128}$/u.test(cloudName))
    throw new Error(
      'CLOUDINARY_CLOUD_NAME is required and has an invalid format.',
    );
  if (!/^[A-Za-z0-9_-]{1,128}$/u.test(apiKey))
    throw new Error(
      'CLOUDINARY_API_KEY is required and has an invalid format.',
    );
  if (apiSecret.length < 16 || apiSecret.length > 256 || /\s/u.test(apiSecret))
    throw new Error(
      'CLOUDINARY_API_SECRET must contain 16-256 non-space characters.',
    );
  return { cloudName, apiKey, apiSecret };
}
