import Link from 'next/link';
import { formatVnd } from './catalog-query';
import { AddToCartButton, WishlistButton } from '../shopping/shopping-actions';
import { ProductMedia } from './product-media';

export function ProductCard({ product, headingLevel = 2, prefetch }) {
  const Heading = `h${headingLevel}`;
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
          prefetch={prefetch}
          aria-label={`View ${product.name}`}
          className="product-media"
          href={`/products/${product.slug}`}
        >
          <ProductMedia
            key={product.image?.url || 'missing'}
            image={product.image}
          />
        </Link>
        {product.badges.length > 0 ? (
          <ul aria-label="Product labels" className="product-badges">
            {product.badges.map((badge) => (
              <li key={badge}>{badge === 'SALE' ? 'Sale' : 'New'}</li>
            ))}
          </ul>
        ) : null}
        <WishlistButton className="absolute right-2 top-2" product={product} />
      </div>
      <div className="product-card-body">
        <div className="product-price-slot min-h-14">
          <p className="text-xl font-bold text-ink">
            {formatVnd(product.price)}
          </p>
          {compareAt ? (
            <p className="text-sm text-muted">
              <span className="sr-only">Previous price </span>
              <del>{formatVnd(compareAt)}</del>
            </p>
          ) : null}
        </div>
        <p className="text-sm text-muted">{product.sellingUnit}</p>
        <Heading className="product-name">
          <Link prefetch={prefetch} href={`/products/${product.slug}`}>
            {product.name}
          </Link>
        </Heading>
        <p
          className={`min-h-6 text-sm font-medium ${available ? 'text-stock-in' : 'text-stock-out'}`}
        >
          {available ? 'In stock' : 'Out of stock'}
        </p>
        <AddToCartButton className="mt-auto" product={product} />
      </div>
    </article>
  );
}
