'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useAuth } from '../../features/auth/auth-provider';
export default function AccountPage() {
  const auth = useAuth();
  const [busy, setBusy] = useState(false);
  const signOut = (all) => {
    setBusy(true);
    auth
      .signOut({ all })
      .catch(() => {})
      .finally(() => setBusy(false));
  };
  return (
    <>
      <h1 className="text-3xl font-semibold">Your account</h1>
      <p className="mt-4 text-xl">Welcome, {auth.user?.firstName}.</p>
      <p className="mt-2 break-words text-neutral-600">{auth.user?.email}</p>
      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        <Link href="/account/profile" className="button-primary inline-flex">
          Edit profile
        </Link>
        <Link
          href="/account/addresses"
          className="button-secondary inline-flex"
        >
          Delivery addresses
        </Link>
        <Link href="/account/orders" className="button-secondary inline-flex">
          Order history
        </Link>
      </div>
      <section
        className="mt-10 border-t border-neutral-200 pt-6"
        aria-labelledby="session-title"
      >
        <h2 id="session-title" className="text-xl font-semibold">
          Account security
        </h2>
        <p className="mt-2 text-neutral-600">
          Sign out here, or end your sessions on every device.
        </p>
        <div className="mt-5 flex flex-col gap-3 sm:flex-row">
          <button
            className="button-secondary"
            disabled={busy}
            onClick={() => signOut(false)}
          >
            Sign out
          </button>
          <button
            className="button-secondary"
            disabled={busy}
            onClick={() => signOut(true)}
          >
            Sign out everywhere
          </button>
        </div>
      </section>
    </>
  );
}
