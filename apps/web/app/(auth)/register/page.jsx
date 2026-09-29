import { Suspense } from 'react';
import { AuthForm } from '../../../features/auth/auth-form';
export const metadata = {
  title: 'Create your account | MartHub',
  robots: { index: false, follow: false },
};
export default function RegisterPage() {
  return (
    <Suspense fallback={<p role="status">Loading registration…</p>}>
      <AuthForm mode="register" />
    </Suspense>
  );
}
