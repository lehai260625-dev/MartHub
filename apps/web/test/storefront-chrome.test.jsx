import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { AuthProvider } from '../features/auth/auth-provider';
import { ShoppingProvider } from '../features/shopping/shopping-provider';
import { ShoppingHeader } from '../features/shopping/shopping-header';
import { ShoppingFooter } from '../features/shopping/shopping-footer';
import {
  accountLinks,
  catalogLinks,
} from '../features/shopping/storefront-links';

const location = vi.hoisted(() => ({ pathname: '/', query: '' }));
vi.mock('next/navigation', () => ({
  usePathname: () => location.pathname,
  useSearchParams: () => new URLSearchParams(location.query),
}));
const customer = {
  status: 'authenticated',
  user: {
    id: 'b2ecb79a-b74a-4748-93dc-f2fc02b93b3d',
    role: 'CUSTOMER',
    firstName: 'Minh',
  },
};
const guest = { status: 'guest', user: null };
const cart = { data: { id: null, items: [], itemCount: 0 } };
const address = {
  id: 'da7a0000-0000-4000-8000-020000000001',
  district: 'Quận 1',
  province: 'Hồ Chí Minh',
  line1: 'PRIVATE STREET',
  phone: 'PRIVATE PHONE',
  isDefault: true,
};

