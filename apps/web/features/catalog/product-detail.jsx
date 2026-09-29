import Link from 'next/link';
import { formatVnd } from './catalog-query';
import { ProductGallery } from './product-gallery';

export function ProductDetail({ product }) {
  const compareAt =
    product.compareAtPrice &&
    BigInt(product.compareAtPrice) > BigInt(product.price)
      ? product.compareAtPrice
      : null;
  const available = product.availability.canAddToCart;

  return (
    <main id="main-content" className="product-detail-page">
      <nav aria-label="Breadcrumb" className="product-breadcrumbs">
        <Link href="/">MartHub</Link>
        <span aria-hidden="true">/</span>
        <Link href="/categories">Categories</Link>
        <span aria-hidden="true">/</span>
        <Link href={`/category/${product.category.slug}`}>
          {product.category.name}
        </Link>
      </nav>
      <div className="product-detail-layout">
        <ProductGallery images={product.images} productName={product.name} />
        <section
          aria-labelledby="product-title"
          className="product-detail-summary"
        >
          {product.brand ? (
            <p className="text-sm font-semibold uppercase text-emerald-800">
              {product.brand}
            </p>
          ) : null}
          <h1
            className="mt-2 text-3xl font-semibold tracking-normal md:text-4xl"
            id="product-title"
          >
            {product.name}
          </h1>
          {product.shortDescription ? (
            <p className="mt-3 leading-7 text-neutral-700">
              {product.shortDescription}
            </p>
          ) : null}
          {product.badges.length ? (
            <ul aria-label="Product labels" className="product-detail-badges">
              {product.badges.map((badge) => (
                <li key={badge}>{badge === 'SALE' ? 'Sale' : 'New'}</li>
              ))}
            </ul>
          ) : null}
          <div className="mt-6 min-h-20">
            <p className="text-3xl font-bold text-neutral-950">
              {formatVnd(product.price)}
            </p>
            {compareAt ? (
              <p className="mt-1 text-base text-neutral-600">
                <span className="sr-only">Previous price </span>
                <del>{formatVnd(compareAt)}</del>
              </p>
            ) : null}
          </div>
          <p
            className={`mt-3 font-semibold ${available ? 'text-emerald-800' : 'text-red-800'}`}
            id="product-availability"
          >
            {available ? 'In stock' : 'Out of stock'}
          </p>
          <div className="product-purchase-panel">
            <label className="font-semibold" htmlFor="product-quantity">
              Quantity
            </label>
            <input
              aria-describedby="product-availability"
              className="form-input mt-1 w-24"
              defaultValue="1"
              disabled={!available}
              id="product-quantity"
              inputMode="numeric"
              min="1"
              name="quantity"
              step="1"
              type="number"
            />
            <button
              aria-describedby="product-availability"
              className="button-primary mt-3 w-full"
              disabled
              type="button"
            >
              {available ? 'Add to cart' : 'Out of stock'}
            </button>
          </div>
          <dl className="product-facts">
            <div>
              <dt>SKU</dt>
              <dd>{product.sku}</dd>
            </div>
            <div>
              <dt>Selling unit</dt>
              <dd>{product.sellingUnit}</dd>
            </div>
            <div>
              <dt>Category</dt>
              <dd>{product.category.name}</dd>
            </div>
          </dl>
        </section>
      </div>
      {product.description ? (
        <section
          aria-labelledby="product-description"
          className="product-description"
        >
          <h2 className="text-2xl font-semibold" id="product-description">
            Product details
          </h2>
          <p className="mt-3 max-w-3xl leading-7 text-neutral-700">
            {product.description}
          </p>
        </section>
      ) : null}
    </main>
  );
}
