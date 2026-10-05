import Link from 'next/link';
import {
  CatalogListing,
  InvalidCatalogUrl,
} from '../../features/catalog/catalog-listing';
import { getProductListing } from '../../features/catalog/catalog-data';

export const metadata = {
  title: 'Search',
  description: 'Search the active MartHub catalog.',
  alternates: { canonical: '/search' },
  robots: { index: false, follow: true },
};

export default async function SearchPage({ searchParams }) {
  const rawSearchParams = await searchParams;
  const listing = await getProductListing(rawSearchParams);
  if (!listing.success) return <InvalidCatalogUrl resetHref="/search" />;
  const query = listing.state.query.q;

  return (
    <>
      <section
        className="catalog-search"
        aria-labelledby="catalog-search-title"
      >
        <div className="mx-auto max-w-7xl px-4 md:px-6">
          <span className="sr-only" id="catalog-search-title">
            Search MartHub
          </span>
          <form
            action="/search"
            className="flex flex-col gap-2 sm:flex-row"
            method="get"
            role="search"
            aria-label="Catalog search"
          >
            <label className="sr-only" htmlFor="catalog-search-input">
              Search products
            </label>
            <input
              className="form-input flex-1"
              defaultValue={query || ''}
              id="catalog-search-input"
              maxLength="80"
              minLength="2"
              name="q"
              placeholder="Search products"
              type="search"
            />
            <button className="button-primary" type="submit">
              Search
            </button>
          </form>
        </div>
      </section>
      <CatalogListing
        action="/search"
        description={
          query
            ? `Showing matches for “${query}”.`
            : 'Browse all available products or enter a search term.'
        }
        result={listing.result}
        state={listing.state}
        title={query ? 'Search results' : 'All products'}
      />
      <div className="sr-only">
        <Link href="/categories">Browse categories</Link>
      </div>
    </>
  );
}
