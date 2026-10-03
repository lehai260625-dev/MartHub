import { CustomerOrderDetail } from '../../../../features/orders/order-detail';

export const metadata = { title: 'Order detail | MartHub' };

export default async function OrderDetailPage({ params }) {
  const { orderNumber } = await params;
  return <CustomerOrderDetail key={orderNumber} orderNumber={orderNumber} />;
}
