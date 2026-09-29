import { expect, test, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '../features/auth/auth-provider';
import { AdminShell } from '../features/admin/admin-shell';
import { createAuthSession } from '../lib/auth/session';
import { ApiClientError } from '../lib/api/core';

const navigation = vi.hoisted(() => ({
  replace: vi.fn(),
  search: '',
  pathname: '/admin',
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: navigation.replace }),
  useSearchParams: () => new URLSearchParams(navigation.search),
  usePathname: () => navigation.pathname,
}));

beforeEach(() => {
  navigation.replace.mockReset();
  navigation.search = '';
  navigation.pathname = '/admin';
});

const user = (role) => ({
  id: 'b2ecb79a-b74a-4748-93dc-f2fc02b93b3d',
  email: role.toLowerCase() + '@example.test',
  firstName: role === 'ADMIN' ? 'Admin' : 'Customer',
  lastName: 'User',
  phone: null,
  role,
  status: 'ACTIVE',
});

const sessionResponse = (role) => ({
  data: {
    user: user(role),
    accessToken: 'memory-only-test-token',
    expiresIn: 900,
  },
});

function mount(api) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const session = createAuthSession({
    api,
    clearCache: () => client.clear(),
    lock: (run) => run(),
  });
  return render(
    <QueryClientProvider client={client}>
      <AuthProvider session={session}>
        <AdminShell>
          <p>Private admin content</p>
        </AdminShell>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

test('guest admin route preserves the destination and exposes no admin navigation', async () => {
  mount(() => Promise.reject(new ApiClientError('Sign in.', { status: 401 })));

  await waitFor(() =>
    expect(navigation.replace).toHaveBeenCalledWith('/login?returnTo=%2Fadmin'),
  );
  expect(
    screen.queryByRole('navigation', { name: 'Admin navigation' }),
  ).not.toBeInTheDocument();
  expect(screen.queryByText('Private admin content')).not.toBeInTheDocument();
});

test('customer receives a clear denial without admin navigation or data request', async () => {
  const api = vi.fn().mockResolvedValue(sessionResponse('CUSTOMER'));
  mount(api);

  expect(
    await screen.findByRole('heading', { name: 'Admin access required' }),
  ).toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent(
    'does not have permission',
  );
  expect(
    screen.queryByRole('navigation', { name: 'Admin navigation' }),
  ).not.toBeInTheDocument();
  expect(screen.queryByText('Private admin content')).not.toBeInTheDocument();
  expect(api).toHaveBeenCalledTimes(1);
});

test('authorized admin sees the responsive shell only after the API authorizes it', async () => {
  const admin = user('ADMIN');
  const api = vi.fn((path) =>
    Promise.resolve(
      path === '/admin' ? { data: { user: admin } } : sessionResponse('ADMIN'),
    ),
  );
  mount(api);

  expect(screen.queryByText('Private admin content')).not.toBeInTheDocument();
  expect(await screen.findByText('Private admin content')).toBeInTheDocument();
  expect(
    screen.getByRole('navigation', { name: 'Admin navigation' }),
  ).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Overview' })).toHaveAttribute(
    'href',
    '/admin',
  );
  expect(api).toHaveBeenCalledWith(
    '/admin',
    expect.objectContaining({ schema: expect.anything() }),
  );
});

test('server role denial removes admin navigation and child content', async () => {
  const api = vi
    .fn()
    .mockResolvedValueOnce(sessionResponse('ADMIN'))
    .mockRejectedValueOnce(
      new ApiClientError('Forbidden.', { status: 403, code: 'FORBIDDEN' }),
    );
  mount(api);

  expect(
    await screen.findByRole('heading', { name: 'Admin access required' }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole('navigation', { name: 'Admin navigation' }),
  ).not.toBeInTheDocument();
  expect(screen.queryByText('Private admin content')).not.toBeInTheDocument();
});
test('admin can retry a temporary authorization verification failure', async () => {
  const admin = user('ADMIN');
  const api = vi
    .fn()
    .mockResolvedValueOnce(sessionResponse('ADMIN'))
    .mockRejectedValueOnce(new ApiClientError('Offline.'))
    .mockResolvedValueOnce({ data: { user: admin } });
  mount(api);

  expect(await screen.findByRole('alert')).toHaveTextContent(
    'could not verify admin access',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByText('Private admin content')).toBeInTheDocument();
  expect(api).toHaveBeenCalledTimes(3);
});
