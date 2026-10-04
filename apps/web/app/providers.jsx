'use client';

import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '../features/auth/auth-provider';
import { ShoppingProvider } from '../features/shopping/shopping-provider';
import { ShoppingHeader } from '../features/shopping/shopping-header';
import { ShoppingFooter } from '../features/shopping/shopping-footer';

export default function Providers({ children }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 30_000, retry: false },
          mutations: { retry: false },
        },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      <AuthProvider>
        <ShoppingProvider>
          <ShoppingHeader />
          {children}
          <ShoppingFooter />
        </ShoppingProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
