import Link from 'next/link';
import { connection } from 'next/server';
import { getCategories } from '../../features/catalog/catalog-data';
import { breadcrumbStructuredData } from '../../features/catalog/catalog-seo';
import { StructuredData } from '../../features/catalog/structured-data';

export const metadata = {
  title: 'Categories',
  description: 'Browse active MartHub departments and categories.',
  alternates: { canonical: '/categories' },
};

export default async function CategoriesPage() {
  await connection();
  const { data: categories } = await getCategories();
  return (
    <>
      <StructuredData
        data={{
          '@context': 'https://schema.org',
          ...breadcrumbStructuredData([
            { name: 'MartHub', path: '/' },
            { name: 'Categories', path: '/categories' },
          ]),
        }}
        id="category-index-breadcrumbs"
      />
      <main id="main-content" className="catalog-page">
        <nav aria-label="Catalog" className="catalog-nav">
          <Link className="font-bold text-primary" href="/">
            MartHub
          </Link>
          <Link aria-current="page" href="/categories">
            Categories
          </Link>
          <Link href="/search">Search</Link>
        </nav>
        <header className="max-w-3xl">
          <h1 className="text-3xl font-semibold tracking-normal md:text-4xl">
            Browse categories
          </h1>
          <p className="mt-3 leading-7 text-muted">
            Choose a department, then narrow the listing with filters stored in
            the URL.
          </p>
        </header>
        {categories.length ? (
          <ul className="category-grid">
            {categories.map((category) => (
              <li className="category-card" key={category.id}>
                <h2 className="text-xl font-semibold">
                  <Link
                    className="text-emerald-900 underline-offset-4 hover:underline"
                    href={`/category/${category.slug}`}
                  >
                    {category.name}
                  </Link>
                </h2>
                {category.description ? (
                  <p className="mt-2 text-sm leading-6 text-muted">
                    {category.description}
                  </p>
                ) : null}
                {category.children.length ? (
                  <ul
                    className="mt-4 flex flex-wrap gap-2"
                    aria-label={`${category.name} subcategories`}
                  >
                    {category.children.map((child) => (
                      <li key={child.id}>
                        <Link
                          className="inline-flex min-h-11 items-center rounded-brand-md border border-line px-3 text-sm font-medium hover:border-primary"
                          href={`/category/${child.slug}`}
                        >
                          {child.name}
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <div className="mt-8 rounded-brand-md bg-surface-subtle p-6">
            <h2 className="text-xl font-semibold">
              No categories are available
            </h2>
            <p className="mt-2 text-muted">Please try again later.</p>
          </div>
        )}
      </main>
    </>
  );
}
