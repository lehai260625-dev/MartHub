import { Suspense } from 'react';
import { CustomerOrderHistory } from '../../../features/orders/order-history';

export const metadata = { title: 'Order history | MartHub' };

export default function OrderHistoryPage() {
  return (
    <Suspense fallback={<p role="status">Loading your orders…</p>}>
      <CustomerOrderHistory />
    </Suspense>
  );
}
