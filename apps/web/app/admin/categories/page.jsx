import { CategoryManager } from '../../../features/admin/category-manager';

export const metadata = {
  title: 'Categories | MartHub Admin',
  robots: { index: false, follow: false },
};

export default function AdminCategoriesPage() {
  return (
    <>
      <p className="text-sm font-semibold uppercase tracking-wide text-emerald-800">
        Catalog
      </p>
      <h1 className="mt-2 text-3xl font-semibold">Category management</h1>
      <p className="mt-4 max-w-3xl text-neutral-700">
        Create and arrange a two-level category tree. Archiving a category
        removes it and its products from public catalog discovery.
      </p>
      <CategoryManager />
    </>
  );
}
