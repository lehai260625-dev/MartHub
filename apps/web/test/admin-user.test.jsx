import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import { AdminUserQueue } from '../features/admin/user-queue';
import { AdminUserDetail } from '../features/admin/user-detail';
import { ApiClientError } from '../lib/api/core';

const nav = vi.hoisted(() => ({ search: '', push: vi.fn(), back: vi.fn() }));
const auth = vi.hoisted(() => ({
  request: vi.fn(),
  user: { id: 'b2ecb79a-b74a-4748-93dc-f2fc02b93b3d' },
}));
vi.mock('next/navigation', () => ({
  useRouter: () => nav,
  useSearchParams: () => new URLSearchParams(nav.search),
}));
vi.mock('../features/auth/auth-provider', () => ({ useAuth: () => auth }));
const user = {
  id: '0e7b73b7-9db0-4ae0-80b5-08e4049162cf',
  email: 'safe@example.test',
  firstName: 'Safe',
  lastName: 'Customer',
  role: 'CUSTOMER',
  status: 'ACTIVE',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  archivedAt: null,
};
const list = (data = [user], meta = {}) => ({
  data,
  meta: {
    page: 1,
    perPage: 20,
    totalItems: data.length,
    totalPages: data.length ? 1 : 0,
    ...meta,
  },
});
function mount(component) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      {component}
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  nav.search = '';
  nav.push.mockReset();
  nav.back.mockReset();
  auth.request.mockReset();
});

test('user queue loading, empty, error recovery and safe populated links', async () => {
  let resolve;
  auth.request.mockReturnValueOnce(
    new Promise((r) => {
      resolve = r;
    }),
  );
  const loading = mount(<AdminUserQueue />);
  expect(screen.getByRole('status')).toHaveTextContent('Loading users');
  resolve(list([]));
  await screen.findByText('No users match these filters.');
  loading.unmount();
  auth.request
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce(list());
  mount(<AdminUserQueue />);
  expect(await screen.findByRole('alert')).toHaveTextContent('could not load');
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByRole('link', { name: user.email })).toHaveAttribute(
    'href',
    `/admin/users/${user.id}`,
  );
  expect(screen.getByText('Safe Customer')).toBeVisible();
  expect(screen.queryByText(/password|token/i)).not.toBeInTheDocument();
});
test('URL restore, every filter resets page, pagination preserves options and defaults omitted', async () => {
  nav.search =
    'q=Safe&role=CUSTOMER&status=ACTIVE&sort=email&page=2&perPage=50';
  auth.request.mockResolvedValue(
    list([user], { page: 2, perPage: 50, totalItems: 101, totalPages: 3 }),
  );
  mount(<AdminUserQueue />);
  await screen.findByText('Safe Customer');
  expect(screen.getByLabelText('Search users')).toHaveValue('Safe');
  expect(auth.request.mock.calls[0][0]).toBe('/admin/users?' + nav.search);
  expect(screen.getByRole('link', { name: 'Next page' })).toHaveAttribute(
    'href',
    '/admin/users?q=Safe&role=CUSTOMER&status=ACTIVE&sort=email&page=3&perPage=50',
  );
  for (const [label, value, expected] of [
    ['Role', 'ADMIN', 'q=Safe&role=ADMIN&status=ACTIVE&sort=email&perPage=50'],
    [
      'Status',
      'SUSPENDED',
      'q=Safe&role=CUSTOMER&status=SUSPENDED&sort=email&perPage=50',
    ],
    ['Sort', 'newest', 'q=Safe&role=CUSTOMER&status=ACTIVE&perPage=50'],
    ['Users per page', '20', 'q=Safe&role=CUSTOMER&status=ACTIVE&sort=email'],
  ]) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
    expect(nav.push).toHaveBeenLastCalledWith('/admin/users?' + expected);
  }
  fireEvent.change(screen.getByLabelText('Search users'), {
    target: { value: '  New   Name ' },
  });
  fireEvent.submit(screen.getByRole('search'));
  expect(nav.push).toHaveBeenLastCalledWith(
    '/admin/users?q=New+Name&role=CUSTOMER&status=ACTIVE&sort=email&perPage=50',
  );
});
test('invalid/repeated query prevents API request and offers reset', () => {
  nav.search = 'role=ADMIN&role=CUSTOMER';
  mount(<AdminUserQueue />);
  expect(screen.getByRole('alert')).toHaveTextContent('invalid');
  expect(screen.getByRole('link', { name: 'Reset filters' })).toHaveAttribute(
    'href',
    '/admin/users',
  );
  expect(auth.request).not.toHaveBeenCalled();
});

