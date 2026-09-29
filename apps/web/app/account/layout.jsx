import { Suspense } from 'react';
import { ProtectedAccount } from '../../features/auth/protected-account';
export const metadata = {
  title: 'Your account | MartHub',
  robots: { index: false, follow: false },
};
export default function AccountLayout({ children }) {
  return (
    <div className="min-h-screen bg-neutral-50">
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
