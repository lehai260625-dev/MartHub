import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '../features/auth/auth-provider';
import { ShoppingProvider } from '../features/shopping/shopping-provider';

const guestState = { status: 'guest', user: null, error: null };

export function ShoppingTestShell({
  children,
  request = () => Promise.reject(new Error('Unexpected shopping request.')),
  state = guestState,
}) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: false },
          mutations: { retry: false },
        },
      }),
  );
  const session = {
    subscribe: () => () => {},
    getSnapshot: () => state,
    getServerSnapshot: () => state,
    bootstrap: () => Promise.resolve(),
    request,
  };
  return (
    <QueryClientProvider client={client}>
      <AuthProvider session={session}>
        <ShoppingProvider>{children}</ShoppingProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
import { useState } from 'react';
