'use client';

import { useState } from 'react';
import {
  adminMediaCleanupResponseSchema,
  adminMediaSignatureResponseSchema,
  adminProductImageResponseSchema,
} from '@marthub/contracts';

const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
const maxBytes = 4 * 1024 * 1024;

export function ProductImageManager({ product, auth, onChanged }) {
  const images = product.images ?? [];
  const [file, setFile] = useState(null);
  const [altText, setAltText] = useState('');
  const [sortOrder, setSortOrder] = useState(images.length);
  const [isPrimary, setIsPrimary] = useState(images.length === 0);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');

  const upload = async (event) => {
    event.preventDefault();
    setMessage('');
    if (!file) return setMessage('Choose an image to upload.');
    if (!allowedTypes.has(file.type))
      return setMessage('Use a JPEG, PNG, or WebP image.');
    if (file.size > maxBytes)
      return setMessage('Image size must not exceed 4 MB.');
    if (!altText.trim()) return setMessage('Describe the image for customers.');
    setPending(true);
    try {
      const signed = await auth.request(
        `/admin/products/${product.id}/images/signature`,
        {
          method: 'POST',
          schema: adminMediaSignatureResponseSchema,
        },
      );
      if (Date.now() >= Date.parse(signed.data.expiresAt))
        throw new Error('The upload signature expired. Try again.');
      const form = new FormData();
      form.append('file', file);
      form.append('api_key', signed.data.apiKey);
      for (const [key, value] of Object.entries(signed.data.parameters))
        form.append(key, String(value));
      const response = await fetch(signed.data.uploadUrl, {
        method: 'POST',
        body: form,
      });
      const provider = await response.json().catch(() => null);
      if (
        !response.ok ||
        provider?.public_id !== signed.data.parameters.public_id
      )
        throw new Error('Cloudinary could not complete the upload.');
      await auth.request(`/admin/products/${product.id}/images`, {
        method: 'POST',
        body: {
          publicId: signed.data.parameters.public_id,
          uploadTimestamp: signed.data.parameters.timestamp,
          uploadSignature: signed.data.parameters.signature,
          altText: altText.trim(),
          sortOrder,
          isPrimary,
        },
        schema: adminProductImageResponseSchema,
      });
      setFile(null);
      setAltText('');
      setSortOrder(images.length + 1);
      setIsPrimary(false);
      await onChanged('Image uploaded and verified.');
    } catch (error) {
      setMessage(error.message || 'The image could not be uploaded.');
    } finally {
      setPending(false);
    }
  };

  return (
    <div
      className="mt-8 border-t border-neutral-200 pt-6"
      aria-labelledby="product-images-title"
    >
      <h3 id="product-images-title" className="text-lg font-semibold">
        Product images
      </h3>
      <p className="mt-2 text-sm text-neutral-600">
        JPEG, PNG, or WebP. Maximum 4 MB. Images are delivered in an optimized
        responsive format.
      </p>
      {images.length === 0 ? (
        <p className="mt-4 rounded-md border border-dashed border-neutral-300 p-4">
          No images attached.
        </p>
      ) : (
        <ul className="mt-4 space-y-4">
          {images.map((image) => (
            <ImageEditor
              key={image.id}
              image={image}
              product={product}
              auth={auth}
              disabled={pending}
              onChanged={onChanged}
            />
          ))}
        </ul>
      )}
      <form className="mt-6 space-y-4" onSubmit={upload} noValidate>
        <div>
          <label className="block font-medium" htmlFor="product-image-file">
            Image file
          </label>
          <input
            id="product-image-file"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="mt-2 block w-full text-sm"
            disabled={pending}
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
        </div>
        <div>
          <label className="block font-medium" htmlFor="product-image-alt">
            Alternative text
          </label>
          <input
            id="product-image-alt"
            className="form-input mt-2"
            maxLength={180}
            value={altText}
            disabled={pending}
            onChange={(event) => setAltText(event.target.value)}
          />
        </div>
        <div>
          <label className="block font-medium" htmlFor="product-image-order">
            Display order
          </label>
          <input
            id="product-image-order"
            className="form-input mt-2"
            type="number"
            min={0}
            max={1000000}
            value={sortOrder}
            disabled={pending}
            onChange={(event) => setSortOrder(Number(event.target.value))}
          />
        </div>
        <label className="flex min-h-11 items-center gap-3">
          <input
            type="checkbox"
            checked={isPrimary}
            disabled={pending}
            onChange={(event) => setIsPrimary(event.target.checked)}
          />{' '}
          Primary image
        </label>
        <button className="button-secondary" disabled={pending}>
          {pending ? 'Uploading...' : 'Upload image'}
        </button>
      </form>
      <p
        className="mt-3 min-h-6 text-sm text-red-800"
        role={message ? 'alert' : undefined}
      >
        {message}
      </p>
    </div>
  );
}

