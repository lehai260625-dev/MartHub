import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProductManager } from '../features/admin/product-manager';
import { ApiClientError } from '../lib/api/core';

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  user: {
    id: 'b2ecb79a-b74a-4748-93dc-f2fc02b93b3d',
    email: 'admin@example.test',
    firstName: 'Admin',
    lastName: 'User',
    role: 'ADMIN',
    status: 'ACTIVE',
  },
}));
vi.mock('../features/auth/auth-provider', () => ({ useAuth: () => mocks }));

const category = {
  id: '37578ca4-f54b-4d06-9d46-09e0907e5751',
  parentId: null,
  name: 'Home',
  slug: 'home',
  description: null,
  status: 'ACTIVE',
  sortOrder: 0,
  archivedAt: null,
  parent: null,
  childCount: 0,
  productCount: 0,
};
const product = {
  id: '0e7b73b7-9db0-4ae0-80b5-08e4049162cf',
  categoryId: category.id,
  sku: 'MHB-OPS-001',
  name: 'Desk lamp',
  slug: 'desk-lamp',
  shortDescription: 'A focused desk light.',
  description: 'Warm focused light for a work surface.',
  brand: 'MartHub Studio',
  sellingUnit: 'each',
  status: 'DRAFT',
  isFeatured: false,
  isNew: true,
  isPopular: false,
  publishedAt: null,
  archivedAt: null,
  category: {
    id: category.id,
    name: category.name,
    slug: category.slug,
    status: 'ACTIVE',
  },
  price: '349000',
  compareAtPrice: '399000',
  quantityOnHand: 0,
  imageCount: 0,
};
const list = (rows) => ({
  data: rows,
  meta: {
    page: 1,
    perPage: 24,
    totalItems: rows.length,
    totalPages: rows.length ? 1 : 0,
  },
});

function renderManager() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ProductManager />
    </QueryClientProvider>,
  );
}
function fillCreate() {
  fireEvent.change(screen.getByLabelText('Product name'), {
    target: { value: 'Desk lamp' },
  });
  fireEvent.change(screen.getByLabelText('SKU'), {
    target: { value: 'MHB-OPS-001' },
  });
  fireEvent.change(screen.getByLabelText('URL slug'), {
    target: { value: 'desk-lamp' },
  });
  fireEvent.change(screen.getByLabelText('Price (VND)'), {
    target: { value: '349000' },
  });
  fireEvent.change(screen.getByLabelText('Compare price (VND)'), {
    target: { value: '399000' },
  });
}

