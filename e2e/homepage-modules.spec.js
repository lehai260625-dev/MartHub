import { expect, test } from './helpers/security-test.js';
import AxeBuilder from '@axe-core/playwright';
import { openHomepage, waitForSettledUi } from './helpers/settled-ui.js';

const id = (n) => `da7a0000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const product = (n, available = true) => ({
  id: id(n),
  slug: 'ceramic-everyday-mug',
  sku: `M94-${n}`,
  name: `MartHub product ${n}`,
  shortDescription: null,
  image: null,
  price: '9007199254740993',
  compareAtPrice: null,
  currency: 'VND',
  sellingUnit: 'each',
  badges: [],
  availability: {
    status: available ? 'IN_STOCK' : 'OUT_OF_STOCK',
    canAddToCart: available,
  },
});
const promotion = (n) => ({
  id: id(100 + n),
  title: `MartHub editorial ${n}`,
  subtitle: 'Original API-supplied copy',
  image: null,
  internalHref: '/categories',
  placement: n === 0 ? 'HERO_PRIMARY' : n < 3 ? 'HERO_SECONDARY' : 'EDITORIAL',
});
const publicData = () => ({
  data: {
    promotions: Array.from({ length: 6 }, (_, n) => promotion(n)),
    categories: [],
    deals: [product(1, false), product(2)],
    newProducts: [product(2), product(3), product(4)],
    popularProducts: [product(2), product(4), product(5)],
  },
});
const item = (n, availability = 'IN_STOCK') => ({
  productId: id(n),
  purchaseCount: 2,
  lastPurchasedAt: '2026-10-05T00:00:00.000Z',
  orderId: id(999),
  snapshot: {
    sku: 'PAST',
    productName: 'Historical unavailable item',
    imageUrl: null,
    sellingUnit: 'each',
  },
  currentProduct:
    availability === 'UNAVAILABLE'
      ? null
      : product(n, availability === 'IN_STOCK'),
  currentPrice: availability === 'UNAVAILABLE' ? null : '9007199254740993',
  availability,
});
const items = (rows) => ({
  data: rows,
  meta: {
    page: 1,
    perPage: 20,
    totalItems: rows.length,
    totalPages: rows.length ? 1 : 0,
  },
});
const user = {
  id: id(900),
  email: 'm94@example.test',
  firstName: 'Minh',
  lastName: 'Nguyen',
  role: 'CUSTOMER',
  status: 'ACTIVE',
  phone: null,
};
const failure = {
  error: {
    code: 'SERVICE_UNAVAILABLE',
    message: 'Temporary failure',
    requestId: 'm94_test',
  },
};
async function fixture(page, role = 'guest') {
  const privateRequests = [];
  page.on('request', (request) => {
    if (/\/users\/me\/(items|recommendations)/.test(request.url()))
      privateRequests.push(request.url());
  });
  await page.route('**/api/v1/homepage', (route) =>
    route.fulfill({ json: publicData() }),
  );
  await page.route('**/api/v1/auth/refresh', (route) =>
    role === 'guest'
      ? route.fulfill({
          status: 401,
          json: { error: { code: 'UNAUTHENTICATED', message: 'Sign in' } },
        })
      : route.fulfill({
          json: {
            data: {
              user: { ...user, role },
              accessToken: 'test-memory-only',
              expiresIn: 900,
            },
          },
        }),
  );
  await page.route('**/api/v1/cart', (route) =>
    route.fulfill({
      json: {
        data: {
          id: null,
          items: [],
          itemCount: 0,
        },
      },
    }),
  );
  await page.route('**/api/v1/wishlist', (route) =>
    route.fulfill({ json: { data: { id: null, items: [], itemCount: 0 } } }),
  );
  await page.route('**/api/v1/users/me/addresses', (route) =>
    route.fulfill({ json: { data: [] } }),
  );
  return privateRequests;
}
async function audit(page, name) {
  await waitForSettledUi(page);
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
    path: `test-results/m94-${name}-${page.viewportSize().width}.png`,
    fullPage: true,
  });
}
const errors = new WeakMap();
test.beforeEach(async ({ page }) => {
  const messages = [];
  errors.set(page, messages);
  page.on('pageerror', (error) => messages.push(error.message));
});
test.afterEach(async ({ page }) => expect(errors.get(page)).toEqual([]));

test('guest public rhythm, exact prices, duplicate exclusion and editorial destinations', async ({
  page,
}) => {
  const requests = await fixture(page);
  await openHomepage(page);
  await expect(page.locator('.home-products')).toHaveCount(3);
  expect(await page.locator('.home-products h2').allTextContents()).toEqual([
    'Deals',
    'Sản phẩm phổ biến',
    'Sản phẩm mới',
  ]);
  await expect(page.locator('.home-products .product-card')).toHaveCount(5);
  await expect(
    page.locator('.home-products-deals a[href*="featured"]'),
  ).toHaveCount(0);
  await expect(
    page.locator('.home-products-deals .home-section-heading a'),
  ).toHaveCount(0);
  await expect(
    page.locator('.home-products-new .home-section-heading a'),
  ).toHaveAttribute('href', '/search?sort=newest');
  await expect(
    page
      .locator('.home-products .product-card')
      .first()
      .getByRole('button', { name: /out of stock/i }),
  ).toBeDisabled();
  await expect(
    page.locator('.home-products .product-card').first(),
  ).toContainText('9.007.199.254.740.993');
  await expect(page.locator('.home-editorial article')).toHaveCount(2);
  expect(await page.locator('.home-editorial h2').allTextContents()).toEqual([
    'MartHub editorial 3',
    'MartHub editorial 4',
  ]);
  await expect(page.getByText('MartHub editorial 5')).toHaveCount(0);
  const headings = await page.locator('.home-page h2').allTextContents();
  expect(headings.indexOf('MartHub editorial 3')).toBeGreaterThan(
    headings.indexOf('Sản phẩm mới'),
  );
  const action = page.locator('.home-editorial a').first();
  await action.focus();
  await expect(action).toHaveCSS('outline-width', '2px');
  await page.keyboard.press('Tab');
  await expect(page.locator('.home-editorial a').last()).toBeFocused();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await audit(page, 'guest');
  expect(requests).toEqual([]);
  await action.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL('/categories');
});

test('Customer separate repurchase and truthful personalized/popular fallback, bounded requests', async ({
  page,
}) => {
  const requests = await fixture(page, 'CUSTOMER');
  let label = 'PERSONALIZED';
  await page.route('**/api/v1/users/me/items?*', (route) =>
    route.fulfill({
      json: items([
        item(2),
        item(6),
        item(7, 'UNAVAILABLE'),
        item(8, 'OUT_OF_STOCK'),
      ]),
    }),
  );
  await page.route('**/api/v1/users/me/recommendations', (route) =>
    route.fulfill({
      json: { data: { label, products: [product(6), product(9)] } },
    }),
  );
  await openHomepage(page);
  await expect(
    page.locator('.home-products-repurchase .product-card'),
  ).toHaveCount(1);
  await expect(page.locator('.home-products-recommendations h2')).toHaveText(
    'Gợi ý cho bạn',
  );
  expect(await page.locator('.home-products h2').allTextContents()).toEqual([
    'Deals',
    'Mua lại',
    'Gợi ý cho bạn',
    'Sản phẩm mới',
    'Sản phẩm phổ biến',
  ]);
  await expect(page.locator('.home-products-repurchase')).toContainText(
    'MartHub product 6',
  );
  await expect(page.getByText('Historical unavailable item')).toHaveCount(0);
  await expect(
    page.locator('.home-products-recommendations .product-card'),
  ).toHaveCount(1);
  await expect(
    page.locator('.home-products-recommendations .home-section-heading a'),
  ).toHaveCount(0);
  expect(requests).toHaveLength(2);
  expect(requests[0]).toContain('/items?page=1&sort=recent');
  await audit(page, 'customer-personalized');
  label = 'POPULAR';
  await page.reload();
  await expect(page.locator('.home-products-recommendations h2')).toHaveText(
    'Sản phẩm phổ biến',
  );
  await expect(
    page.getByRole('heading', { name: 'Gợi ý cho bạn' }),
  ).toHaveCount(0);
  await audit(page, 'customer-popular');
  const link = page.locator(
    '.home-products-repurchase .home-section-heading a',
  );
  await expect(link).toHaveAttribute('href', '/account/my-items?tab=reorder');
  await link.focus();
  await expect(link).toHaveCSS('outline-width', '2px');
});

test('private loading/error/retry and empty purchases do not block public content', async ({
  page,
}) => {
  await fixture(page, 'CUSTOMER');
  await page.route('**/api/v1/users/me/items?*', (route) =>
    route.fulfill({ json: items([]) }),
  );
  let fail = true,
    release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  await page.route('**/api/v1/users/me/recommendations', async (route) => {
    if (fail) {
      await held;
      await route.fulfill({ status: 503, json: failure });
    } else
      await route.fulfill({
        json: { data: { label: 'POPULAR', products: [] } },
      });
  });
  await openHomepage(page);
  await expect(page.locator('.home-products-deals')).toBeVisible();
  const readyCart = page.getByRole('button', {
    name: 'Add to cart: MartHub product 2',
  });
  await expect(readyCart).toBeEnabled();
  // Wait for the approved disabled -> ready color transition before axe snapshots.
  await expect(readyCart).toHaveCSS('color', 'rgb(255, 255, 255)');
  await expect(
    page.locator('.home-private-state [role="status"]'),
  ).toBeVisible();
  await audit(page, 'private-loading');
  release();
  const retry = page.getByRole('button', { name: 'Thử lại: Gợi ý sản phẩm' });
  await expect(retry).toBeVisible();
  await expect(page.locator('.home-products-repurchase')).toHaveCount(0);
  await expect(
    page.getByRole('heading', { name: 'Gợi ý cho bạn' }),
  ).toHaveCount(0);
  await audit(page, 'private-error');
  fail = false;
  await retry.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.home-private-state')).toHaveCount(0);
  await expect(page.locator('.home-products-recommendations')).toHaveCount(0);
  await audit(page, 'private-empty');
});

test('Admin public state and zero/one/two editorial partial/empty composition', async ({
  page,
}) => {
  const requests = await fixture(page, 'ADMIN');
  for (const count of [0, 1, 2]) {
    const payload = publicData();
    payload.data.promotions = payload.data.promotions.slice(0, 3 + count);
    payload.data.deals = [];
    payload.data.newProducts = [];
    payload.data.popularProducts = [];
    await page.route('**/api/v1/homepage', (route) =>
      route.fulfill({ json: payload }),
    );
    await openHomepage(page);
    await expect(page.locator('.home-mosaic .home-promo')).toHaveCount(3);
    await expect(page.locator('.home-products')).toHaveCount(0);
    await expect(page.locator('.home-editorial article')).toHaveCount(count);
    await audit(page, `admin-empty-editorial-${count}`);
    await page.unroute('**/api/v1/homepage');
  }
  expect(requests).toEqual([]);
});
