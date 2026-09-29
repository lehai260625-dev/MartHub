import { authResponseSchema, publicUserSchema } from '@marthub/contracts';
import { ApiClientError, createApiClient } from '../api/core';

const initial = Object.freeze({ status: 'loading', user: null, error: null });
const cancelled = () =>
  new DOMException('Authentication changed.', 'AbortError');

// Each instance belongs to one mounted provider, never a server singleton.
export function createAuthSession({
  api = createApiClient(),
  clearCache = () => {},
  lock = (run) =>
    globalThis.navigator?.locks
      ? navigator.locks.request('marthub-auth-cookie', run)
      : run(),
} = {}) {
  let state = initial;
  let token = null;
  let identity = null;
  let epoch = 0;
  let started = false;
  let refreshFlight;
  let signOutFlight;
  let pendingSignOut = false;
  let pendingAll = false;
  let queue = Promise.resolve();
  const listeners = new Set();
  const publish = (next) => {
    state = next;
    listeners.forEach((listener) => listener());
  };
  const serial = (run) => {
    const result = queue.then(() => lock(run));
    queue = result.catch(() => {});
    return result;
  };
  const accept = (response, expected) => {
    if (epoch !== expected) throw cancelled();
    const { data } = authResponseSchema.parse(response);
    if (identity && identity !== data.user.id) epoch++;
    identity = data.user.id;
    if (state.user && state.user.id !== data.user.id) clearCache();
    token = data.accessToken;
    publish({ status: 'authenticated', user: data.user, error: null });
    return data.user;
  };
  const fail = (error, expected) => {
    if (epoch !== expected) return;
    token = null;
    if (identity) clearCache();
    publish({
      status: error.status === 401 ? 'guest' : 'error',
      user: null,
      error:
        error.status === 401
          ? null
          : 'We could not restore your session. Check your connection and try again.',
    });
  };
  const refresh = () => {
    if (pendingSignOut) return Promise.reject(cancelled());
    if (refreshFlight) return refreshFlight;
    const expected = epoch;
    refreshFlight = serial(async () => {
      if (epoch !== expected) throw cancelled();
      try {
        return accept(
          await api('/auth/refresh', {
            method: 'POST',
            schema: authResponseSchema,
          }),
          expected,
        );
      } catch (error) {
        fail(error, expected);
        throw error;
      }
    }).finally(() => {
      refreshFlight = undefined;
    });
    return refreshFlight;
  };
  const authenticate = (path, body) => {
    const expected = ++epoch;
    pendingSignOut = false;
    token = null;
    clearCache();
    return serial(async () => {
      if (epoch !== expected) throw cancelled();
      return accept(
        await api(path, { method: 'POST', body, schema: authResponseSchema }),
        expected,
      );
    });
  };
  const request = async (path, options = {}) => {
    const expected = epoch;
    if (pendingSignOut) throw cancelled();
    if (!token) await refresh();
    if (epoch !== expected) throw cancelled();
    const sentToken = token;
    try {
      const result = await api(path, { ...options, token: sentToken });
      if (epoch !== expected) throw cancelled();
      return result;
    } catch (error) {
      if (epoch !== expected) throw cancelled();
      if (error.status !== 401) throw error;
      if (token === sentToken) await refresh();
      if (epoch !== expected) throw cancelled();
      try {
        const result = await api(path, { ...options, token });
        if (epoch !== expected) throw cancelled();
        return result;
      } catch (retryError) {
        if (epoch !== expected) throw cancelled();
        if (retryError.status === 401) fail(retryError, expected);
        throw retryError;
      }
    }
  };
  const signOut = ({ all = false } = {}) => {
    if (signOutFlight) return signOutFlight;
    const expected = ++epoch;
    let logoutToken = token;
    const logoutIdentity = identity;
    pendingSignOut = true;
    pendingAll = all;
    token = null;
    clearCache();
    publish({ status: 'loading', user: null, error: null });
    signOutFlight = serial(async () => {
      try {
        if (all) {
          try {
            if (!logoutToken)
              throw new ApiClientError('Session expired.', { status: 401 });
            await api('/auth/logout-all', {
              method: 'POST',
              token: logoutToken,
            });
          } catch (error) {
            if (error.status !== 401) throw error;
            const response = await api('/auth/refresh', {
              method: 'POST',
              schema: authResponseSchema,
            });
            if (!logoutIdentity || response.data.user.id !== logoutIdentity)
              throw cancelled();
            logoutToken = response.data.accessToken;
            await api('/auth/logout-all', {
              method: 'POST',
              token: logoutToken,
            });
          }
        } else await api('/auth/logout', { method: 'POST' });
        if (epoch === expected) {
          pendingSignOut = false;
          publish({ status: 'guest', user: null, error: null });
        }
      } catch (error) {
        if (epoch === expected)
          publish({
            status: 'error',
            user: null,
            error:
              'Sign-out could not be confirmed. Try again before leaving this device.',
          });
        throw error;
      }
    }).finally(() => {
      signOutFlight = undefined;
    });
    return signOutFlight;
  };
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => state,
    getServerSnapshot: () => initial,
    bootstrap() {
      if (started) return refreshFlight;
      started = true;
      return refresh().catch(() => {});
    },
    retry() {
      if (pendingSignOut) return signOut({ all: pendingAll });
      publish({ status: 'loading', user: null, error: null });
      return refresh();
    },
    signIn: (body) => authenticate('/auth/login', body),
    register: (body) => authenticate('/auth/register', body),
    signOut,
    request,
    refresh,
    updateUser(user) {
      const parsed = publicUserSchema.parse(user);
      if (state.status !== 'authenticated' || parsed.id !== state.user.id)
        throw new ApiClientError('Your session changed.', { status: 401 });
      publish({ ...state, user: parsed });
    },
  };
}
