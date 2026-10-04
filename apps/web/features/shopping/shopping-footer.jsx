'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '../auth/auth-provider';
import {
  accountLinks,
  canUseCustomerShopping,
  catalogLinks,
} from './storefront-links';

export function ShoppingFooter() {
  const pathname = usePathname() || '';
  const auth = useAuth();
  if (pathname.startsWith('/admin')) return null;
  const shoppingLinks = [
    ...catalogLinks,
    { label: 'Tìm kiếm', href: '/search' },
    ...(canUseCustomerShopping(auth)
      ? [{ label: 'Giỏ hàng', href: '/cart' }]
      : []),
  ];
  return (
    <footer className="store-footer" lang="vi">
      <div className="store-footer-inner">
        <div className="store-footer-brand">
          <Link
            aria-label="MartHub — Trang chủ"
            href="/"
            className="store-wordmark"
          >
            MartHub
          </Link>
          <p>Mua sắm cùng MartHub.</p>
        </div>
        <nav aria-labelledby="footer-shopping-title">
          <h2 id="footer-shopping-title">Mua sắm</h2>
          <ul>
            {shoppingLinks.map(({ label, href }) => (
              <li key={href}>
                <Link href={href}>{label}</Link>
              </li>
            ))}
          </ul>
        </nav>
        <nav aria-labelledby="footer-account-title">
          <h2 id="footer-account-title">Tài khoản</h2>
          {auth.status === 'loading' ? (
            <p role="status">Đang kiểm tra tài khoản…</p>
          ) : null}
          {auth.status === 'error' ? (
            <div>
              <p role="alert">Không tải được tài khoản.</p>
              <button
                className="store-text-button"
                onClick={() => auth.retry().catch(() => {})}
              >
                Thử lại tài khoản
              </button>
            </div>
          ) : null}
          <ul>
            {accountLinks(auth).map(({ label, href }) => (
              <li key={href}>
                <Link href={href}>{label}</Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </footer>
  );
}
