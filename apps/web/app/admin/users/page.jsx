import { Suspense } from 'react';
import { AdminUserQueue } from '../../../features/admin/user-queue';
export const metadata = {
  title: 'Users | MartHub Admin',
  robots: { index: false, follow: false },
};
export default function AdminUsersPage() {
  return (
    <>
      <h1 className="text-3xl font-semibold">Users</h1>
      <p className="mt-3">
        Inspect account identity and manage permitted status changes.
      </p>
      <Suspense fallback={<p role="status">Loading users...</p>}>
        <AdminUserQueue />
      </Suspense>
    </>
  );
}
