import { Suspense } from 'react';
import { ProtectedAccount } from '../../features/auth/protected-account';
import { CheckoutManager } from '../../features/checkout/checkout-manager';

export const metadata = {
  title: 'Checkout',
  robots: { index: false, follow: false },
};

export default function CheckoutPage() {
  return (
    <main id="main-content" className="shopping-page">
      <h1 className="text-3xl font-semibold">Checkout</h1>
      <Suspense fallback={<p role="status">Checking your session…</p>}>
        <ProtectedAccount>
          <CheckoutManager />
        </ProtectedAccount>
      </Suspense>
    </main>
  );
}
