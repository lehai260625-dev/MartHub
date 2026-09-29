import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PromotionManager } from '../features/admin/promotion-manager';

const user = { id: 'b2ecb79a-b74a-4748-93dc-f2fc02b93b3d' };
const row = {
  id: '0e7b73b7-9db0-4ae0-80b5-08e4049162cf',
  title: 'Autumn table',
  subtitle: null,
  image: null,
  internalHref: '/category/tabletop',
  placement: 'HERO_PRIMARY',
  status: 'DRAFT',
  sortOrder: 0,
  startsAt: '2026-09-21T00:00:00.000Z',
  endsAt: '2026-10-01T00:00:00.000Z',
  archivedAt: null,
  createdAt: '2026-09-21T00:00:00.000Z',
  updatedAt: '2026-09-21T00:00:00.000Z',
  createdBy: null,
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
const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  user: { id: 'b2ecb79a-b74a-4748-93dc-f2fc02b93b3d' },
}));
vi.mock('../features/auth/auth-provider', () => ({ useAuth: () => mocks }));
function renderManager() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <PromotionManager />
    </QueryClientProvider>,
  );
}
describe('promotion manager', () => {
  beforeEach(() => mocks.request.mockReset());
  it('covers loading, empty, error, and retry', async () => {
    mocks.request
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(list([]));
    renderManager();
    expect(screen.getByRole('status')).toHaveTextContent('Loading');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'could not load',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('No promotions found.')).toBeVisible();
  });
  it('validates and creates a draft without spoofed status', async () => {
    let rows = [];
    mocks.request.mockImplementation(async (path, options = {}) => {
      if (options.method === 'POST') {
        rows = [{ ...row, ...options.body }];
        return { data: rows[0] };
      }
      return list(rows);
    });
    renderManager();
    await screen.findByText('No promotions found.');
    fireEvent.click(screen.getByRole('button', { name: 'Create draft' }));
    expect(await screen.findByRole('alert')).toBeVisible();
    for (const [label, value] of [
      ['Title', 'Autumn table'],
      ['Internal destination', '/category/tabletop'],
      ['Starts at', '2026-09-21T00:00'],
      ['Ends at', '2026-10-01T00:00'],
    ])
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
    fireEvent.click(screen.getByRole('button', { name: 'Create draft' }));
    expect(
      await screen.findByText('Autumn table was created as a draft.'),
    ).toBeVisible();
    expect(mocks.request).toHaveBeenCalledWith(
      '/admin/promotions',
      expect.objectContaining({
        method: 'POST',
        body: expect.not.objectContaining({ status: expect.anything() }),
      }),
    );
  });
  it('publishes, confirms archive, and validates promotion media locally', async () => {
    let current = row;
    mocks.request.mockImplementation(async (path, options = {}) => {
      if (path?.endsWith('/publish')) {
        current = { ...current, status: 'ACTIVE' };
        return { data: current };
      }
      if (path?.endsWith('/archive')) {
        current = {
          ...current,
          status: 'ARCHIVED',
          archivedAt: new Date().toISOString(),
        };
        return { data: current };
      }
      return list([current]);
    });
    renderManager();
    await screen.findByText('Autumn table');
    fireEvent.click(
      screen.getByRole('button', { name: 'Manage Autumn table' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Publish promotion' }));
    expect(
      await screen.findByText('Autumn table was published.'),
    ).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Archive promotion' }));
    expect(
      screen.getByRole('button', { name: 'Confirm archive' }),
    ).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Upload image' }));
    expect(await screen.findByText('Choose an image to upload.')).toBeVisible();
    await waitFor(() => expect(mocks.request).toHaveBeenCalled());
  });
});
