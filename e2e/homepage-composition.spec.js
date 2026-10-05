import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { openHomepage } from './helpers/settled-ui.js';

const id = (n) => `da7a0000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const promo = (
  n,
  placement = 'HERO_PRIMARY',
  internalHref = '/categories',
) => ({
  id: id(n),
  title: `MartHub story ${n}`,
  subtitle: 'Original MartHub supporting copy',
  image: null,
  placement,
  internalHref,
});
const category = (n) => ({
  id: id(100 + n),
  name: `Category ${n}`,
  slug: 'home-living',
  description: null,
  image: null,
  children: [{ id: id(200 + n), name: 'Hidden child', slug: 'child' }],
});
const response = (promotions = [], categories = []) => ({
  data: {
    promotions,
    categories,
    deals: [],
    newProducts: [],
    popularProducts: [],
  },
});
const browserErrors = new WeakMap();
test.beforeEach(async ({ page }) => {
  const errors = [];
  browserErrors.set(page, errors);
  page.on('pageerror', (error) => errors.push(error.message));
});
test.afterEach(async ({ page }) => expect(browserErrors.get(page)).toEqual([]));
async function fixture(page, payload) {
  await page.route('**/api/v1/homepage', (route) =>
    route.fulfill({ json: payload }),
  );
}
async function audit(page, label) {
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
    path: `test-results/m93-${label}-${page.viewportSize().width}.png`,
    fullPage: true,
  });
}

test('real homepage data selects backend stories/categories, verifies links and keeps chrome primary', async ({
  page,
  request,
}) => {
  const payload = await (await request.get('/api/v1/homepage')).json();
  const initialHtml = await (await request.get('/')).text();
  expect(initialHtml).toContain('class="home-mosaic home-mosaic-3"');
  expect(initialHtml).toContain('Make room for small rituals</h2>');
  expect(initialHtml).not.toContain('class="home-loading-media"');
  await openHomepage(page);
  await expect(page.locator('.home-mosaic .home-promo')).toHaveCount(3);
  expect(
    await page.locator('.home-mosaic .home-promo h2').allTextContents(),
  ).toEqual([
    'Make room for small rituals',
    'A calmer workday',
    'Carry what matters',
  ]);
  expect(await page.locator('.home-category > span').allTextContents()).toEqual(
    payload.data.categories.map((c) => c.name),
  );
  await expect(page.getByRole('banner').getByRole('searchbox')).toBeVisible();
  await expect(page.locator('.home-primary')).toBeInViewport();
  await expect(page.locator('.home-promo a')).toHaveCount(3);
  for (const href of await page
    .locator('.home-page a')
    .evaluateAll((nodes) => nodes.map((n) => n.getAttribute('href'))))
    expect((await request.get(href)).ok()).toBe(true);
  const primary = await page.locator('.home-primary').boundingBox();
  const secondary = await page.locator('.home-secondary').first().boundingBox();
  if (page.viewportSize().width >= 1024) {
    expect(primary.width / secondary.width).toBeGreaterThan(1.9);
    expect(Math.abs(primary.y - secondary.y)).toBeLessThan(2);
    const last = await page.locator('.home-secondary').last().boundingBox();
    expect(
      Math.abs(primary.y + primary.height - last.y - last.height),
    ).toBeLessThan(2);
  } else expect(secondary.y).toBeGreaterThan(primary.y + primary.height);
  await audit(page, 'seeded');
  const action = page.locator('.home-primary a');
  const destination = await action.getAttribute('href');
  await action.focus();
  await expect(action).toHaveCSS('outline-width', '2px');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(destination);
  await expect(
    page.getByRole('main').getByRole('heading', { level: 1 }),
  ).toBeVisible();
});

test('fallback selection, long copy, broken media and eight parent shortcuts retain stable geometry', async ({
  page,
}) => {
  const a = promo(1, 'HERO_SECONDARY');
  a.title = 'Original long MartHub title '.repeat(12);
  a.subtitle = 'Original supporting copy '.repeat(20);
  a.image = {
    url: 'http://127.0.0.1:13000/missing-promo.png',
    altText: a.title,
  };
  const stories = [
    a,
    promo(2, 'HERO_SECONDARY'),
    promo(3, 'EDITORIAL'),
    promo(4, 'EDITORIAL'),
  ];
  stories[1].image = {
    url: 'http://127.0.0.1:13000/brand/monogram.svg',
    altText: stories[1].title,
  };
  await fixture(
    page,
    response(
      stories,
      Array.from({ length: 8 }, (_, n) => category(n)),
    ),
  );
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  await page.route('**/missing-promo.png', async (route) => {
    await held;
    await route.fulfill({ status: 404, body: '' });
  });
  await openHomepage(page);
  await expect(page.locator('.home-mosaic .home-promo')).toHaveCount(3);
  expect(
    await page.locator('.home-mosaic .home-promo h2').allTextContents(),
  ).toEqual([a.title, 'MartHub story 2', 'MartHub story 3']);
  const before = await page.locator('.home-primary .home-media').boundingBox();
  release();
  await expect(page.locator('.home-primary img')).toHaveCount(0);
  await expect(
    page.locator('.home-primary .home-media-fallback'),
  ).toBeVisible();
  const after = await page.locator('.home-primary .home-media').boundingBox();
  expect(Math.abs(before.height - after.height)).toBeLessThan(1);
  expect(after.height).toBeGreaterThan(40);
  const loaded = page.locator('.home-secondary img');
  await expect(loaded).toBeVisible();
  await expect
    .poll(() => loaded.evaluate((img) => img.complete && img.naturalWidth > 0))
    .toBe(true);
  await expect(page.locator('.home-category')).toHaveCount(8);
  await expect(page.getByText('Hidden child')).toHaveCount(0);
  await expect(page.locator('.home-primary h2')).toHaveCSS(
    '-webkit-line-clamp',
    '2',
  );
  const columns = await page
    .locator('.home-category-grid')
    .evaluate(
      (el) =>
        globalThis.getComputedStyle(el).gridTemplateColumns.split(' ').length,
    );
  expect(columns).toBe(
    page.viewportSize().width >= 1024
      ? 8
      : page.viewportSize().width >= 768
        ? 4
        : 2,
  );
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await audit(page, 'fallback-long');
});

test('one/two/three and both-empty states omit empty slots and recover through real search', async ({
  page,
}) => {
  for (const count of [1, 2, 3, 0]) {
    await fixture(
      page,
      response(
        [
          promo(1, 'EDITORIAL'),
          promo(2, 'EDITORIAL'),
          promo(3, 'EDITORIAL'),
        ].slice(0, count),
      ),
    );
    await openHomepage(page);
    await expect(page.locator('.home-promo')).toHaveCount(count);
    await expect(page.getByText('Danh mục đang được cập nhật.')).toBeVisible();
    await expect(page.locator('.home-category')).toHaveCount(0);
    await audit(page, `partial-${count}`);
    await page.unroute('**/api/v1/homepage');
  }
  await expect(
    page.getByRole('heading', { name: 'Khám phá MartHub' }),
  ).toBeVisible();
  const link = page.getByRole('link', { name: 'Tìm sản phẩm', exact: true });
  await link.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL('/search');
  await expect(
    page.getByRole('main').getByRole('heading', { level: 1 }),
  ).toBeVisible();
});

test('unsafe/unavailable targets retain copy, homepage failure retries without fake content', async ({
  page,
}) => {
  await fixture(
    page,
    response([
      promo(1, 'HERO_PRIMARY', '/admin/orders'),
      promo(2, 'HERO_SECONDARY', '/products/m93-not-public'),
      promo(3, 'HERO_SECONDARY', '/search?featured=true'),
    ]),
  );
  const unavailable = page.waitForResponse((response) =>
    response.url().endsWith('/api/v1/products/m93-not-public'),
  );
  await openHomepage(page);
  expect((await unavailable).status()).toBe(404);
  await expect(page.locator('.home-promo')).toHaveCount(3);
  await expect(page.locator('.home-promo a')).toHaveCount(1);
  await expect(
    page.locator('.home-secondary').last().getByRole('link'),
  ).toHaveAttribute('href', '/search?featured=true');
  await audit(page, 'safe-destinations');
  await page.unroute('**/api/v1/homepage');
  let failed = true,
    release;
  const hold = new Promise((resolve) => {
    release = resolve;
  });
  await page.route('**/api/v1/homepage', async (route) => {
    if (failed) {
      await hold;
      await route.fulfill({
        status: 503,
        json: { error: { code: 'UNAVAILABLE', message: 'Temporary failure' } },
      });
    } else await route.fulfill({ json: response([], [category(1)]) });
  });
  await openHomepage(page);
  // Server bootstrap remains usable while client revalidation is held.
  await expect(page.locator('.home-mosaic .home-promo')).toHaveCount(3);
  await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0);
  await audit(page, 'bootstrap-revalidating');
  release();
  await expect(page.getByRole('main').getByRole('alert')).toContainText(
    'Không tải được',
  );
  await audit(page, 'error');
  failed = false;
  await page.getByRole('button', { name: 'Thử lại', exact: true }).click();
  await expect(page.locator('.home-category')).toHaveCount(1);
  await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0);
  await audit(page, 'retry-category-only');
});
