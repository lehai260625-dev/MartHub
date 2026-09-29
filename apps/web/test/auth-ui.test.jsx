import { StrictMode } from 'react';
import { expect, test, vi, beforeEach } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from '../features/auth/auth-provider';
import { AuthForm } from '../features/auth/auth-form';
import { ProtectedAccount } from '../features/auth/protected-account';
import { createAuthSession } from '../lib/auth/session';
import { ApiClientError } from '../lib/api/core';
import { safeReturnTo } from '../lib/auth/return-to';

const navigation = vi.hoisted(() => ({
  replace: vi.fn(),
  search: '',
  pathname: '/account',
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: navigation.replace }),
  useSearchParams: () => new URLSearchParams(navigation.search),
  usePathname: () => navigation.pathname,
}));
beforeEach(() => {
  navigation.replace.mockReset();
  navigation.search = '';
  navigation.pathname = '/account';
});
const user = {
  id: 'b2ecb79a-b74a-4748-93dc-f2fc02b93b3d',
  email: 'customer@example.com',
  firstName: 'Minh',
  lastName: 'Nguyen',
  role: 'CUSTOMER',
};
const response = {
  data: { user, accessToken: 'memory-only-test-token', expiresIn: 900 },
};
const guest = () =>
  Promise.reject(new ApiClientError('Sign in.', { status: 401 }));
function mount(children, api) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const session = createAuthSession({
    api,
    clearCache: () => client.clear(),
    lock: (run) => run(),
  });
  const view = render(
    <StrictMode>
      <QueryClientProvider client={client}>
        <AuthProvider session={session}>{children}</AuthProvider>
      </QueryClientProvider>
    </StrictMode>,
  );
  return { ...view, session, client };
}

test('StrictMode bootstraps once, protects pending content, and preserves path plus query', async () => {
  let reject;
  const api = vi.fn(
    () =>
      new Promise((_, fail) => {
        reject = fail;
      }),
  );
  navigation.search = 'tab=wishlist&sort=recent';
  mount(
    <ProtectedAccount>
      <p>Private account</p>
    </ProtectedAccount>,
    api,
  );
  expect(screen.queryByText('Private account')).not.toBeInTheDocument();
  await waitFor(() => expect(api).toHaveBeenCalledTimes(1));
  await act(async () =>
    reject(new ApiClientError('Sign in.', { status: 401 })),
  );
  expect(navigation.replace).toHaveBeenCalledWith(
    '/login?returnTo=%2Faccount%3Ftab%3Dwishlist%26sort%3Drecent',
  );
});

test('recoverable bootstrap error has explicit retry and shows no private data', async () => {
  const api = vi
    .fn()
    .mockRejectedValueOnce(new ApiClientError('Offline'))
    .mockResolvedValueOnce(response);
  mount(
    <ProtectedAccount>
      <p>Private account</p>
    </ProtectedAccount>,
    api,
  );
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'could not restore',
  );
  expect(navigation.replace).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByText('Private account')).toBeInTheDocument();
  expect(api).toHaveBeenCalledTimes(2);
});

test('registration validates shared fields, preserves return URL, and disables duplicate submit', async () => {
  let finish;
  const api = vi.fn((path) =>
    path === '/auth/refresh'
      ? guest()
      : new Promise((resolve) => {
          finish = resolve;
        }),
  );
  navigation.search = 'returnTo=%2Faccount%3FreturnProbe%3D1';
  mount(<AuthForm mode="register" />, api);
  const button = screen.getByRole('button', { name: 'Create account' });
  expect(button).toBeDisabled();
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
  expect(await screen.findAllByRole('alert')).toHaveLength(4);
  expect(screen.getByLabelText('Email')).toHaveAttribute(
    'aria-invalid',
    'true',
  );
  expect(screen.getByRole('link', { name: 'Sign in instead' })).toHaveAttribute(
    'href',
    '/login?returnTo=%2Faccount%3FreturnProbe%3D1',
  );
  fireEvent.change(screen.getByLabelText('First name'), {
    target: { value: 'Minh' },
  });
  fireEvent.change(screen.getByLabelText('Last name'), {
    target: { value: 'Nguyen' },
  });
  fireEvent.change(screen.getByLabelText('Email'), {
    target: { value: ' CUSTOMER@EXAMPLE.COM ' },
  });
  fireEvent.change(screen.getByLabelText('Password'), {
    target: { value: 'a long test passphrase' },
  });
  fireEvent.click(button);
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Please wait…' })).toBeDisabled(),
  );
  expect(api.mock.calls[1][0]).toBe('/auth/register');
  expect(api.mock.calls[1][1].body.email).toBe('customer@example.com');
  await act(async () => finish(response));
  expect(navigation.replace).toHaveBeenCalledWith('/account?returnProbe=1');
});

test('credential failure keeps email, clears password and exposes a safe error', async () => {
  const api = vi.fn((path) =>
    path === '/auth/refresh'
      ? guest()
      : Promise.reject(
          new ApiClientError('private implementation detail', {
            status: 401,
            code: 'INVALID_CREDENTIALS',
          }),
        ),
  );
  mount(<AuthForm />, api);
  const button = screen.getByRole('button', { name: 'Sign in' });
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.change(screen.getByLabelText('Email'), {
    target: { value: 'customer@example.com' },
  });
  fireEvent.change(screen.getByLabelText('Password'), {
    target: { value: 'a long test passphrase' },
  });
  fireEvent.click(button);
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Email or password is incorrect.',
  );
  expect(screen.getByLabelText('Email')).toHaveValue('customer@example.com');
  expect(screen.getByLabelText('Password')).toHaveValue('');
  expect(
    screen.queryByText('private implementation detail'),
  ).not.toBeInTheDocument();
});

test('provider clears query data on logout and never renders access tokens', async () => {
  function Probe() {
    const auth = useAuth();
    return (
      <>
        <p>{auth.status}</p>
        <button onClick={() => auth.signOut()}>End session</button>
      </>
    );
  }
  const api = vi
    .fn()
    .mockResolvedValueOnce(response)
    .mockResolvedValueOnce(undefined);
  const { client } = mount(<Probe />, api);
  await screen.findByText('authenticated');
  client.setQueryData(['private'], { secret: 'private customer data' });
  fireEvent.click(screen.getByRole('button', { name: 'End session' }));
  expect(client.getQueryData(['private'])).toBeUndefined();
  await screen.findByText('guest');
  expect(document.body).not.toHaveTextContent(response.data.accessToken);
});

test('return destinations reject external, encoded, control and auth-loop paths', () => {
  for (const value of [
    null,
    'https://evil.example',
    '//evil.example',
    '/\\evil.example',
    '/%2f%2fevil.example',
    '/%252f%252fevil.example',
    '/%5cevil',
    '/%00evil',
    '/login',
    '/register?returnTo=/login',
    '/%6cogin',
    '/%61pi/v1/auth/logout',
    '/a/../login',
    '/bad%zz',
  ])
    expect(safeReturnTo(value), String(value)).toBe('/account');
  expect(safeReturnTo('/account?tab=wishlist&sort=recent')).toBe(
    '/account?tab=wishlist&sort=recent',
  );
  expect(safeReturnTo('/search?q=rice')).toBe('/search?q=rice');
});
