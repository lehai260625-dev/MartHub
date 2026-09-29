import Link from 'next/link';
import { Suspense } from 'react';
import { ProtectedAccount } from '../../features/auth/protected-account';
export const metadata = {
  title: 'Your account | MartHub',
  robots: { index: false, follow: false },
};
export default function AccountLayout({ children }) {
  return (
    <div className="min-h-screen bg-neutral-50">
      <header className="border-b border-neutral-200 bg-white px-4 py-5 sm:px-6">
        <Link
          href="/"
          className="inline-flex min-h-11 items-center text-2xl font-bold text-emerald-800"
        >
          MartHub
        </Link>
      </header>
      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto max-w-4xl px-4 py-10 sm:px-6 sm:py-14"
      >
        <Suspense fallback={<p role="status">Checking your session…</p>}>
          <ProtectedAccount>{children}</ProtectedAccount>
        </Suspense>
      </main>
    </div>
  );
}
