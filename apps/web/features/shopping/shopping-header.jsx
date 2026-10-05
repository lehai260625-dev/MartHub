'use client';
import {
  Suspense,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { addressListResponseSchema } from '@marthub/contracts';
import { useAuth } from '../auth/auth-provider';
import { safeReturnTo } from '../../lib/auth/return-to';
import { useShopping } from './shopping-provider';
import {
  accountLinks,
  canUseCustomerShopping,
  catalogLinks,
} from './storefront-links';

function SearchForm({ query = '' }) {
  return (
    <form
      action="/search"
      className="store-search"
      role="search"
      aria-label="Storefront search"
      lang="en"
    >
      <label className="sr-only" htmlFor="store-search-query">
        Search products
      </label>
      <input
        id="store-search-query"
        maxLength={80}
        minLength={2}
        name="q"
        placeholder="Search MartHub"
        required
        type="search"
        defaultValue={query}
      />
      <button type="submit">Search</button>
    </form>
  );
}
function UrlSearch() {
  const search = useSearchParams();
  const query = search?.getAll('q').length === 1 ? search.get('q') : '';
  return <SearchForm key={query} query={query || ''} />;
}
function CustomerDelivery() {
  const auth = useAuth();
  const query = useQuery({
    queryKey: ['addresses', auth.user.id],
    queryFn: () =>
      auth.request('/users/me/addresses', {
        schema: addressListResponseSchema,
      }),
  });
  if (query.isPending)
    return (
      <span role="status" className="store-placeholder">
        Đang tải địa chỉ…
      </span>
    );
  if (query.isError)
    return (
      <span>
        <span>Không tải được địa chỉ</span>{' '}
        <button className="store-text-button" onClick={() => query.refetch()}>
          Thử lại địa chỉ
        </button>
      </span>
    );
  const address = query.data.data.find((item) => item.isDefault);
  return (
    <Link href="/account/addresses">
      {address ? `${address.district}, ${address.province}` : 'Thêm địa chỉ'}
    </Link>
  );
}
function Delivery() {
  const auth = useAuth();
  if (auth.status === 'authenticated' && auth.user.role === 'ADMIN')
    return null;
  return (
    <div className="store-delivery">
      <span className="store-context-label">Giao đến</span>
      {auth.status === 'guest' ? (
        <Link
          href={`/login?returnTo=${encodeURIComponent(safeReturnTo('/account/addresses'))}`}
        >
          Đăng nhập để chọn địa chỉ
        </Link>
      ) : auth.status === 'authenticated' ? (
        <CustomerDelivery />
      ) : (
        <span role="status" className="store-placeholder">
          Chưa có thông tin địa chỉ
        </span>
      )}
    </div>
  );
}
function CartContext() {
  const auth = useAuth();
  const shopping = useShopping();
  if (!canUseCustomerShopping(auth)) return null;
  const hasCount =
    auth.status === 'authenticated' &&
    shopping.cartReady &&
    !shopping.cartError;
  return (
    <div className="store-cart-context">
      <Link className="store-cart-link" aria-label="Giỏ hàng" href="/cart">
        <svg
          className="store-cart-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          aria-hidden="true"
        >
          <path
            d="M3 4h3l2 11h10l3-8H7M9 20h.01M18 20h.01"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span className="store-cart-label">Giỏ hàng</span>
        {hasCount ? (
          <span
            className="store-cart-badge"
            aria-label={`${shopping.cart.itemCount} items in cart`}
            aria-live="polite"
          >
            {shopping.cart.itemCount}
          </span>
        ) : null}
      </Link>
      {shopping.cartError ? (
        <button
          className="store-text-button"
          aria-label="Thử lại giỏ hàng"
          onClick={() => shopping.retryCart()}
        >
          Thử lại
        </button>
      ) : null}
    </div>
  );
}
function AccountState() {
  const auth = useAuth();
  if (auth.status === 'error')
    return (
      <div className="store-auth-error">
        <span role="alert">Không tải được tài khoản.</span>
        <button
          className="store-text-button"
          onClick={() => auth.retry().catch(() => {})}
        >
          Thử lại tài khoản
        </button>
      </div>
    );
  return (
    <button className="store-account-button" disabled>
      Đang kiểm tra tài khoản…
    </button>
  );
}
function AccountActions({ onNavigate }) {
  const auth = useAuth();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  async function logout() {
    if (pending) return;
    setPending(true);
    setError(false);
    try {
      await auth.signOut();
      onNavigate();
    } catch {
      setError(true);
    } finally {
      setPending(false);
    }
  }
  return (
    <>
      <ul>
        {accountLinks(auth).map(({ label, href }) => (
          <li key={href}>
            <Link href={href} onClick={onNavigate}>
              {label}
            </Link>
          </li>
        ))}
      </ul>
      {auth.status === 'authenticated' ? (
        <button
          className="store-text-button"
          disabled={pending}
          onClick={logout}
        >
          {pending ? 'Đang đăng xuất…' : 'Đăng xuất'}
        </button>
      ) : null}
      {error ? (
        <p role="alert">Không đăng xuất được. Vui lòng thử lại.</p>
      ) : null}
    </>
  );
}
function subscribeViewport(listener) {
  const media = window.matchMedia?.('(min-width: 768px)');
  media?.addEventListener('change', listener);
  return () => media?.removeEventListener('change', listener);
}
const desktopSnapshot = () =>
  window.matchMedia?.('(min-width: 768px)').matches || false;
const serverDesktopSnapshot = () => false;

function HeaderChrome() {
  const auth = useAuth();
  const desktop = useSyncExternalStore(
    subscribeViewport,
    desktopSnapshot,
    serverDesktopSnapshot,
  );
  const [accountOpen, setAccountOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const accountRef = useRef(null),
    accountTrigger = useRef(null),
    drawerRef = useRef(null),
    drawerTrigger = useRef(null),
    menuRef = useRef(null);
  const accountReady =
    auth.status === 'guest' || auth.status === 'authenticated';
  function closeAccount(restore = true) {
    setAccountOpen(false);
    if (restore) accountTrigger.current?.focus();
  }
  function closeDrawer() {
    drawerRef.current?.close();
    setDrawerOpen(false);
    drawerTrigger.current?.focus();
  }
  function openDrawer() {
    drawerRef.current.showModal();
    setDrawerOpen(true);
  }
  useEffect(() => {
    if (accountOpen) menuRef.current?.querySelector('a, button')?.focus();
    function outside(event) {
      if (accountOpen && !accountRef.current?.contains(event.target))
        setAccountOpen(false);
    }
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [accountOpen]);
  useEffect(() => {
    const media = window.matchMedia?.('(min-width: 768px)');
    if (!media) return;
    function resize() {
      if (media.matches && drawerRef.current?.open) closeDrawer();
      if (!media.matches) closeAccount(false);
    }
    media.addEventListener('change', resize);
    return () => media.removeEventListener('change', resize);
  }, []);
  return (
    <header className="store-header" lang="vi">
      <div className="store-header-primary">
        <Link
          className="store-wordmark"
          href="/"
          aria-label="MartHub — Trang chủ"
        >
          MartHub
        </Link>
        {desktop ? (
          <>
            <Suspense fallback={<SearchForm />}>
              <UrlSearch />
            </Suspense>
            <Delivery />
          </>
        ) : null}
        <div
          className="store-account-desktop"
          ref={accountRef}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget))
              closeAccount(false);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              closeAccount();
            }
          }}
        >
          {!accountReady ? (
            <AccountState />
          ) : auth.status === 'guest' ? (
            <Link className="store-header-link" href="/login">
              Đăng nhập
            </Link>
          ) : (
            <>
              <button
                ref={accountTrigger}
                className="store-account-button"
                aria-expanded={accountOpen}
                aria-controls="store-account-menu"
                onClick={() => setAccountOpen((open) => !open)}
              >
                Tài khoản: {auth.user.firstName}
              </button>
              <nav
                ref={menuRef}
                hidden={!accountOpen}
                id="store-account-menu"
                aria-label="Tài khoản"
                className="store-account-menu"
              >
                <AccountActions onNavigate={() => closeAccount(false)} />
              </nav>
            </>
          )}
        </div>
        <button
          ref={drawerTrigger}
          className="store-mobile-trigger"
          aria-label="Menu — Mở điều hướng và tài khoản"
          aria-expanded={drawerOpen}
          aria-controls="store-mobile-navigation"
          onClick={openDrawer}
        >
          Menu
        </button>
        <CartContext />
        {!desktop ? (
          <>
            <Suspense fallback={<SearchForm />}>
              <UrlSearch />
            </Suspense>
            <Delivery />
          </>
        ) : null}
      </div>
      <nav aria-label="Mua sắm" className="store-header-secondary">
        <ul>
          {catalogLinks.map(({ label, href }) => (
            <li key={href}>
              <Link href={href}>{label}</Link>
            </li>
          ))}
        </ul>
      </nav>
      <dialog
        ref={drawerRef}
        id="store-mobile-navigation"
        className="store-drawer"
        aria-labelledby="store-drawer-title"
        onKeyDown={(event) => {
          if (event.key !== 'Tab') return;
          const controls = [
            ...event.currentTarget.querySelectorAll(
              'a[href], button:not([disabled])',
            ),
          ];
          const first = controls[0],
            last = controls.at(-1);
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }}
        onCancel={(event) => {
          event.preventDefault();
          closeDrawer();
        }}
        onClose={() => {
          setDrawerOpen(false);
          drawerTrigger.current?.focus();
        }}
      >
        <h2 id="store-drawer-title">Điều hướng MartHub</h2>
        <button className="button-secondary" onClick={closeDrawer}>
          Đóng điều hướng
        </button>
        <nav aria-label="Mua sắm trên di động">
          <ul>
            {catalogLinks.map(({ label, href }) => (
              <li key={href}>
                <Link href={href} onClick={closeDrawer}>
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <nav aria-label="Tài khoản trên di động">
          <h3>Tài khoản</h3>
          {accountReady ? (
            <AccountActions onNavigate={closeDrawer} />
          ) : (
            <AccountState />
          )}
        </nav>
      </dialog>
    </header>
  );
}
export function ShoppingHeader() {
  const pathname = usePathname() || '';
  const auth = useAuth();
  if (
    pathname.startsWith('/admin') ||
    pathname === '/login' ||
    pathname === '/register'
  )
    return null;
  return (
    <HeaderChrome key={`${pathname}:${auth.status}:${auth.user?.id || ''}`} />
  );
}
