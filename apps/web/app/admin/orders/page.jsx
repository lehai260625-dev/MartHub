import { Suspense } from 'react';
import { AdminOrderQueue } from '../../../features/admin/order-queue';

export const metadata = {
  title: 'Orders | MartHub Admin',
  robots: { index: false, follow: false },
};

export default function AdminOrdersPage() {
  return (
    <>
      <p className="text-sm font-semibold uppercase tracking-wide text-emerald-800">
        Operations
      </p>
      <h1 className="mt-2 text-3xl font-semibold">Orders</h1>
      <p className="mt-4 max-w-3xl text-neutral-700">
        Search and inspect immutable order records and their complete status
        history.
      </p>
      <Suspense
        fallback={
          <p role="status" className="mt-6">
            Loading orders…
          </p>
        }
      >
        <AdminOrderQueue />
      </Suspense>
    </>
  );
}
