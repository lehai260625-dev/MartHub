import { expect, it, vi } from 'vitest';
import { createAuthSession } from '../lib/auth/session';
const a = {
  id: 'a1111111-1111-4111-8111-111111111111',
  email: 'a@example.test',
  firstName: 'First',
  lastName: 'User',
  role: 'CUSTOMER',
};
const b = {
  ...a,
  id: 'b2222222-2222-4222-8222-222222222222',
  email: 'b@example.test',
};
const response = (accessToken = 'token-a', user = a) => ({
  data: { accessToken, expiresIn: 900, user },
});
const denied = () => Object.assign(new Error('Unauthorized'), { status: 401 });
function deferred() {
  let resolve;
  const promise = new Promise((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
function setup(implementation) {
  const api = vi.fn(implementation),
    clearCache = vi.fn();
  return {
    api,
    clearCache,
    session: createAuthSession({ api, clearCache, lock: (run) => run() }),
  };
}

it('duplicate bootstrap serializes refresh and exposes no token in observable state', async () => {
  const pending = deferred();
  const { session, api } = setup((path) =>
    path === '/auth/refresh' ? pending.promise : { data: 'ok' },
  );
  const boots = [session.bootstrap(), session.bootstrap()];
  await vi.waitFor(() => expect(api).toHaveBeenCalledTimes(1));
  pending.resolve(response());
  await Promise.all(boots);
  expect(session.getSnapshot()).toEqual({
    status: 'authenticated',
    user: a,
    error: null,
  });
  expect(JSON.stringify(session.getSnapshot())).not.toContain('token-a');
  await session.request('/users/me');
  expect(api).toHaveBeenLastCalledWith(
    '/users/me',
    expect.objectContaining({ token: 'token-a' }),
  );
});

it('bootstrap distinguishes guest401 from retryable network errors', async () => {
  const guest = setup(() => Promise.reject(denied()));
  await guest.session.bootstrap();
  expect(guest.session.getSnapshot()).toMatchObject({
    status: 'guest',
    error: null,
  });
  const { session, api } = setup(() => Promise.reject(new Error('Offline')));
  await session.bootstrap();
  expect(session.getSnapshot().status).toBe('error');
  api.mockResolvedValue(response());
  await session.retry();
  expect(session.getSnapshot().status).toBe('authenticated');
});

it('concurrent401 shares refresh and requests retry only once', async () => {
  const pending = deferred();
  const { session, api } = setup((path, options) =>
    path === '/auth/login'
      ? response()
      : path === '/auth/refresh'
        ? pending.promise
        : options.token === 'token-a'
          ? Promise.reject(denied())
          : { data: path },
  );
  await session.signIn({});
  const calls = [session.request('/one'), session.request('/two')];
  await vi.waitFor(() =>
    expect(api.mock.calls.filter(([p]) => p === '/auth/refresh')).toHaveLength(
      1,
    ),
  );
  pending.resolve(response('token-new'));
  expect(await Promise.all(calls)).toEqual([
    { data: '/one' },
    { data: '/two' },
  ]);
  for (const path of ['/one', '/two'])
    expect(api.mock.calls.filter(([p]) => p === path)).toHaveLength(2);
  api.mockImplementation((path) =>
    path === '/auth/refresh' ? response('third') : Promise.reject(denied()),
  );
  await expect(session.request('/retry')).rejects.toMatchObject({
    status: 401,
  });
  expect(api.mock.calls.filter(([p]) => p === '/retry')).toHaveLength(2);
  expect(session.getSnapshot().status).toBe('guest');
});

it('logout queues after inflight refresh and rejects stale acceptance', async () => {
  const pending = deferred();
  const { session, api, clearCache } = setup((path) =>
    path === '/auth/refresh' ? pending.promise : undefined,
  );
  const refresh = session.refresh().catch((error) => error);
  await vi.waitFor(() => expect(api).toHaveBeenCalledTimes(1));
  const logout = session.signOut();
  expect(clearCache).toHaveBeenCalled();
  expect(api.mock.calls.some(([p]) => p === '/auth/logout')).toBe(false);
  pending.resolve(response());
  expect((await refresh).name).toBe('AbortError');
  await logout;
  expect(api.mock.calls.map(([p]) => p)).toEqual([
    '/auth/refresh',
    '/auth/logout',
  ]);
  expect(session.getSnapshot().status).toBe('guest');
});

it('old protected responses cannot publish after logout', async () => {
  const pending = deferred();
  const { session, clearCache } = setup((path) =>
    path === '/auth/login'
      ? response()
      : path === '/old'
        ? pending.promise
        : undefined,
  );
  await session.signIn({});
  const old = session.request('/old').catch((error) => error);
  clearCache.mockClear();
  await session.signOut();
  pending.resolve({ data: 'private' });
  expect((await old).name).toBe('AbortError');
  expect(clearCache).toHaveBeenCalled();
  expect(session.getSnapshot().user).toBeNull();
});

it('identity switching refresh clears cache and cancels old PATCH intent', async () => {
  const { session, api, clearCache } = setup((path) =>
    path === '/auth/login'
      ? response()
      : path === '/auth/refresh'
        ? response('token-b', b)
        : Promise.reject(denied()),
  );
  await session.signIn({});
  clearCache.mockClear();
  await expect(
    session.request('/users/me', {
      method: 'PATCH',
      body: { firstName: 'Changed' },
    }),
  ).rejects.toMatchObject({ name: 'AbortError' });
  expect(api.mock.calls.filter(([p]) => p === '/users/me')).toHaveLength(1);
  expect(session.getSnapshot().user.id).toBe(b.id);
  expect(clearCache).toHaveBeenCalled();
});

it('logout-all uses valid bearer without refreshing cookie', async () => {
  const { session, api } = setup((path) =>
    path === '/auth/login' ? response() : undefined,
  );
  await session.signIn({});
  api.mockClear();
  await session.signOut({ all: true });
  expect(api).toHaveBeenCalledExactlyOnceWith('/auth/logout-all', {
    method: 'POST',
    token: 'token-a',
  });
});

it('logout-all refreshes same-user stale bearer once then retries', async () => {
  const { session, api } = setup((path, options) =>
    path === '/auth/login'
      ? response()
      : path === '/auth/refresh'
        ? response('new')
        : options.token === 'token-a'
          ? Promise.reject(denied())
          : undefined,
  );
  await session.signIn({});
  api.mockClear();
  await session.signOut({ all: true });
  expect(api.mock.calls.map(([p]) => p)).toEqual([
    '/auth/logout-all',
    '/auth/refresh',
    '/auth/logout-all',
  ]);
  expect(api).toHaveBeenLastCalledWith('/auth/logout-all', {
    method: 'POST',
    token: 'new',
  });
});

it('logout-all never revokes B when fallback refresh discovers different identity', async () => {
  const { session, api } = setup((path) =>
    path === '/auth/login'
      ? response()
      : path === '/auth/refresh'
        ? response('token-b', b)
        : Promise.reject(denied()),
  );
  await session.signIn({});
  api.mockClear();
  await expect(session.signOut({ all: true })).rejects.toMatchObject({
    name: 'AbortError',
  });
  expect(api.mock.calls.map(([p]) => p)).toEqual([
    '/auth/logout-all',
    '/auth/refresh',
  ]);
  expect(session.getSnapshot()).toMatchObject({ status: 'error', user: null });
  await expect(session.refresh()).rejects.toMatchObject({ name: 'AbortError' });
  expect(api.mock.calls).toHaveLength(2);
});

it('failed signout blocks restoration and retries signout rather than refresh', async () => {
  const { session, api } = setup((path) =>
    path === '/auth/login' ? response() : Promise.reject(new Error('Offline')),
  );
  await session.signIn({});
  api.mockClear();
  await expect(session.signOut()).rejects.toThrow('Offline');
  await expect(session.refresh()).rejects.toMatchObject({ name: 'AbortError' });
  await expect(session.request('/private')).rejects.toMatchObject({
    name: 'AbortError',
  });
  expect(api.mock.calls.map(([p]) => p)).toEqual(['/auth/logout']);
  api.mockResolvedValue(undefined);
  await session.retry();
  expect(api.mock.calls.map(([p]) => p)).toEqual([
    '/auth/logout',
    '/auth/logout',
  ]);
  expect(session.getSnapshot().status).toBe('guest');
});
