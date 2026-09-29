import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ProductPriceManager } from '../features/admin/product-price-manager';
import { ApiClientError } from '../lib/api/core';

const product = {
  id: '0e7b73b7-9db0-4ae0-80b5-08e4049162cf',
  name: 'Desk lamp',
};
const current = {
  id: '7984f43d-f8fb-45a7-94d6-cdb60e278081',
  productId: product.id,
  price: '9007199254741993',
  compareAtPrice: '9007199254742993',
  startsAt: '2026-09-01T00:00:00.000Z',
  endsAt: null,
  createdAt: '2026-09-01T00:00:00.000Z',
  isCurrent: true,
  createdBy: {
    id: 'b2ecb79a-b74a-4748-93dc-f2fc02b93b3d',
    email: 'admin@example.test',
    firstName: 'Admin',
    lastName: 'User',
  },
};
function renderManager(auth, onChanged = vi.fn().mockResolvedValue(undefined)) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <ProductPriceManager
        product={product}
        auth={auth}
        onChanged={onChanged}
      />
    </QueryClientProvider>,
  );
  return { onChanged };
}

describe('admin product price manager', () => {
  it('loads exact current price history and actor attribution', async () => {
    const auth = { request: vi.fn().mockResolvedValue({ data: [current] }) };
    renderManager(auth);
    expect(screen.getByRole('status')).toHaveTextContent(
      'Loading price history',
    );
    expect(
      await screen.findByText(/9\.007\.199\.254\.741\.993/u),
    ).toBeVisible();
    expect(screen.getByText('Current')).toBeVisible();
    expect(screen.getByText('Admin User')).toBeVisible();
    expect(screen.getByText('Open-ended')).toBeVisible();
  });

  it('covers empty, load-error, and retry states', async () => {
    const auth = {
      request: vi
        .fn()
        .mockRejectedValueOnce(new Error('offline'))
        .mockResolvedValueOnce({ data: [] }),
    };
    renderManager(auth);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'could not load price history',
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Try price history again' }),
    );
    expect(await screen.findByText('No price history found.')).toBeVisible();
  });

  it('validates positive and compare prices before calling the API', async () => {
    const auth = { request: vi.fn().mockResolvedValue({ data: [current] }) };
    renderManager(auth);
    await screen.findByText('Current');
    fireEvent.change(screen.getByLabelText('New price (VND)'), {
      target: { value: '0' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Schedule price' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Price must be greater than zero',
    );
    fireEvent.change(screen.getByLabelText('New price (VND)'), {
      target: { value: '350000' },
    });
    fireEvent.change(screen.getByLabelText('New compare price (VND)'), {
      target: { value: '350000' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Schedule price' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Compare price must be greater',
    );
    expect(auth.request).toHaveBeenCalledTimes(1);
  });

  it('disables duplicate scheduling, refreshes history, and reports conflicts', async () => {
    let finish;
    const successor = {
      ...current,
      id: '4386553d-3fba-4c32-86f1-3a23de90a932',
      price: '349000',
      compareAtPrice: null,
      startsAt: '2026-10-01T00:00:00.000Z',
      isCurrent: false,
    };
    const auth = {
      request: vi
        .fn()
        .mockResolvedValueOnce({ data: [current] })
        .mockReturnValueOnce(
          new Promise((resolve) => {
            finish = resolve;
          }),
        )
        .mockResolvedValueOnce({
          data: [successor, { ...current, endsAt: successor.startsAt }],
        })
        .mockRejectedValueOnce(
          new ApiClientError(
            'The requested price conflicts with the existing price timeline.',
            {
              status: 409,
              code: 'PRICE_TIMELINE_CONFLICT',
            },
          ),
        ),
    };
    const { onChanged } = renderManager(auth);
    await screen.findByText('Current');
    fireEvent.change(screen.getByLabelText('New price (VND)'), {
      target: { value: '349000' },
    });
    fireEvent.change(screen.getByLabelText('Starts at'), {
      target: { value: '2026-10-01T00:00' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Schedule price' }));
    expect(
      await screen.findByRole('button', { name: 'Scheduling price...' }),
    ).toBeDisabled();
    await act(async () => finish({ data: successor }));
    await waitFor(() =>
      expect(onChanged).toHaveBeenCalledWith(
        'Future price scheduled with history preserved.',
      ),
    );
    expect(auth.request).toHaveBeenCalledWith(
      `/admin/products/${product.id}/prices`,
      expect.objectContaining({
        method: 'POST',
        body: expect.objectContaining({
          price: '349000',
          compareAtPrice: null,
        }),
      }),
    );
    fireEvent.change(screen.getByLabelText('New price (VND)'), {
      target: { value: '359000' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Schedule price' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'conflicts with the existing price timeline',
    );
  });
});
