import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const user = {
  id: 'b2ecb79a-b74a-4748-93dc-f2fc02b93b3d',
  email: 'chrome@example.test',
  firstName: 'Minh',
  lastName: 'Nguyen',
  phone: null,
  role: 'CUSTOMER',
  status: 'ACTIVE',
};
const address = {
  id: 'da7a0000-0000-4000-8000-020000000001',
  label: 'Home',
  recipientName: 'Minh Nguyen',
  phone: '0901234567',
  line1: 'Private street not in header',
  line2: null,
  ward: 'Ward 1',
  district: 'Quận 1',
  province: 'Hồ Chí Minh',
  postalCode: null,
  isDefault: true,
};
const response = (route, data, status = 200) =>
  route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(data),
  });
const failure = {
  error: {
    code: 'SERVICE_UNAVAILABLE',
    message: 'Try again.',
    requestId: 'chrome_test',
  },
};
const session = (role = 'CUSTOMER') => ({
  data: {
    user: { ...user, role },
    accessToken: 'memory-only-test-token',
    expiresIn: 900,
  },
});

async function audit(page, name) {
  expect(
    await page.evaluate(
      () =>
        globalThis.document.documentElement.scrollWidth <=
        globalThis.innerWidth,
    ),
  ).toBe(true);
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.screenshot({
    path: `test-results/m92-${name}-${page.viewportSize().width}.png`,
    fullPage: true,
  });
}
async function openAccount(page) {
  if (page.viewportSize().width < 768) {
    const trigger = page.getByRole('button', {
      name: 'Mở điều hướng và tài khoản',
    });
    await trigger.click();
    return { trigger, menu: page.getByRole('dialog') };
  }
  const trigger = page
    .getByRole('banner')
    .getByRole('button', { name: /^Tài khoản:/ });
  await trigger.click();
  return {
    trigger,
    menu: page
      .getByRole('banner')
      .getByRole('navigation', { name: 'Tài khoản', exact: true }),
  };
}

