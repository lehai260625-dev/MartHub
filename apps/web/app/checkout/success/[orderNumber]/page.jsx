import { Suspense } from 'react';
import { ProtectedAccount } from '../../../../features/auth/protected-account';
import { CheckoutSuccess } from '../../../../features/checkout/checkout-manager';

export const metadata = {
  title: 'Order submitted',
  robots: { index: false, follow: false },
};

export default async function CheckoutSuccessPage({ params }) {
  const { orderNumber } = await params;
  return (
    <main id="main-content" className="shopping-page">
      <h1 className="text-3xl font-semibold">Order submitted</h1>
      <Suspense fallback={<p role="status">Checking your session…</p>}>
        <ProtectedAccount>
          <CheckoutSuccess orderNumber={orderNumber} />
        </ProtectedAccount>
      </Suspense>
    </main>
  );
}
