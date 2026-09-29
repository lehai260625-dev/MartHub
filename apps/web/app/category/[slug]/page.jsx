import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ApiClientError } from '../../../lib/api/core';
import {
  getCategory,
  getProductListing,
} from '../../../features/catalog/catalog-data';
import {
  categoryMetadata,
  categoryStructuredData,
} from '../../../features/catalog/catalog-seo';
import {
  CatalogListing,
  InvalidCatalogUrl,
} from '../../../features/catalog/catalog-listing';
import { StructuredData } from '../../../features/catalog/structured-data';

async function loadCategory(slug) {
  try {
    return (await getCategory(slug)).data;
  } catch (error) {
    if (error instanceof ApiClientError && error.status === 404) notFound();
    throw error;
  }
}

export async function generateMetadata({ params }) {
  const { slug } = await params;
  return categoryMetadata(await loadCategory(slug));
}

export default async function CategoryPage({ params, searchParams }) {
  const { slug } = await params;
  const category = await loadCategory(slug);
  const listing = await getProductListing(await searchParams, slug);
  if (!listing.success)
    return <InvalidCatalogUrl resetHref={`/category/${slug}`} />;
  const navigation = [
    ...(category.parent ? [category.parent] : []),
    ...category.children,
  ];

  return (
    <>
      <StructuredData
        data={categoryStructuredData(category)}
        id="category-breadcrumbs"
      />
      {navigation.length ? (
        <nav aria-label="Related categories" className="related-categories">
          <span className="font-semibold">Related:</span>
          {navigation.map((item) => (
            <Link key={item.id} href={`/category/${item.slug}`}>
              {item.name}
            </Link>
          ))}
        </nav>
      ) : null}
      <CatalogListing
        action={`/category/${slug}`}
        description={category.description}
        result={listing.result}
        state={listing.state}
        title={category.name}
      />
    </>
  );
}