test('an approved custom page size in a shared URL is faithfully restored', async () => {
  nav.search = 'perPage=10';
  auth.request.mockResolvedValue(list([user], { perPage: 10 }));
  mount(<AdminUserQueue />);
  await screen.findByText('Safe Customer');
  expect(screen.getByLabelText('Users per page')).toHaveValue('10');
  expect(auth.request.mock.calls[0][0]).toBe('/admin/users?perPage=10');
});
test('detail safe fields, loading/back, retry and not found', async () => {
  let resolve;
  auth.request.mockReturnValueOnce(
    new Promise((r) => {
      resolve = r;
    }),
  );
  const view = mount(<AdminUserDetail userId={user.id} />);
  expect(screen.getByRole('status')).toHaveTextContent('Loading user detail');
  resolve({ data: user });
  await screen.findByRole('heading', { name: 'User detail' });
  expect(screen.getByText(user.email)).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Back to users' }));
  expect(nav.back).toHaveBeenCalledOnce();
  view.unmount();
  auth.request
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce({ data: user });
  const retry = mount(<AdminUserDetail userId={user.id} />);
  await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  await screen.findByText(user.email);
  retry.unmount();
  auth.request.mockRejectedValue(
    new ApiClientError('Missing', { status: 404 }),
  );
  mount(<AdminUserDetail userId={user.id} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('User not found');
  expect(
    screen.queryByRole('button', { name: 'Try again' }),
  ).not.toBeInTheDocument();
});
test('confirmation validates trimmed reason, prevents duplicate submits and renders authoritative status', async () => {
  let resolve;
  auth.request.mockResolvedValueOnce({ data: user }).mockReturnValueOnce(
    new Promise((r) => {
      resolve = r;
    }),
  );
  mount(<AdminUserDetail userId={user.id} />);
  fireEvent.click(
    await screen.findByRole('button', { name: 'Disable account' }),
  );
  const submit = screen.getByRole('button', { name: 'Confirm status change' });
  fireEvent.click(submit);
  expect(await screen.findByRole('alert')).toHaveTextContent('nonblank');
  fireEvent.change(screen.getByLabelText('Reason (required)'), {
    target: { value: '  Review  ' },
  });
  fireEvent.click(submit);
  fireEvent.submit(submit.closest('form'));
  expect(auth.request).toHaveBeenCalledTimes(2);
  expect(screen.getByRole('button', { name: 'Updating...' })).toBeDisabled();
  expect(auth.request.mock.calls[1][1].body).toEqual({
    expectedStatus: 'ACTIVE',
    toStatus: 'SUSPENDED',
    reason: 'Review',
  });
  resolve({ data: { ...user, status: 'SUSPENDED' } });
  expect(await screen.findByText('Account status updated.')).toBeVisible();
  expect(screen.getByText('Disabled')).toBeVisible();
  expect(
    screen.getByRole('button', { name: 'Reactivate account' }),
  ).toBeVisible();
});
test('reactivation omits reason, Admin archive absent, self and terminal states are disabled', async () => {
  auth.request
    .mockResolvedValueOnce({
      data: { ...user, role: 'ADMIN', status: 'SUSPENDED' },
    })
    .mockResolvedValueOnce({ data: { ...user, role: 'ADMIN' } });
  const view = mount(<AdminUserDetail userId={user.id} />);
  fireEvent.click(
    await screen.findByRole('button', { name: 'Reactivate account' }),
  );
  expect(screen.queryByLabelText('Reason (required)')).not.toBeInTheDocument();
  fireEvent.click(
    screen.getByRole('button', { name: 'Confirm status change' }),
  );
  await screen.findByText('Account status updated.');
  expect(auth.request.mock.calls[1][1].body).toEqual({
    expectedStatus: 'SUSPENDED',
    toStatus: 'ACTIVE',
  });
  expect(
    screen.queryByRole('button', { name: 'Archive account' }),
  ).not.toBeInTheDocument();
  view.unmount();
  auth.request.mockResolvedValue({
    data: { ...user, id: auth.user.id, role: 'ADMIN' },
  });
  const self = mount(<AdminUserDetail userId={auth.user.id} />);
  await screen.findByText('You cannot change your own account status.');
  expect(
    screen.queryByRole('button', { name: 'Disable account' }),
  ).not.toBeInTheDocument();
  self.unmount();
  auth.request.mockResolvedValue({
    data: { ...user, status: 'ARCHIVED', archivedAt: user.createdAt },
  });
  mount(<AdminUserDetail userId={user.id} />);
  await screen.findByText('This archived account cannot be changed.');
});
test.each(['USER_STATUS_CONFLICT', 'LAST_ACTIVE_ADMIN_REQUIRED'])(
  'actionable %s preserves detail and refreshes authoritative account',
  async (code) => {
    auth.request
      .mockResolvedValueOnce({ data: user })
      .mockRejectedValueOnce(
        new ApiClientError('Conflict', {
          status: 409,
          code,
          details: [{ currentStatus: 'ARCHIVED' }],
        }),
      )
      .mockResolvedValueOnce({
        data: { ...user, status: 'ARCHIVED', archivedAt: user.createdAt },
      });
    mount(<AdminUserDetail userId={user.id} />);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Archive account' }),
    );
    fireEvent.change(screen.getByLabelText('Reason (required)'), {
      target: { value: 'Archive' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Confirm status change' }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      code === 'USER_STATUS_CONFLICT'
        ? 'changed to Archived'
        : 'one active Admin',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Refresh account' }));
    await waitFor(() =>
      expect(screen.queryByRole('alert')).not.toBeInTheDocument(),
    );
    expect(
      screen.getByText('This archived account cannot be changed.'),
    ).toBeVisible();
  },
);