function ImageEditor({ image, product, auth, disabled, onChanged }) {
  const [altText, setAltText] = useState(image.altText);
  const [sortOrder, setSortOrder] = useState(image.sortOrder);
  const [isPrimary, setIsPrimary] = useState(image.isPrimary);
  const [pending, setPending] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState('');

  const save = async () => {
    setPending(true);
    setMessage('');
    try {
      await auth.request(`/admin/products/${product.id}/images/${image.id}`, {
        method: 'PATCH',
        body: { altText, sortOrder, isPrimary },
        schema: adminProductImageResponseSchema,
      });
      await onChanged('Image details updated.');
    } catch (error) {
      setMessage(error.message || 'The image could not be updated.');
    } finally {
      setPending(false);
    }
  };
  const remove = async () => {
    setPending(true);
    setMessage('');
    try {
      const result = await auth.request(
        `/admin/products/${product.id}/images/${image.id}`,
        {
          method: 'DELETE',
          schema: adminMediaCleanupResponseSchema,
        },
      );
      setConfirming(false);
      await onChanged(
        result.data.status === 'COMPLETED'
          ? 'Image removed from MartHub and Cloudinary.'
          : 'Image removed from MartHub. Cloudinary cleanup is pending.',
      );
    } catch (error) {
      setMessage(error.message || 'The image could not be removed.');
    } finally {
      setPending(false);
    }
  };

  return (
    <li className="rounded-md border border-neutral-300 p-4">
      <div className="grid gap-4 sm:grid-cols-[7rem_minmax(0,1fr)]">
        {/* The server supplies an optimized Cloudinary delivery URL. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={image.url}
          alt={image.altText}
          className="aspect-square w-28 rounded-md bg-neutral-100 object-contain"
        />
        <div className="space-y-3">
          <div>
            <label
              className="block text-sm font-medium"
              htmlFor={`image-alt-${image.id}`}
            >
              Alternative text
            </label>
            <input
              id={`image-alt-${image.id}`}
              className="form-input mt-1"
              maxLength={180}
              value={altText}
              disabled={pending || disabled}
              onChange={(event) => setAltText(event.target.value)}
            />
          </div>
          <div>
            <label
              className="block text-sm font-medium"
              htmlFor={`image-order-${image.id}`}
            >
              Display order
            </label>
            <input
              id={`image-order-${image.id}`}
              className="form-input mt-1"
              type="number"
              min={0}
              max={1000000}
              value={sortOrder}
              disabled={pending || disabled}
              onChange={(event) => setSortOrder(Number(event.target.value))}
            />
          </div>
          <label className="flex min-h-11 items-center gap-3">
            <input
              type="checkbox"
              checked={isPrimary}
              disabled={pending || disabled}
              onChange={(event) => setIsPrimary(event.target.checked)}
            />{' '}
            Primary image
          </label>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              className="button-secondary"
              disabled={pending || disabled || !altText.trim()}
              onClick={save}
            >
              {pending ? 'Working...' : 'Save image'}
            </button>
            {confirming ? (
              <>
                <span className="self-center">Remove this image?</span>
                <button
                  type="button"
                  className="inline-flex min-h-11 items-center font-semibold text-red-800 underline"
                  disabled={pending || disabled}
                  onClick={remove}
                >
                  Confirm removal
                </button>
                <button
                  type="button"
                  className="inline-flex min-h-11 items-center font-semibold underline"
                  disabled={pending || disabled}
                  onClick={() => setConfirming(false)}
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                type="button"
                className="inline-flex min-h-11 items-center font-semibold text-red-800 underline"
                disabled={pending || disabled}
                onClick={() => setConfirming(true)}
              >
                Remove image
              </button>
            )}
          </div>
          <p
            className="min-h-5 text-sm text-red-800"
            role={message ? 'alert' : undefined}
          >
            {message}
          </p>
        </div>
      </div>
    </li>
  );
}
