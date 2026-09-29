import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CategoryManager } from '../features/admin/category-manager';
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

const root = {
  id: '37578ca4-f54b-4d06-9d46-09e0907e5751',
  parentId: null,
  name: 'Home',
  slug: 'home',
  description: 'Home essentials',
  status: 'ACTIVE',
  sortOrder: 10,
  archivedAt: null,
  parent: null,
  childCount: 0,
  productCount: 2,
};
const other = {
  ...root,
  id: '0e7b73b7-9db0-4ae0-80b5-08e4049162cf',
  name: 'Kitchen',
  slug: 'kitchen',
  sortOrder: 20,
  productCount: 0,
};

function renderManager() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <CategoryManager />
    </QueryClientProvider>,
  );
}

describe('admin category manager', () => {
  beforeEach(() => mocks.request.mockReset());

  it('covers empty state, validation, and category creation', async () => {
    let rows = [];
    mocks.request.mockImplementation(async (path, options = {}) => {
      if (options.method === 'POST') {
        const created = {
          ...root,
          name: options.body.name,
          slug: options.body.slug,
          sortOrder: options.body.sortOrder,
        };
        rows = [created];
        return { data: created };
      }
      return { data: rows };
    });
    renderManager();

    expect(await screen.findByText('No categories yet.')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Create category' }));
    expect(await screen.findAllByRole('alert')).not.toHaveLength(0);
    expect(mocks.request).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByLabelText('Category name'), {
      target: { value: 'Home' },
    });
    fireEvent.change(screen.getByLabelText('URL slug'), {
      target: { value: 'home' },
    });
    fireEvent.change(screen.getByLabelText('Display order'), {
      target: { value: '4' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create category' }));

    expect(await screen.findByText('Home was created.')).toBeVisible();
    expect(screen.getByRole('rowheader', { name: /Home/ })).toBeVisible();
    expect(mocks.request).toHaveBeenCalledWith(
      '/admin/categories',
      expect.objectContaining({
        method: 'POST',
        body: expect.objectContaining({
          name: 'Home',
          slug: 'home',
          sortOrder: 4,
        }),
      }),
    );
  });

  it('edits ordering with an immutable slug and confirms archive', async () => {
    let rows = [root, other];
    mocks.request.mockImplementation(async (path, options = {}) => {
      if (options.method === 'PATCH') {
        rows = rows.map((category) =>
          path.endsWith(category.id)
            ? { ...category, ...options.body }
            : category,
        );
        return { data: rows.find((category) => path.endsWith(category.id)) };
      }
      if (path?.endsWith('/archive')) {
        rows = rows.map((category) =>
          path.includes(category.id)
            ? {
                ...category,
                status: 'ARCHIVED',
                archivedAt: '2026-09-20T00:00:00.000Z',
              }
            : category,
        );
        return {
          data: rows.find((category) => path.includes(category.id)),
        };
      }
      return { data: rows };
    });
    renderManager();

    await screen.findByRole('rowheader', { name: /Kitchen/ });
    fireEvent.click(screen.getByRole('button', { name: 'Edit Kitchen' }));
    expect(screen.getByLabelText('URL slug')).toHaveAttribute('readonly');
    fireEvent.change(screen.getByLabelText('Category name'), {
      target: { value: 'Kitchen and dining' },
    });
    fireEvent.change(screen.getByLabelText('Display order'), {
      target: { value: '2' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save category' }));
    expect(
      await screen.findByText('Kitchen and dining was updated.'),
    ).toBeVisible();
    expect(
      screen.getByRole('rowheader', { name: /Kitchen and dining/ }),
    ).toBeVisible();

    fireEvent.click(
      screen.getByRole('button', { name: 'Archive Kitchen and dining' }),
    );
    expect(screen.getByText('Archive Kitchen and dining?')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm archive' }));
    expect(
      await screen.findByText('Kitchen and dining was archived.'),
    ).toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'Archive Kitchen and dining' }),
    ).not.toBeInTheDocument();
  });

  it('prevents duplicate submission while category creation is pending', async () => {
    let finish;
    mocks.request.mockImplementation((path, options = {}) => {
      if (options.method === 'POST')
        return new Promise((resolve) => {
          finish = resolve;
        });
      return Promise.resolve({ data: [] });
    });
    renderManager();
    await screen.findByText('No categories yet.');

    fireEvent.change(screen.getByLabelText('Category name'), {
      target: { value: 'Office' },
    });
    fireEvent.change(screen.getByLabelText('URL slug'), {
      target: { value: 'office' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create category' }));

    const pending = await screen.findByRole('button', { name: 'Saving…' });
    expect(pending).toBeDisabled();
    fireEvent.click(pending);
    expect(mocks.request).toHaveBeenCalledTimes(2);

    await act(async () => finish({ data: { ...other, name: 'Office' } }));
    expect(await screen.findByText('Office was created.')).toBeVisible();
  });
  it('shows slug conflicts and retries a failed category list', async () => {
    mocks.request
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ data: [root] })
      .mockRejectedValueOnce(
        new ApiClientError('A category already uses this slug.', {
          status: 409,
          code: 'SLUG_CONFLICT',
        }),
      );
    renderManager();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'could not load categories',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByRole('rowheader', { name: /Home/ });

    fireEvent.change(screen.getByLabelText('Category name'), {
      target: { value: 'Duplicate' },
    });
    fireEvent.change(screen.getByLabelText('URL slug'), {
      target: { value: 'home' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create category' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'already uses this slug',
    );
    await waitFor(() => expect(mocks.request).toHaveBeenCalledTimes(3));
  });
});
