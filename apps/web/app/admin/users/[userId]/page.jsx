import { AdminUserDetail } from '../../../../features/admin/user-detail';
export const metadata = {
  title: 'User detail | MartHub Admin',
  robots: { index: false, follow: false },
};
export default async function AdminUserDetailPage({ params }) {
  const { userId } = await params;
  return <AdminUserDetail key={userId} userId={userId} />;
}
