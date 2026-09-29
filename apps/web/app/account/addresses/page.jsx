import Link from 'next/link';
import { AddressManager } from '../../../features/account/address-manager';

export const metadata = {
  title: 'Delivery addresses | MartHub',
  robots: { index: false, follow: false },
};

export default function AddressesPage() {
  return (
    <>
      <Link
        href="/account"
        className="text-sm font-medium text-emerald-800 underline-offset-4 hover:underline"
      >
        Back to account
      </Link>
      <h1 className="mt-5 text-3xl font-semibold">Delivery addresses</h1>
      <p className="mt-3 text-neutral-600">
        Save delivery details and choose one default address for checkout.
      </p>
      <AddressManager />
    </>
  );
}
