import { AdminOrderDetail } from '../../../../features/admin/order-detail';

export const metadata = {
  title: 'Order detail | MartHub Admin',
  robots: { index: false, follow: false },
};

export default async function AdminOrderDetailPage({ params }) {
  const { orderId } = await params;
  return <AdminOrderDetail key={orderId} orderId={orderId} />;
}
