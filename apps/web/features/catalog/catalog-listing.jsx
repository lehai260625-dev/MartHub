import Form from 'next/form';
import Link from 'next/link';
import { catalogHref } from './catalog-query';
import { ProductCard } from './product-card';

function FilterFields({ query, state, action }) {
  return (
    <Form action={action} className="space-y-5" key={JSON.stringify(state)}>
      {state.q ? <input name="q" type="hidden" value={state.q} /> : null}
      {state.category ? (
        <input name="category" type="hidden" value={state.category} />
      ) : null}
      <fieldset>
        <legend className="font-semibold">Price in VND</legend>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <label className="text-sm">
            Minimum
            <input
              className="form-input mt-1"
              defaultValue={state.minPrice || ''}
              inputMode="numeric"
              min="0"
              name="minPrice"
              pattern="[0-9]+"
              step="1"
              type="number"
            />
          </label>
          <label className="text-sm">
            Maximum
            <input
              className="form-input mt-1"
              defaultValue={state.maxPrice || ''}
              inputMode="numeric"
              min="0"
              name="maxPrice"
              pattern="[0-9]+"
              step="1"
              type="number"
            />
          </label>
        </div>
      </fieldset>
      <fieldset className="space-y-3">
        <legend className="font-semibold">Availability and collections</legend>
        {[
          ['availability', 'in-stock', 'In stock'],
          ['featured', 'true', 'Featured'],
          ['new', 'true', 'New products'],
          ['popular', 'true', 'Popular products'],
        ].map(([name, value, label]) => (
          <label className="flex min-h-11 items-center gap-3" key={name}>
            <input
              defaultChecked={state[name] === value}
              name={name}
              type="checkbox"
              value={value}
            />
            {label}
          </label>
        ))}
      </fieldset>
      <label className="block font-semibold">
        Sort by
        <select
          className="form-input mt-1"
          defaultValue={query.sort}
          name="sort"
        >
          {state.q ? <option value="relevance">Relevance</option> : null}
          <option value="newest">Newest</option>
          <option value="price-asc">Price: low to high</option>
          <option value="price-desc">Price: high to low</option>
          <option value="popular">Popular</option>
        </select>
      </label>
      <label className="block font-semibold">
        Products per page
        <select
          className="form-input mt-1"
          defaultValue={String(query.perPage)}
          name="perPage"
        >
          {[12, 24, 48].map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
      </label>
      <input name="page" type="hidden" value="1" />
      <div className="flex flex-wrap gap-3">
        <button className="button-primary" type="submit">
          Apply filters
        </button>
        <Link
          className="button-secondary inline-flex items-center"
          href={state.q ? `${action}?q=${encodeURIComponent(state.q)}` : action}
        >
          Clear filters
        </Link>
      </div>
    </Form>
  );
}

export function CatalogListing({ action, description, result, state, title }) {
  const { data: products, meta } = result;
  const appliedFilterCount = [
    'minPrice',
    'maxPrice',
    'availability',
    'featured',
    'new',
    'popular',
  ].filter((key) => state.values[key] !== undefined).length;
  return (
    <main id="main-content" className="catalog-page">
      <nav aria-label="Catalog" className="catalog-nav">
        <Link className="font-bold text-primary" href="/">
          MartHub
        </Link>
        <Link href="/categories">Categories</Link>
        <Link href="/search">Search</Link>
      </nav>
      <header className="max-w-3xl">
        <h1 className="text-3xl font-semibold tracking-normal md:text-4xl">
          {title}
        </h1>
        {description ? (
          <p className="mt-3 leading-7 text-muted">{description}</p>
        ) : null}
        <p className="mt-3 text-sm text-muted" aria-live="polite">
          {meta.totalItems} {meta.totalItems === 1 ? 'product' : 'products'}
        </p>
      </header>
      <details
        className="catalog-filter-disclosure mt-6 rounded-brand-md border border-line bg-white p-4"
        open
      >
        <summary className="min-h-11 cursor-pointer py-2 font-semibold">
          Filters and sorting
          {appliedFilterCount ? ` (${appliedFilterCount} applied)` : ''}
        </summary>
        <div className="mt-4 lg:mt-0">
          <FilterFields
            action={action}
            query={state.query}
            state={state.values}
          />
        </div>
      </details>
      <section aria-label="Product results" className="catalog-results">
        {products.length ? (
          <div className="product-grid">
            {products.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        ) : (
          <div className="rounded-brand-md bg-surface-subtle p-6">
            <h2 className="text-xl font-semibold">No products found</h2>
            <p className="mt-2 text-muted">
              Try clearing a filter or browsing all categories.
            </p>
            <Link
              className="mt-4 inline-flex min-h-11 items-center font-semibold text-primary underline"
              href="/categories"
            >
              Browse categories
            </Link>
          </div>
        )}
        {meta.totalPages > 1 ? (
          <nav aria-label="Pagination" className="pagination">
            {meta.page > 1 ? (
              <Link
                href={catalogHref(action, state.values, {
                  page: meta.page - 1,
                })}
              >
                Previous
              </Link>
            ) : (
              <span aria-disabled="true">Previous</span>
            )}
            <span aria-current="page">
              Page {meta.page} of {meta.totalPages}
            </span>
            {meta.page < meta.totalPages ? (
              <Link
                href={catalogHref(action, state.values, {
                  page: meta.page + 1,
                })}
              >
                Next
              </Link>
            ) : (
              <span aria-disabled="true">Next</span>
            )}
          </nav>
        ) : null}
      </section>
    </main>
  );
}

export function InvalidCatalogUrl({ resetHref }) {
  return (
    <main id="main-content" className="catalog-page">
      <div
        className="rounded-brand-md border border-error bg-error-subtle p-6"
        role="alert"
      >
        <h1 className="text-2xl font-semibold">Invalid catalog filters</h1>
        <p className="mt-2">This URL contains filters MartHub cannot apply.</p>
        <Link
          className="mt-4 inline-flex min-h-11 items-center font-semibold text-primary underline"
          href={resetHref}
        >
          Clear invalid filters
        </Link>
      </div>
    </main>
  );
}
