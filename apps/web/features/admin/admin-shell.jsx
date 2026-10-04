'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { adminSessionResponseSchema } from '@marthub/contracts';
import { useAuth } from '../auth/auth-provider';
import { AuthState } from '../auth/auth-state';
import { safeReturnTo } from '../../lib/auth/return-to';

function AccessDenied() {
  return (
    <main id="main-content" className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
      <h1 className="text-3xl font-semibold">Admin access required</h1>
      <p role="alert" className="mt-4 text-neutral-700">
        Your account does not have permission to open this workspace.
      </p>
      <Link
        href="/"
        className="mt-6 inline-flex min-h-11 items-center font-semibold text-emerald-800 underline underline-offset-4"
      >
        Return to the store
      </Link>
    </main>
  );
}

export function AdminShell({ children }) {
  const { request, status, user } = useAuth();
  const { replace } = useRouter();
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const [attempt, setAttempt] = useState(0);
  const [authorization, setAuthorization] = useState({
    identity: null,
    status: 'checking',
  });
  const identity =
    status === 'authenticated' ? user.id + ':' + user.role : null;
  const authorizationKey = identity ? identity + ':' + attempt : null;

  useEffect(() => {
    if (status === 'guest') {
      replace(
        '/login?returnTo=' +
          encodeURIComponent(
            safeReturnTo(pathname + (search ? '?' + search : '')),
          ),
      );
      return;
    }
    if (status !== 'authenticated' || user.role !== 'ADMIN') return;

    let current = true;

    request('/admin', { schema: adminSessionResponseSchema })
      .then(() => {
        if (current)
          setAuthorization({ identity: authorizationKey, status: 'allowed' });
      })
      .catch((error) => {
        if (!current || error.name === 'AbortError') return;
        setAuthorization({
          identity: authorizationKey,
          status: error.status === 403 ? 'denied' : 'error',
        });
      });
    return () => {
      current = false;
    };
  }, [
    attempt,
    request,
    status,
    user,
    authorizationKey,
    identity,
    pathname,
    replace,
    search,
  ]);

  if (status === 'loading' || status === 'error')
    return (
      <main id="main-content" className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
        <AuthState />
      </main>
    );
  if (status === 'guest') return null;
  if (
    user.role !== 'ADMIN' ||
    (authorization.identity === authorizationKey &&
      authorization.status === 'denied')
  )
    return <AccessDenied />;
  if (
    authorization.identity !== authorizationKey ||
    authorization.status === 'checking'
  )
    return (
      <main id="main-content" className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
        <p role="status">Checking admin access…</p>
      </main>
    );
  if (authorization.status === 'error')
    return (
      <main id="main-content" className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
        <p role="alert">
          We could not verify admin access. Check your connection and try again.
        </p>
        <button
          className="button-secondary mt-4"
          onClick={() => setAttempt((value) => value + 1)}
        >
          Try again
        </button>
      </main>
    );

  return (
    <div className="min-h-screen bg-neutral-100">
      <header className="border-b border-neutral-300 bg-white px-4 py-4 sm:px-6">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3">
          <Link
            href="/admin"
            className="inline-flex min-h-11 items-center text-xl font-bold text-emerald-900"
          >
            MartHub Admin
          </Link>
          <div className="flex min-w-0 items-center gap-4">
            <p className="truncate text-sm text-neutral-600">
              {user.firstName} {user.lastName}
            </p>
            <Link
              href="/"
              className="inline-flex min-h-11 items-center font-semibold text-emerald-800 underline-offset-4 hover:underline"
            >
              View store
            </Link>
          </div>
        </div>
      </header>
      <div className="mx-auto grid max-w-7xl lg:grid-cols-[15rem_minmax(0,1fr)]">
        <nav
          aria-label="Admin navigation"
          className="overflow-x-auto border-b border-neutral-300 bg-white px-4 lg:min-h-[calc(100vh-77px)] lg:border-r lg:border-b-0 lg:px-6 lg:py-6"
        >
          <div className="flex gap-5 lg:flex-col lg:gap-2">
            <Link
              href="/admin"
              className="inline-flex min-h-11 items-center whitespace-nowrap font-semibold text-emerald-900 underline-offset-4 hover:underline"
            >
              Overview
            </Link>
            <Link
              href="/admin/categories"
              className="inline-flex min-h-11 items-center whitespace-nowrap font-semibold text-emerald-900 underline-offset-4 hover:underline"
            >
              Categories
            </Link>{' '}
            <Link
              href="/admin/products"
              className="inline-flex min-h-11 items-center whitespace-nowrap font-semibold text-emerald-900 underline-offset-4 hover:underline"
            >
              Products
            </Link>
            <Link
              href="/admin/orders"
              className="inline-flex min-h-11 items-center whitespace-nowrap font-semibold text-emerald-900 underline-offset-4 hover:underline"
            >
              Orders
            </Link>
          </div>
        </nav>
        <main
          id="main-content"
          tabIndex={-1}
          className="min-w-0 px-4 py-8 sm:px-6 lg:px-10 lg:py-10"
        >
          {children}
        </main>
      </div>
    </div>
  );
}
