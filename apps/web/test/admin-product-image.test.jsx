import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProductImageManager } from '../features/admin/product-image-manager';

const product = {
  id: '0e7b73b7-9db0-4ae0-80b5-08e4049162cf',
  name: 'Desk lamp',
  images: [],
};
const image = {
  id: '37578ca4-f54b-4d06-9d46-09e0907e5751',
  url: 'https://res.cloudinary.com/marthub/image/upload/f_auto,q_auto,c_limit,w_1200/item',
  altText: 'Desk lamp front view',
  width: 1200,
  height: 900,
  sortOrder: 0,
  isPrimary: true,
};
const signed = {
  data: {
    cloudName: 'marthub-test',
    apiKey: '123',
    uploadUrl: 'https://api.cloudinary.com/v1_1/marthub-test/image/upload',
    expiresAt: new Date(Date.now() + 300_000).toISOString(),
    parameters: {
      allowed_formats: 'jpg,png,webp',
      folder: `marthub/products/${product.id}`,
      max_file_size: 4_194_304,
      public_id: `marthub/products/${product.id}/signed-asset`,
      timestamp: Math.floor(Date.now() / 1000),
      signature: 'a'.repeat(40),
    },
  },
};
function renderManager(overrides = {}) {
  const auth = { request: vi.fn() };
  const onChanged = vi.fn().mockResolvedValue(undefined);
  render(
    <ProductImageManager
      product={{ ...product, ...overrides }}
      auth={auth}
      onChanged={onChanged}
    />,
  );
  return { auth, onChanged };
}

describe('admin product image manager', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it('validates required file, supported format, size, and alt text before signing', async () => {
    const { auth } = renderManager();
    fireEvent.click(screen.getByRole('button', { name: 'Upload image' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Choose an image',
    );
    fireEvent.change(screen.getByLabelText('Image file'), {
      target: { files: [new File(['gif'], 'item.gif', { type: 'image/gif' })] },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Upload image' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'JPEG, PNG, or WebP',
    );
    const tooLarge = new File(['x'], 'large.jpg', { type: 'image/jpeg' });
    Object.defineProperty(tooLarge, 'size', { value: 4_194_305 });
    fireEvent.change(screen.getByLabelText('Image file'), {
      target: { files: [tooLarge] },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Upload image' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'must not exceed 4 MB',
    );
    expect(auth.request).not.toHaveBeenCalled();
  });

  it('uploads with the restricted contract and registers only server-verifiable fields', async () => {
    const { auth, onChanged } = renderManager();
    let finishRegistration;
    auth.request.mockResolvedValueOnce(signed).mockReturnValueOnce(
      new Promise((resolve) => {
        finishRegistration = resolve;
      }),
    );
    fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ public_id: signed.data.parameters.public_id }),
    });
    fireEvent.change(screen.getByLabelText('Image file'), {
      target: {
        files: [new File(['jpeg'], 'item.jpg', { type: 'image/jpeg' })],
      },
    });
    fireEvent.change(screen.getByLabelText('Alternative text'), {
      target: { value: 'Desk lamp on a table' },
    });
    fireEvent.change(screen.getByLabelText('Display order'), {
      target: { value: '2' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Upload image' }));
    expect(
      await screen.findByRole('button', { name: 'Uploading...' }),
    ).toBeDisabled();
    await act(async () => finishRegistration({ data: image }));
    await waitFor(() =>
      expect(onChanged).toHaveBeenCalledWith('Image uploaded and verified.'),
    );
    const form = fetch.mock.calls[0][1].body;
    expect(form.get('public_id')).toBe(signed.data.parameters.public_id);
    expect(form.get('signature')).toBe(signed.data.parameters.signature);
    expect(auth.request).toHaveBeenLastCalledWith(
      `/admin/products/${product.id}/images`,
      expect.objectContaining({
        method: 'POST',
        body: {
          publicId: signed.data.parameters.public_id,
          uploadTimestamp: signed.data.parameters.timestamp,
          uploadSignature: signed.data.parameters.signature,
          altText: 'Desk lamp on a table',
          sortOrder: 2,
          isPrimary: true,
        },
      }),
    );
  });

  it('shows provider upload failures and permits a retry', async () => {
    const { auth } = renderManager();
    auth.request.mockResolvedValue(signed);
    fetch.mockResolvedValue({
      ok: false,
      json: async () => ({ error: { message: 'unsafe detail' } }),
    });
    fireEvent.change(screen.getByLabelText('Image file'), {
      target: { files: [new File(['png'], 'item.png', { type: 'image/png' })] },
    });
    fireEvent.change(screen.getByLabelText('Alternative text'), {
      target: { value: 'Desk lamp' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Upload image' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Cloudinary could not complete',
    );
    expect(screen.getByRole('button', { name: 'Upload image' })).toBeEnabled();
  });

  it('updates order, primary and alt text, then confirms removal with pending cleanup', async () => {
    const { auth, onChanged } = renderManager({ images: [image] });
    auth.request
      .mockResolvedValueOnce({ data: { ...image, sortOrder: 3 } })
      .mockResolvedValueOnce({
        data: { imageId: image.id, status: 'PENDING', attemptCount: 1 },
      });
    fireEvent.change(screen.getAllByLabelText('Alternative text')[0], {
      target: { value: 'Updated lamp view' },
    });
    fireEvent.change(screen.getAllByLabelText('Display order')[0], {
      target: { value: '3' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save image' }));
    await waitFor(() =>
      expect(auth.request).toHaveBeenCalledWith(
        `/admin/products/${product.id}/images/${image.id}`,
        expect.objectContaining({
          method: 'PATCH',
          body: { altText: 'Updated lamp view', sortOrder: 3, isPrimary: true },
        }),
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Remove image' }));
    expect(screen.getByText('Remove this image?')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm removal' }));
    await waitFor(() =>
      expect(onChanged).toHaveBeenLastCalledWith(
        'Image removed from MartHub. Cloudinary cleanup is pending.',
      ),
    );
  });
});
