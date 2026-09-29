import Link from 'next/link';
import { ProfileForm } from '../../../features/account/profile-form';

export const metadata = {
  title: 'Profile | MartHub',
  robots: { index: false, follow: false },
};

export default function ProfilePage() {
  return (
    <>
      <Link
        href="/account"
        className="text-sm font-medium text-emerald-800 underline-offset-4 hover:underline"
      >
        Back to account
      </Link>
      <h1 className="mt-5 text-3xl font-semibold">Your profile</h1>
      <p className="mt-3 text-neutral-600">
        Keep your name and phone number up to date. Email changes are not
        available here.
      </p>
      <ProfileForm />
    </>
  );
}
