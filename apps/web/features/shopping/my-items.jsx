'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  myItemsResponseSchema,
  homepageResponseSchema,
} from '@marthub/contracts';
import { useAuth } from '../auth/auth-provider';
import { api } from '../../lib/api/client';
import { PurchaseProvenance } from '../orders/order-detail';
import { ProductCard } from '../catalog/product-card';
import { useShopping } from './shopping-provider';

function UnavailableWishlistItem({ item }) {
  const shopping = useShopping();
  const [message, setMessage] = useState('');
  const remove = async () => {
    setMessage('');
    try {
      await shopping.removeFromWishlist(item.productId);
    } catch {
      setMessage('This saved item could not be removed. Please try again.');
    }
  };
  return (
    <li className="unavailable-wishlist-item">
      <div aria-hidden="true" className="product-placeholder">
        MH
      </div>
      <h3>Saved product unavailable</h3>
      <p>This product is no longer in the public catalog.</p>
      <button
        className="button-secondary"
        disabled={shopping.wishlistPending}
        onClick={remove}
        type="button"
      >
        Remove saved item
      </button>
      {message ? <p role="alert">{message}</p> : null}
    </li>
  );
}

function WishlistPanel() {
  const shopping = useShopping();
  if (!shopping.wishlistReady && !shopping.wishlistError)
    return <p role="status">Loading your wishlist…</p>;
  if (shopping.wishlistError)
    return (
      <div className="shopping-error" role="alert">
        <p>We could not load your wishlist.</p>
        <button
          className="button-secondary"
          onClick={() => shopping.retryWishlist()}
        >
          Try again
        </button>
      </div>
    );
  if (!shopping.wishlist.items.length)
    return (
      <div className="shopping-empty">
        <h2>Your wishlist is empty</h2>
        <p>Save products from search or category pages to find them here.</p>
        <Link
          className="button-primary inline-flex items-center"
          href="/categories"
        >
          Browse categories
        </Link>
      </div>
    );
  return (
    <>
      {shopping.wishlistMutationError ? (
        <p className="mb-4 text-red-800" role="alert">
          Wishlist could not be updated. Your saved items were restored; try
          again.
        </p>
      ) : null}
      <ul className="wishlist-grid" aria-label="Saved products">
        {shopping.wishlist.items.map((item) =>
          item.product ? (
            <li key={item.id}>
              <ProductCard product={item.product} />
            </li>
          ) : (
            <UnavailableWishlistItem item={item} key={item.id} />
          ),
        )}
      </ul>
    </>
  );
}