test('guest search, truthful contexts, native focus order and footer routes work across viewports', async ({
  page,
}) => {
  await page.goto('/');
  const header = page.getByRole('banner'),
    footer = page.getByRole('contentinfo');
  await expect(header.getByText('Đăng nhập để chọn địa chỉ')).toBeVisible();
  await expect(header.getByLabel(/items in cart/)).toHaveCount(0);
  await expect(footer.getByRole('link', { name: 'Đăng ký' })).toHaveAttribute(
    'href',
    '/register',
  );
  await expect(header.locator('a[href*="featured"]')).toHaveCount(0);
  await page.keyboard.press('Tab');
  await expect(
    page.getByRole('link', { name: 'Skip to content' }),
  ).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(header.locator('.store-wordmark')).toBeFocused();
  await page.keyboard.press('Tab');
  if (page.viewportSize().width < 768) {
    const trigger = header.getByRole('button', {
      name: 'Mở điều hướng và tài khoản',
    });
    await expect(trigger).toBeFocused();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog');
    const close = dialog.getByRole('button', { name: 'Đóng điều hướng' });
    await expect(close).toBeFocused();
    await audit(page, 'guest-drawer');
    await page.keyboard.press('Shift+Tab');
    await expect(dialog.getByRole('link', { name: 'Đăng ký' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(close).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
    await expect(dialog).not.toBeVisible();
    await expect(header.locator('.store-header-secondary')).not.toBeVisible();
  } else {
    await expect(header.getByLabel('Search products')).toBeFocused();
    await expect(header.locator('.store-header-secondary')).toBeVisible();
    const searchBox = await header.getByRole('search').boundingBox();
    const brandBox = await header.locator('.store-wordmark').boundingBox();
    expect(searchBox.width).toBeGreaterThan(brandBox.width);
  }
  await header.getByLabel('Search products').fill('mug');
  await header.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page).toHaveURL('/search?q=mug');
  await expect(
    page.getByRole('banner').getByLabel('Search products'),
  ).toHaveValue('mug');
  await page.reload();
  await expect(
    page.getByRole('banner').getByLabel('Search products'),
  ).toHaveValue('mug');
  await page.getByRole('banner').getByLabel('Search products').fill('tote');
  await page
    .getByRole('banner')
    .getByRole('button', { name: 'Search', exact: true })
    .click();
  await expect(page).toHaveURL('/search?q=tote');
  await page.goBack();
  await expect(
    page.getByRole('banner').getByLabel('Search products'),
  ).toHaveValue('mug');
  await audit(page, 'guest');
});

test('Customer address/cart loading, errors/retry, authoritative default, menu and logout reuse providers', async ({
  page,
}) => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let mode = 'error',
    signedOut = false;
  await page.route('**/api/v1/auth/refresh', (route) =>
    response(route, signedOut ? failure : session(), signedOut ? 401 : 200),
  );
  await page.route('**/api/v1/auth/logout', (route) => {
    signedOut = true;
    return route.fulfill({ status: 204 });
  });
  await page.route('**/api/v1/wishlist', (route) =>
    response(route, { data: { id: null, items: [], itemCount: 0 } }),
  );
  // This chrome fixture uses a fake session; keep new homepage private reads
  // inside that fixture rather than sending its token to the real auth server.
  await page.route('**/api/v1/users/me/items?*', (route) =>
    response(route, {
      data: [],
      meta: { page: 1, perPage: 20, totalItems: 0, totalPages: 0 },
    }),
  );
  await page.route('**/api/v1/users/me/recommendations', (route) =>
    response(route, { data: { label: 'POPULAR', products: [] } }),
  );
  await page.route('**/api/v1/cart', async (route) => {
    await gate;
    return response(
      route,
      mode === 'error'
        ? failure
        : { data: { id: null, items: [], itemCount: 7 } },
      mode === 'error' ? 503 : 200,
    );
  });
  await page.route('**/api/v1/users/me/addresses', async (route) => {
    await gate;
    return response(
      route,
      mode === 'error'
        ? failure
        : {
            data:
              mode === 'none' ? [{ ...address, isDefault: false }] : [address],
          },
      mode === 'error' ? 503 : 200,
    );
  });
  await page.goto('/');
  const header = page.getByRole('banner');
  await expect(header.getByText('Đang tải địa chỉ…')).toBeVisible();
  await expect(header.getByLabel(/items in cart/)).toHaveCount(0);
  await expect(header.getByRole('link', { name: 'Giỏ hàng' })).toBeVisible();
  release();
  await expect(header.getByText('Không tải được địa chỉ')).toBeVisible();
  mode = 'none';
  await header.getByRole('button', { name: 'Thử lại địa chỉ' }).click();
  await expect(
    header.getByRole('link', { name: 'Thêm địa chỉ' }),
  ).toBeVisible();
  await header.getByRole('button', { name: 'Thử lại giỏ hàng' }).click();
  await expect(header.getByLabel('7 items in cart')).toBeVisible();
  await page.reload();
  mode = 'default';
  await page.reload();
  await expect(header.getByText('Quận 1, Hồ Chí Minh')).toBeVisible();
  await expect(header.getByText(/Private street|0901234567/)).toHaveCount(0);
  const { trigger, menu } = await openAccount(page);
  await expect(menu.getByRole('link', { name: 'My Items' })).toHaveAttribute(
    'href',
    '/account/my-items?tab=reorder',
  );
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  await audit(page, 'customer');
  const reopened = await openAccount(page);
  await reopened.menu
    .getByRole('button', { name: 'Đăng xuất', exact: true })
    .click();
  await expect(header.getByText('Đăng nhập để chọn địa chỉ')).toBeVisible();
  await expect(
    page.getByRole('contentinfo').getByRole('link', { name: 'Đăng nhập' }),
  ).toBeVisible();
  await expect(header.getByLabel(/items in cart/)).toHaveCount(0);
});

test('auth loading/error does not flash guest and recovers through existing retry', async ({
  page,
}) => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let ready = false;
  await page.route('**/api/v1/auth/refresh', async (route) => {
    await gate;
    return response(
      route,
      ready
        ? { ...failure, error: { ...failure.error, code: 'UNAUTHORIZED' } }
        : failure,
      ready ? 401 : 503,
    );
  });
  await page.goto('/');
  const footer = page.getByRole('contentinfo');
  await expect(footer.getByText('Đang kiểm tra tài khoản…')).toBeVisible();
  await expect(footer.getByRole('link', { name: 'Đăng nhập' })).toHaveCount(0);
  release();
  await expect(footer.getByText('Không tải được tài khoản.')).toBeVisible();
  ready = true;
  await footer.getByRole('button', { name: 'Thử lại tài khoản' }).click();
  await expect(footer.getByRole('link', { name: 'Đăng nhập' })).toBeVisible();
  await audit(page, 'auth-recovery');
});

test('Admin on storefront has only operational account links and makes no Customer chrome requests', async ({
  page,
}) => {
  const customerCalls = [];
  await page.route('**/api/v1/auth/refresh', (route) =>
    response(route, session('ADMIN')),
  );
  await page.route(
    /\/api\/v1\/(?:cart|wishlist|users\/me\/addresses)(?:[/?]|$)/u,
    (route) => {
      customerCalls.push(route.request().url());
      return response(route, failure, 403);
    },
  );
  await page.goto('/');
  const footer = page.getByRole('contentinfo');
  await expect(footer.getByRole('link', { name: 'Quản trị' })).toHaveAttribute(
    'href',
    '/admin',
  );
  await expect(page.getByRole('banner').getByText('Giao đến')).toHaveCount(0);
  await expect(footer.getByRole('link', { name: 'Giỏ hàng' })).toHaveCount(0);
  const { trigger, menu } = await openAccount(page);
  await expect(menu.getByRole('link', { name: 'Quản trị' })).toBeVisible();
  await expect(menu.getByRole('link', { name: 'My Items' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  expect(customerCalls).toEqual([]);
  await audit(page, 'admin-storefront');
});
