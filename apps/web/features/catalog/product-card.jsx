import Link from 'next/link';
import { formatVnd } from './catalog-query';

export function ProductCard({ product }) {
  const compareAt =
    product.compareAtPrice &&
    BigInt(product.compareAtPrice) > BigInt(product.price)
      ? product.compareAtPrice
      : null;
  const available = product.availability.canAddToCart;

  return (
    <article className="product-card">
      <div className="relative">
        <Link
          aria-label={`View ${product.name}`}
          className="product-media"
          href={`/products/${product.slug}`}
        >
          {product.image ? (
            // Catalog image hosts are controlled by the server-side media adapter.
            // eslint-disable-next-line @next/next/no-img-element
            <img alt={product.image.altText} src={product.image.url} />
          ) : (
            <span aria-hidden="true" className="product-placeholder">
              MH
            </span>
          )}
        </Link>
        {product.badges.length > 0 ? (
          <ul aria-label="Product labels" className="product-badges">
            {product.badges.map((badge) => (
              <li key={badge}>{badge === 'SALE' ? 'Sale' : 'New'}</li>
            ))}
          </ul>
        ) : null}
      </div>
      <div className="product-card-body">
        <div className="min-h-14">
          <p className="text-xl font-bold text-neutral-950">
            {formatVnd(product.price)}
          </p>
          {compareAt ? (
            <p className="text-sm text-neutral-600">
              <span className="sr-only">Previous price </span>
              <del>{formatVnd(compareAt)}</del>
            </p>
          ) : null}
        </div>
        <p className="text-sm text-neutral-600">{product.sellingUnit}</p>
        <h2 className="product-name">
          <Link href={`/products/${product.slug}`}>{product.name}</Link>
        </h2>
        <p className="min-h-6 text-sm font-medium text-neutral-700">
          {available ? 'In stock' : 'Out of stock'}
        </p>
        <button
          aria-label={
            available
              ? `Add ${product.name} to cart`
              : `${product.name} is out of stock`
          }
          className="button-primary mt-auto w-full"
          disabled
          type="button"
        >
          {available ? 'Add to cart' : 'Out of stock'}
        </button>
      </div>
    </article>
  );
}
