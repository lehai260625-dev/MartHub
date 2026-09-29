import { Suspense } from 'react';
import { AuthForm } from '../../../features/auth/auth-form';
export const metadata = {
  title: 'Sign in | MartHub',
  robots: { index: false, follow: false },
};
export default function LoginPage() {
  return (
    <Suspense fallback={<p role="status">Loading sign-in…</p>}>
      <AuthForm />
    </Suspense>
  );
}