describe('admin product manager', () => {
  beforeEach(() => mocks.request.mockReset());

  it('covers empty state, validation, and exact-price draft creation', async () => {
    let rows = [];
    mocks.request.mockImplementation(async (path, options = {}) => {
      if (path === '/admin/categories') return { data: [category] };
      if (options.method === 'POST' && path === '/admin/products') {
        rows = [{ ...product, ...options.body, category: product.category }];
        return { data: rows[0] };
      }
      return list(rows);
    });
    renderManager();
    expect(await screen.findByText('No products found.')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Create draft' }));
    expect(await screen.findAllByRole('alert')).not.toHaveLength(0);
    fillCreate();
    fireEvent.click(screen.getByRole('button', { name: 'Create draft' }));
    expect(
      await screen.findByText('Desk lamp was created as a draft.'),
    ).toBeVisible();
    expect(screen.getByRole('rowheader', { name: /Desk lamp/ })).toBeVisible();
    expect(mocks.request).toHaveBeenCalledWith(
      '/admin/products',
      expect.objectContaining({
        method: 'POST',
        body: expect.objectContaining({
          price: '349000',
          compareAtPrice: '399000',
        }),
      }),
    );
  });

  it('edits catalog fields with immutable identity and publishes a draft', async () => {
    let rows = [product];
    mocks.request.mockImplementation(async (path, options = {}) => {
      if (path === '/admin/categories') return { data: [category] };
      if (options.method === 'PATCH') {
        rows = rows.map((row) => ({ ...row, ...options.body }));
        return { data: rows[0] };
      }
      if (path?.endsWith('/publish')) {
        rows = rows.map((row) => ({
          ...row,
          status: 'ACTIVE',
          publishedAt: '2026-09-20T00:00:00.000Z',
        }));
        return { data: rows[0] };
      }
      return list(rows);
    });
    renderManager();
    await screen.findByRole('rowheader', { name: /Desk lamp/ });
    fireEvent.click(screen.getByRole('button', { name: 'Edit Desk lamp' }));
    expect(screen.getByLabelText('SKU')).toHaveAttribute('readonly');
    expect(screen.getByLabelText('URL slug')).toHaveAttribute('readonly');
    expect(screen.getByLabelText('Price (VND)')).toHaveAttribute('readonly');
    fireEvent.change(screen.getByLabelText('Product name'), {
      target: { value: 'Focused desk lamp' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save product' }));
    expect(
      await screen.findByText('Focused desk lamp was updated.'),
    ).toBeVisible();
    fireEvent.click(
      screen.getByRole('button', { name: 'Publish Focused desk lamp' }),
    );
    expect(
      await screen.findByText('Focused desk lamp was published.'),
    ).toBeVisible();
    expect(screen.getAllByText('Active').at(-1)).toBeVisible();
  });

  it('confirms archive and prevents duplicate pending creation', async () => {
    let finish;
    let rows = [product];
    mocks.request.mockImplementation((path, options = {}) => {
      if (path === '/admin/categories')
        return Promise.resolve({ data: [category] });
      if (path?.endsWith('/archive')) {
        rows = rows.map((row) => ({
          ...row,
          status: 'ARCHIVED',
          archivedAt: '2026-09-20T00:00:00.000Z',
        }));
        return Promise.resolve({ data: rows[0] });
      }
      if (options.method === 'POST')
        return new Promise((resolve) => {
          finish = resolve;
        });
      return Promise.resolve(list(rows));
    });
    renderManager();
    await screen.findByRole('rowheader', { name: /Desk lamp/ });
    fireEvent.click(screen.getByRole('button', { name: 'Archive Desk lamp' }));
    expect(screen.getByText('Archive Desk lamp?')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm archive' }));
    expect(await screen.findByText('Desk lamp was archived.')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'New product' }));
    fillCreate();
    fireEvent.click(screen.getByRole('button', { name: 'Create draft' }));
    const pending = await screen.findByRole('button', { name: 'Saving...' });
    expect(pending).toBeDisabled();
    fireEvent.click(pending);
    const createCalls = mocks.request.mock.calls.filter(
      ([path, options]) =>
        path === '/admin/products' && options?.method === 'POST',
    );
    expect(createCalls).toHaveLength(1);
    await act(async () => finish({ data: product }));
  });

  it('retries loading and reports a SKU conflict', async () => {
    mocks.request.mockImplementation((path, options = {}) => {
      if (path === '/admin/categories')
        return Promise.resolve({ data: [category] });
      if (options.method === 'POST')
        return Promise.reject(
          new ApiClientError('A product already uses this SKU.', {
            status: 409,
            code: 'SKU_CONFLICT',
          }),
        );
      if (path?.startsWith('/admin/products?')) {
        const calls = mocks.request.mock.calls.filter(([value]) =>
          value?.startsWith('/admin/products?'),
        ).length;
        return calls === 1
          ? Promise.reject(new Error('offline'))
          : Promise.resolve(list([]));
      }
      return Promise.resolve(list([]));
    });
    renderManager();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'could not load product management',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByText('No products found.');
    fillCreate();
    fireEvent.click(screen.getByRole('button', { name: 'Create draft' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'already uses this SKU',
    );
    await waitFor(() => expect(mocks.request).toHaveBeenCalled());
  });
});
