import { ProductManager } from '../../../features/admin/product-manager';

export const metadata = {
  title: 'Products | MartHub Admin',
  robots: { index: false, follow: false },
};

export default function AdminProductsPage() {
  return (
    <>
      <p className="text-sm font-semibold uppercase tracking-wide text-emerald-800">
        Catalog
      </p>
      <h1 className="mt-2 text-3xl font-semibold">Product management</h1>
      <p className="mt-4 max-w-3xl text-neutral-700">
        Create draft products, maintain catalog information, publish complete
        records, and archive unavailable products.
      </p>
      <ProductManager />
    </>
  );
}
