import { PromotionManager } from '../../../features/admin/promotion-manager';
export const metadata = {
  title: 'Promotions | MartHub Admin',
  robots: { index: false, follow: false },
};
export default function AdminPromotionsPage() {
  return (
    <>
      <p className="text-sm font-semibold uppercase tracking-wide text-emerald-800">
        Merchandising
      </p>
      <h1 className="mt-2 text-3xl font-semibold">Promotion management</h1>
      <p className="mt-4 max-w-3xl text-neutral-700">
        Create, schedule, publish, order, archive, and manage homepage campaign
        media.
      </p>
      <PromotionManager />
    </>
  );
}
