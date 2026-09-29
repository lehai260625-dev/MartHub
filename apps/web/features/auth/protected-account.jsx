'use client';
import { useEffect } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from './auth-provider';
import { AuthState } from './auth-state';
import { safeReturnTo } from '../../lib/auth/return-to';

export function ProtectedAccount({ children }) {
  const auth = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams().toString();
  useEffect(() => {
    if (auth.status === 'guest')
      router.replace(
        '/login?returnTo=' +
          encodeURIComponent(
            safeReturnTo(pathname + (search ? '?' + search : '')),
          ),
      );
  }, [auth.status, router, pathname, search]);
  if (auth.status !== 'authenticated') return <AuthState />;
  return children;
}
