import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ProductInventoryManager } from '../features/admin/product-inventory-manager';
import { ApiClientError } from '../lib/api/core';

const product = {
  id: '0e7b73b7-9db0-4ae0-80b5-08e4049162cf',
  name: 'Desk lamp',
  quantityOnHand: 5,
};
const actor = {
  id: 'b2ecb79a-b74a-4748-93dc-f2fc02b93b3d',
  email: 'admin@example.test',
  firstName: 'Admin',
  lastName: 'User',
};
const movement = {
  id: '7984f43d-f8fb-45a7-94d6-cdb60e278081',
  productId: product.id,
  type: 'ADJUSTMENT',
  adjustment: -2,
  quantityBefore: 5,
  quantityAfter: 3,
  orderId: null,
  reason: 'Damaged during count',
  createdAt: '2026-09-21T00:00:00.000Z',
  actor,
};
function history(rows) {
  return {
    data: rows,
    meta: {
      page: 1,
      perPage: 20,
      totalItems: rows.length,
      totalPages: rows.length ? 1 : 0,
    },
  };
}
function response(row = movement) {
  return {
    data: {
      inventory: {
        productId: product.id,
        sku: 'MHB-OPS-001',
        name: product.name,
        status: 'ACTIVE',
        quantityOnHand: row.quantityAfter,
        updatedAt: '2026-09-21T00:00:00.000Z',
      },
      movement: row,
    },
  };
}
function renderManager(auth, onChanged = vi.fn().mockResolvedValue(undefined)) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <ProductInventoryManager
        product={product}
        auth={auth}
        onChanged={onChanged}
      />
    </QueryClientProvider>,
  );
  return { onChanged };
}

describe('admin product inventory manager', () => {
  it('covers loading, empty, load-error, and retry states', async () => {
    const auth = {
      request: vi
        .fn()
        .mockRejectedValueOnce(new Error('offline'))
        .mockResolvedValueOnce(history([])),
    };
    renderManager(auth);
    expect(screen.getByRole('status')).toHaveTextContent('Loading inventory');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'could not load inventory history',
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Try inventory history again' }),
    );
    expect(
      await screen.findByText('No inventory movements yet.'),
    ).toBeVisible();
  });

  it('validates signed adjustment and reason before calling the API', async () => {
    const auth = { request: vi.fn().mockResolvedValue(history([])) };
    renderManager(auth);
    await screen.findByText('No inventory movements yet.');
    fireEvent.click(screen.getByRole('button', { name: 'Adjust stock' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Adjustment must not be zero',
    );
    fireEvent.change(screen.getByLabelText('Signed adjustment'), {
      target: { value: '-2' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Adjust stock' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Too small: expected string to have',
    );
    expect(auth.request).toHaveBeenCalledTimes(1);
  });

  it('prevents duplicate submit and renders authoritative history after success', async () => {
    let finish;
    const auth = {
      request: vi
        .fn()
        .mockResolvedValueOnce(history([]))
        .mockReturnValueOnce(new Promise((resolve) => (finish = resolve)))
        .mockResolvedValueOnce(history([movement])),
    };
    const { onChanged } = renderManager(auth);
    await screen.findByText('No inventory movements yet.');
    fireEvent.change(screen.getByLabelText('Signed adjustment'), {
      target: { value: '-2' },
    });
    fireEvent.change(screen.getByLabelText('Reason'), {
      target: { value: 'Damaged during count' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Adjust stock' }));
    expect(
      await screen.findByRole('button', { name: 'Adjusting stock...' }),
    ).toBeDisabled();
    await act(async () => finish(response()));
    await waitFor(() =>
      expect(onChanged).toHaveBeenCalledWith('Stock adjusted from 5 to 3.'),
    );
    expect(screen.getByText('Admin User')).toBeVisible();
    expect(screen.getByText('Damaged during count')).toBeVisible();
    expect(screen.getByText(/Current stock:/)).toHaveTextContent('3');
  });

  it('shows insufficient-stock conflict and retains the form for retry', async () => {
    const auth = {
      request: vi
        .fn()
        .mockResolvedValueOnce(history([]))
        .mockRejectedValueOnce(
          new ApiClientError('The adjustment would make stock negative.', {
            status: 409,
            code: 'INSUFFICIENT_STOCK',
          }),
        ),
    };
    renderManager(auth);
    await screen.findByText('No inventory movements yet.');
    fireEvent.change(screen.getByLabelText('Signed adjustment'), {
      target: { value: '-6' },
    });
    fireEvent.change(screen.getByLabelText('Reason'), {
      target: { value: 'Cycle count' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Adjust stock' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'make stock negative',
    );
    expect(screen.getByLabelText('Signed adjustment')).toHaveValue('-6');
  });
});
