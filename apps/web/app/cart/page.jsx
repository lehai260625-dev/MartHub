import { Suspense } from 'react';
import { ProtectedAccount } from '../../features/auth/protected-account';
import { CartManager } from '../../features/shopping/cart-manager';

export const metadata = {
  title: 'Cart',
  robots: { index: false, follow: false },
};

export default function CartPage() {
  return (
    <main id="main-content" className="shopping-page">
      <header>
        <p className="text-sm font-semibold uppercase text-emerald-800">
          Shopping
        </p>
        <h1 className="mt-2 text-3xl font-semibold">Your cart</h1>
      </header>
      <Suspense fallback={<p role="status">Checking your session…</p>}>
        <ProtectedAccount>
          <CartManager />
        </ProtectedAccount>
      </Suspense>
    </main>
  );
}
