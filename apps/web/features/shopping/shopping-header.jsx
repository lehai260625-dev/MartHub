'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '../auth/auth-provider';
import { useShopping } from './shopping-provider';

export function ShoppingHeader() {
  const pathname = usePathname() || '';
  const menuRef = useRef(null);
  const auth = useAuth();
  const shopping = useShopping();
  useEffect(() => {
    menuRef.current?.removeAttribute('open');
  }, [pathname]);
  if (
    pathname.startsWith('/admin') ||
    pathname === '/login' ||
    pathname === '/register'
  )
    return null;
  const customer = auth.status === 'authenticated';
  const count = customer && shopping.cartReady ? shopping.cart.itemCount : 0;
  return (
    <header className="store-header">
      <div className="store-header-primary">
        <Link className="store-wordmark" href="/">
          MartHub
        </Link>
        <details className="store-menu" ref={menuRef}>
          <summary>
            <span className="store-menu-short">Menu</span>
            <span className="store-menu-long">Departments</span>
          </summary>
          <nav
            aria-label="Departments"
            onClick={() => menuRef.current?.removeAttribute('open')}
          >
            <Link href="/categories">Browse categories</Link>
            <Link href="/search?new=true">New products</Link>
            <Link href="/search?popular=true">Popular products</Link>
            <Link href="/account/my-items?tab=wishlist">My Items</Link>
          </nav>
        </details>
        <form action="/search" className="store-search" role="search">
          <label className="sr-only" htmlFor="store-search-query">
            Search products
          </label>
          <input
            id="store-search-query"
            maxLength="80"
            minLength="2"
            name="q"
            placeholder="Search MartHub"
            required
            type="search"
          />
          <button type="submit">Search</button>
        </form>
        <Link
          className="store-header-link"
          href="/account/my-items?tab=wishlist"
        >
          My Items
        </Link>
        <Link
          className="store-header-link"
          href={customer ? '/account' : '/login?returnTo=%2Faccount'}
        >
          {customer ? auth.user.firstName : 'Sign in'}
        </Link>
        <Link className="store-cart-link" href="/cart">
          Cart <span aria-label={`${count} items in cart`}>{count}</span>
        </Link>
      </div>
      <nav aria-label="Shopping" className="store-header-secondary">
        <span>Choose delivery area</span>
        <Link href="/search?featured=true">Deals</Link>
        <Link href="/categories">Categories</Link>
        <Link href="/search?new=true">New products</Link>
        <Link href="/search?popular=true">Popular products</Link>
      </nav>
    </header>
  );
}
