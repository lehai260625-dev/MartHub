'use client';
import { useAuth } from './auth-provider';

export function AuthState() {
  const auth = useAuth();
  if (auth.status !== 'error')
    return <p role="status">Checking your session…</p>;
  return (
    <div>
      <p role="alert">{auth.error}</p>
      <button
        className="button-secondary mt-4"
        onClick={() => auth.retry().catch(() => {})}
      >
        Try again
      </button>
    </div>
  );
}