function PopularFallback() {
  const query = useQuery({
    queryKey: ['homepage-popular'],
    queryFn: ({ signal }) =>
      api('/homepage', { signal, schema: homepageResponseSchema }),
    retry: false,
  });
  if (query.isPending) return <p role="status">Loading popular products…</p>;
  const products = query.data?.data.popularProducts ?? [];
  if (!products.length)
    return (
      <Link
        className="button-primary inline-flex items-center"
        href="/categories"
      >
        Browse categories
      </Link>
    );
  return (
    <section aria-labelledby="popular-title">
      <h2 className="mt-6 text-xl font-semibold" id="popular-title">
        Popular products
      </h2>
      <ul className="wishlist-grid mt-4">
        {products.map((product) => (
          <li key={product.id}>
            <ProductCard product={product} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function PurchasedPanel({ search }) {
  const auth = useAuth();
  const rawPage = search.get('page');
  const page =
    /^[1-9]\d*$/.test(rawPage ?? '') &&
    Number(rawPage) <= Math.floor(2147483647 / 20) + 1
      ? Number(rawPage)
      : 1;
  const sort = search.get('sort') === 'frequent' ? 'frequent' : 'recent';
  const query = useQuery({
    queryKey: ['my-items', auth.user.id, page, sort],
    queryFn: ({ signal }) =>
      auth.request(`/users/me/items?page=${page}&sort=${sort}`, {
        signal,
        schema: myItemsResponseSchema,
      }),
    retry: false,
  });
  if (query.isPending)
    return <p role="status">Loading your delivered purchases…</p>;
  if (query.isError)
    return (
      <div role="alert" className="shopping-error">
        <p>We could not load your delivered purchases.</p>
        <button className="button-secondary" onClick={() => query.refetch()}>
          Try again
        </button>
      </div>
    );
  const href = (target, order = sort) =>
    `/account/my-items?tab=reorder&sort=${order}&page=${target}`;
  return (
    <section aria-labelledby="reorder-title">
      <h2 id="reorder-title" className="text-xl font-semibold">
        Delivered purchases
      </h2>
      {!query.data.meta.totalItems ? (
        <>
          <div className="shopping-empty">
            <span aria-hidden="true">MH</span>
            <h3>No delivered purchases yet</h3>
            <p>
              Products from delivered orders will appear here for quick reorder.
            </p>
          </div>
          <PopularFallback />
        </>
      ) : (
        <>
          <nav aria-label="Purchase sorting" className="my-items-tabs">
            <Link
              aria-current={sort === 'recent' ? 'page' : undefined}
              href={href(1, 'recent')}
            >
              Most recent
            </Link>
            <Link
              aria-current={sort === 'frequent' ? 'page' : undefined}
              href={href(1, 'frequent')}
            >
              Most purchased
            </Link>
          </nav>
          {!query.data.data.length && <p>No purchases on this page.</p>}
          <ul
            className="wishlist-grid purchased-grid"
            aria-label="Purchased products"
          >
            {query.data.data.map((item) => (
              <li key={item.productId} className="min-w-0 break-words">
                {item.currentProduct ? (
                  <ProductCard product={item.currentProduct} />
                ) : (
                  <article className="unavailable-wishlist-item">
                    <div aria-hidden="true" className="product-placeholder">
                      MH
                    </div>
                    <h3>{item.snapshot.productName}</h3>
                    <p>Unavailable</p>
                    <p>
                      This product is no longer available in the public catalog.
                    </p>
                    <button className="button-primary w-full" disabled>
                      Add to cart
                    </button>
                  </article>
                )}
                <div className="space-y-2 p-3">
                  <p>Purchased as: {item.snapshot.productName}</p>
                  <p>SKU: {item.snapshot.sku}</p>
                  <p>{item.snapshot.sellingUnit}</p>
                  <p>{item.purchaseCount} purchased</p>
                  <p>
                    Last delivered:{' '}
                    <time dateTime={item.lastPurchasedAt}>
                      {item.lastPurchasedAt.slice(0, 10)}
                    </time>
                  </p>
                  <PurchaseProvenance orderId={item.orderId} />
                </div>
              </li>
            ))}
          </ul>
          <nav
            className="mt-6 flex flex-wrap items-center gap-4"
            aria-label="Purchase pages"
          >
            {page > 1 && (
              <Link className="button-secondary" href={href(page - 1)}>
                Previous page
              </Link>
            )}
            <p>
              Page {page} of {query.data.meta.totalPages}
            </p>
            {page < query.data.meta.totalPages && (
              <Link className="button-secondary" href={href(page + 1)}>
                Next page
              </Link>
            )}
          </nav>
        </>
      )}
    </section>
  );
}

export function MyItems() {
  const search = useSearchParams();
  const requested = search.get('tab');
  const tab = requested === 'wishlist' ? 'wishlist' : 'reorder';
  return (
    <>
      <header>
        <p className="text-sm font-semibold uppercase text-emerald-800">
          Account
        </p>
        <h1 className="mt-2 text-3xl font-semibold">My Items</h1>
      </header>
      <nav aria-label="My Items" className="my-items-tabs">
        <Link
          aria-current={tab === 'reorder' ? 'page' : undefined}
          href="/account/my-items?tab=reorder"
        >
          Reorder
        </Link>
        <Link
          aria-current={tab === 'wishlist' ? 'page' : undefined}
          href="/account/my-items?tab=wishlist"
        >
          Wishlist
        </Link>
      </nav>
      {tab === 'wishlist' ? (
        <WishlistPanel />
      ) : (
        <PurchasedPanel search={search} />
      )}
    </>
  );
}