function mount(state = guest, supplied = {}) {
  const retry = supplied.retry || vi.fn(async () => {}),
    logout = supplied.logout || vi.fn(async () => {});
  const request =
    supplied.request ||
    vi.fn(async (path) =>
      path === '/users/me/addresses' ? { data: [] } : cart,
    );
  const session = {
    subscribe: () => () => {},
    getSnapshot: () => state,
    getServerSnapshot: () => state,
    bootstrap: async () => {},
    request,
    retry,
    signOut: logout,
  };
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const result = render(
    <QueryClientProvider client={client}>
      <AuthProvider session={session}>
        <ShoppingProvider>
          <ShoppingHeader />
          <ShoppingFooter />
        </ShoppingProvider>
      </AuthProvider>
    </QueryClientProvider>,
  );
  return { ...result, request, retry, logout };
}
beforeEach(() => {
  location.pathname = '/';
  location.query = '';
  window.matchMedia = vi.fn(() => ({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
    this.querySelector('button')?.focus();
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
});

describe('M9.2 storefront contracts', () => {
  it('renders guest delivery, search contract, real footer links and no made-up count/deals/legal claims', () => {
    location.query = 'q=mug';
    mount();
    const header = screen.getByRole('banner'),
      footer = screen.getByRole('contentinfo');
    expect(within(header).getByLabelText('Search products')).toHaveValue('mug');
    expect(within(header).getByRole('search')).toHaveAttribute(
      'action',
      '/search',
    );
    expect(
      within(header).getByText('Đăng nhập để chọn địa chỉ'),
    ).toHaveAttribute('href', '/login?returnTo=%2Faccount%2Faddresses');
    expect(
      within(header).queryByLabelText(/items in cart/),
    ).not.toBeInTheDocument();
    expect(within(footer).getByText('Đăng nhập')).toHaveAttribute(
      'href',
      '/login',
    );
    expect(within(footer).getByText('Đăng ký')).toHaveAttribute(
      'href',
      '/register',
    );
    expect(within(footer).getByText('Giỏ hàng')).toHaveAttribute(
      'href',
      '/cart',
    );
    expect(
      screen.queryByText(/Deals|Privacy|Terms|marketplace/i),
    ).not.toBeInTheDocument();
  });
  it('does not flash guest links or numeric counts during auth bootstrap', () => {
    mount({ status: 'loading', user: null });
    expect(
      screen.queryByRole('link', { name: 'Đăng nhập' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/items in cart/)).not.toBeInTheDocument();
    expect(
      within(screen.getByRole('banner')).getByRole('button', {
        name: 'Đang kiểm tra tài khoản…',
      }),
    ).toBeDisabled();
  });
  it('uses the existing auth retry for recoverable bootstrap errors', () => {
    const { retry } = mount({ status: 'error', user: null });
    fireEvent.click(
      within(screen.getByRole('banner')).getByRole('button', {
        name: 'Thử lại tài khoản',
      }),
    );
    expect(retry).toHaveBeenCalledOnce();
    expect(
      screen.queryByRole('link', { name: 'Đăng nhập' }),
    ).not.toBeInTheDocument();
  });
  it('shows only authoritative default location and stock count, not street/phone or subtotal', async () => {
    mount(customer, {
      request: vi.fn(async (path) =>
        path === '/users/me/addresses'
          ? {
              data: [
                { ...address, isDefault: false, district: 'Not default' },
                address,
              ],
            }
          : { data: { ...cart.data, itemCount: 3 } },
      ),
    });
    const header = screen.getByRole('banner');
    expect(
      await within(header).findByText('Quận 1, Hồ Chí Minh'),
    ).toHaveAttribute('href', '/account/addresses');
    expect(
      await within(header).findByLabelText('3 items in cart'),
    ).toBeVisible();
    expect(
      screen.queryByText(/PRIVATE STREET|PRIVATE PHONE|Not default|subtotal/i),
    ).not.toBeInTheDocument();
  });
  it('never chooses a non-default address on the client', async () => {
    mount(customer, {
      request: async (path) =>
        path === '/users/me/addresses'
          ? { data: [{ ...address, isDefault: false }] }
          : cart,
    });
    expect(await screen.findByText('Thêm địa chỉ')).toHaveAttribute(
      'href',
      '/account/addresses',
    );
    expect(screen.queryByText('Quận 1, Hồ Chí Minh')).not.toBeInTheDocument();
  });
  it('keeps loading address neutral and the cart usable without a fake badge', async () => {
    mount(customer, { request: () => new Promise(() => {}) });
    expect(await screen.findByText('Đang tải địa chỉ…')).toBeVisible();
    expect(
      within(screen.getByRole('banner')).getByRole('link', {
        name: 'Giỏ hàng',
      }),
    ).toHaveAttribute('href', '/cart');
    expect(screen.queryByLabelText(/items in cart/)).not.toBeInTheDocument();
  });
  it('offers localized address and cart retry, with no stale count treated as canonical', async () => {
    const request = vi.fn(async () => {
      throw new Error('private');
    });
    mount(customer, { request });
    const header = screen.getByRole('banner');
    await within(header).findByText('Không tải được địa chỉ');
    fireEvent.click(
      within(header).getByRole('button', { name: 'Thử lại địa chỉ' }),
    );
    fireEvent.click(
      await within(header).findByRole('button', { name: 'Thử lại giỏ hàng' }),
    );
    await waitFor(() =>
      expect(
        request.mock.calls.filter(([path]) => path === '/cart'),
      ).toHaveLength(2),
    );
    expect(screen.queryByLabelText(/items in cart/)).not.toBeInTheDocument();
    expect(screen.queryByText('private')).not.toBeInTheDocument();
  });
  it('Customer menu uses approved links and existing logout, with Escape focus restoration', async () => {
    const { logout } = mount(customer);
    const trigger = screen.getByRole('button', { name: 'Tài khoản: Minh' });
    fireEvent.click(trigger);
    const menu = within(screen.getByRole('banner')).getByRole('navigation', {
      name: 'Tài khoản',
      exact: true,
    });
    expect(within(menu).getByText('My Items')).toHaveAttribute(
      'href',
      '/account/my-items?tab=reorder',
    );
    await waitFor(() =>
      expect(within(menu).getByText('My Items')).toHaveFocus(),
    );
    fireEvent.keyDown(menu, { key: 'Escape' });
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(trigger);
    fireEvent.click(within(menu).getByText('Đăng xuất'));
    await waitFor(() => expect(logout).toHaveBeenCalledOnce());
    expect(
      within(screen.getByRole('contentinfo')).getByText('Đơn hàng'),
    ).toHaveAttribute('href', '/account/orders');
  });
  it('Admin-on-storefront gets admin navigation only, never Customer reads, cart or delivery', async () => {
    const { request } = mount({
      ...customer,
      user: { ...customer.user, role: 'ADMIN' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Tài khoản: Minh' }));
    expect(
      within(screen.getByRole('contentinfo')).getByText('Quản trị'),
    ).toHaveAttribute('href', '/admin');
    expect(screen.queryByText('Giao đến')).not.toBeInTheDocument();
    expect(screen.queryByText('Giỏ hàng')).not.toBeInTheDocument();
    expect(screen.queryByText('My Items')).not.toBeInTheDocument();
    expect(request).not.toHaveBeenCalled();
  });
  it('mobile drawer shares actions and restores trigger focus after Escape/cancel', () => {
    window.matchMedia = vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    mount();
    const trigger = screen.getByRole('button', {
      name: 'Mở điều hướng và tài khoản',
    });
    fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog', { name: 'Điều hướng MartHub' });
    expect(within(dialog).getByText('Đăng nhập')).toHaveAttribute(
      'href',
      '/login',
    );
    const close = within(dialog).getByRole('button', {
      name: 'Đóng điều hướng',
    });
    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
    expect(within(dialog).getByText('Đăng ký')).toHaveFocus();
    fireEvent.keyDown(within(dialog).getByText('Đăng ký'), { key: 'Tab' });
    expect(close).toHaveFocus();
    fireEvent(dialog, new Event('cancel', { cancelable: true }));
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });
  it('Admin shell receives neither storefront header nor footer', () => {
    location.pathname = '/admin';
    mount();
    expect(screen.queryByRole('banner')).not.toBeInTheDocument();
    expect(screen.queryByRole('contentinfo')).not.toBeInTheDocument();
  });
  it('focused auth pages keep the existing header exclusion and gain the real guest footer', () => {
    location.pathname = '/login';
    mount();
    expect(screen.queryByRole('banner')).not.toBeInTheDocument();
    expect(
      within(screen.getByRole('contentinfo')).getByText('Đăng ký'),
    ).toHaveAttribute('href', '/register');
  });
  it('approved link maps contain only router-backed destinations', () => {
    expect(catalogLinks.map(({ href }) => href)).toEqual(['/', '/categories']);
    expect(accountLinks(customer).map(({ href }) => href)).toEqual([
      '/account/my-items?tab=reorder',
      '/account/orders',
      '/account/profile',
      '/account/addresses',
    ]);
    expect(accountLinks({ status: 'error' })).toEqual([]);
    const destinations = [
      ...catalogLinks,
      ...accountLinks(guest),
      ...accountLinks(customer),
      { href: '/search' },
      { href: '/cart' },
      { href: '/admin' },
    ];
    for (const { href } of destinations) {
      const path = href.split('?')[0].slice(1);
      expect(
        ['app', 'app/(auth)'].some((root) =>
          ['js', 'jsx'].some((extension) =>
            existsSync(resolve(root, path, `page.${extension}`)),
          ),
        ),
      ).toBe(true);
    }
  });
});
