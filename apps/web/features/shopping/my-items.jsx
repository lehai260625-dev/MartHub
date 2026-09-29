'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
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

export function MyItems() {
  const requested = useSearchParams().get('tab');
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
        <section className="shopping-empty" aria-labelledby="reorder-title">
          <h2 id="reorder-title">No delivered purchases yet</h2>
          <p>
            Products from delivered orders will appear here for quick reorder.
          </p>
          <Link
            className="button-primary inline-flex items-center"
            href="/categories"
          >
            Browse categories
          </Link>
        </section>
      )}
    </>
  );
}
