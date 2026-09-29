import { Suspense } from 'react';
import { AdminShell } from '../../features/admin/admin-shell';

export const metadata = {
  title: 'Admin | MartHub',
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }) {
  return (
    <Suspense
      fallback={
        <main
          id="main-content"
          className="mx-auto max-w-2xl px-4 py-12 sm:px-6"
        >
          <p role="status">Checking admin access…</p>
        </main>
      }
    >
      <AdminShell>{children}</AdminShell>
    </Suspense>
  );
}
