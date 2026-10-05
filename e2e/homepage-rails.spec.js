import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const id = (n) => `da7a0000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const product = (n) => ({
  id: id(n),
  slug: `m95-product-${n}`,
  sku: `M95-${n}`,
  name:
    n === 1
      ? 'Long original MartHub product name '.repeat(8)
      : `MartHub product ${n}`,
  shortDescription: null,
  image:
    n === 2
      ? {
          url: 'http://127.0.0.1:13000/m95-broken.png',
          altText: 'Original product',
        }
      : n === 3
        ? {
            url: 'http://127.0.0.1:13000/brand/monogram.svg',
            altText: 'Original product',
          }
        : null,
  price: n % 2 ? '9007199254740993' : '149000',
  compareAtPrice: n % 2 ? '9223372036854775807' : null,
  currency: 'VND',
  sellingUnit: 'each',
  badges: n % 2 ? ['SALE'] : [],
  availability: {
    status: n === 4 ? 'OUT_OF_STOCK' : 'IN_STOCK',
    canAddToCart: n !== 4,
  },
});
const payload = {
  data: {
    promotions: [],
    categories: [],
    deals: Array.from({ length: 8 }, (_, i) => product(i + 1)),
    newProducts: [product(20)],
    popularProducts: [],
  },
};
const empty = { data: { id: null, items: [], itemCount: 0 } };
async function fixture(page) {
  await page.route('**/api/v1/homepage', (route) =>
    route.fulfill({ json: payload }),
  );
  await page.route('**/m95-broken.png', (route) =>
    route.fulfill({ status: 404, body: '' }),
  );
  await page.route('**/api/v1/auth/refresh', (route) =>
    route.fulfill({
      json: {
        data: {
          user: {
            id: id(900),
            email: 'rail@example.test',
            firstName: 'Minh',
            lastName: 'Nguyen',
            role: 'CUSTOMER',
            status: 'ACTIVE',
          },
          accessToken: 'test-memory-only',
          expiresIn: 900,
        },
      },
    }),
  );
  for (const path of ['cart', 'wishlist'])
    await page.route(`**/api/v1/${path}`, (route) =>
      route.fulfill({ json: empty }),
    );
  await page.route('**/api/v1/users/me/addresses', (route) =>
    route.fulfill({ json: { data: [] } }),
  );
  await page.route('**/api/v1/users/me/items?*', (route) =>
    route.fulfill({
      json: {
        data: [],
        meta: { page: 1, perPage: 20, totalItems: 0, totalPages: 0 },
      },
    }),
  );
  await page.route('**/api/v1/users/me/recommendations', (route) =>
    route.fulfill({ json: { data: { label: 'POPULAR', products: [] } } }),
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
    path: `test-results/m95-${label}-${page.viewportSize().width}.png`,
    fullPage: true,
  });
}
test('rail density, natural scroll, arrows/boundaries, snap, keyboard, resize and motion', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await fixture(page);
  await page.goto('/');
  const section = page.locator('.home-products-deals'),
    rail = section.locator('.home-product-rail');
  await expect(rail.locator('.product-card')).toHaveCount(8);
  await expect(section.getByRole('button', { name: /Add Long/ })).toBeEnabled();
  await expect(section.getByRole('button', { name: /Add Long/ })).toHaveCSS(
    'color',
    'rgb(255, 255, 255)',
  );
  const width = page.viewportSize().width;
  const geometry = await rail.evaluate((el) => ({
    client: el.clientWidth,
    scroll: el.scrollWidth,
    card: el.querySelector('li').getBoundingClientRect().width,
    rect: el.getBoundingClientRect().toJSON(),
    cards: [...el.children].map((n) => n.getBoundingClientRect().toJSON()),
  }));
  expect(geometry.card).toBeGreaterThanOrEqual(160);
  expect(geometry.card).toBeLessThanOrEqual(230);
  expect(
    Math.abs(
      geometry.card - { 360: 160, 768: 200, 1024: 220, 1440: 230 }[width],
    ),
  ).toBeLessThan(8);
  expect(geometry.scroll).toBeGreaterThan(geometry.client);
  expect(
    geometry.cards.some(
      (c) => c.x < geometry.rect.right && c.right > geometry.rect.right,
    ),
  ).toBe(true);
  for (let i = 1; i < geometry.cards.length; i++)
    expect(geometry.cards[i].x).toBeGreaterThan(geometry.cards[i - 1].right);
  // Chromium serializes the default proximity keyword as just "x".
  await expect(rail).toHaveCSS('scroll-snap-type', /^x(?: proximity)?$/);
  await expect(rail.locator('li').first()).toHaveCSS(
    'scroll-snap-align',
    'start',
  );
  const next = section.getByRole('button', { name: 'Cuộn Deals sang phải' }),
    prev = section.getByRole('button', { name: 'Cuộn Deals sang trái' });
  await expect(
    page.locator('.home-products-new .home-rail-controls'),
  ).toHaveCount(0);
  if (width < 768) {
    await expect(next).not.toBeVisible();
    await rail.hover();
    await page.mouse.wheel(270, 0);
    await expect
      .poll(() => rail.evaluate((el) => el.scrollLeft))
      .toBeGreaterThan(100);
    await rail.evaluate((el) => el.scrollTo({ left: 0, behavior: 'instant' }));
    const box = await rail.boundingBox();
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setTouchEmulationEnabled', {
      enabled: true,
      maxTouchPoints: 1,
    });
    const y = Math.max(40, Math.min(800, box.y + 80));
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: 290, y }],
    });
    for (const x of [260, 230, 200, 170, 140, 110])
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x, y }],
      });
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [],
    });
    await expect
      .poll(() => rail.evaluate((el) => el.scrollLeft))
      .toBeGreaterThan(80);
    await cdp.detach();
  } else {
    await expect(next).toBeVisible();
    await expect(prev).toBeDisabled();
    await next.focus();
    await expect(next).toHaveCSS('outline-width', '2px');
    await page.keyboard.press('Enter');
    await expect
      .poll(() => rail.evaluate((el) => el.scrollLeft))
      .toBeGreaterThan(
        Math.min(geometry.client * 0.65, geometry.scroll - geometry.client - 1),
      );
    await expect(prev).toBeEnabled();
    expect(await rail.evaluate((el) => el.scrollLeft)).toBeLessThan(
      geometry.client * 1.1,
    );
  }
  await rail.evaluate((el) =>
    el.scrollTo({ left: el.scrollWidth, behavior: 'instant' }),
  );
  if (width >= 768) await expect(next).toBeDisabled();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  // Record actual browser API options rather than infer smoothing from final position.
  await rail.evaluate((el) => {
    el._moves = [];
    const original = el.scrollBy.bind(el);
    el.scrollBy = (options) => {
      el._moves.push(options);
      original(options);
    };
  });
  if (width >= 768) {
    await prev.click();
    expect(await rail.evaluate((el) => el._moves.at(-1).behavior)).toBe('auto');
  }
  await rail.evaluate((el) => el.scrollTo({ left: 0, behavior: 'instant' }));
  await audit(page, 'rail');
  await page.setViewportSize({ width: 768, height: 900 });
  await expect(next).toBeVisible();
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await next.click();
  expect(await rail.evaluate((el) => el._moves.at(-1).behavior)).toBe('smooth');
  await page.setViewportSize({ width: 360, height: 900 });
  await expect(next).not.toBeVisible();
  expect(errors).toEqual([]);
});

test('equal media/cards, full exact prices, missing/broken images and action feedback stay stable', async ({
  page,
}) => {
  await fixture(page);
  let fail = false;
  const cart = {
    data: {
      id: id(800),
      items: [
        {
          id: id(801),
          productId: id(1),
          quantity: 1,
          availability: 'IN_STOCK',
          product: product(1),
        },
      ],
      itemCount: 1,
    },
  };
  await page.route('**/api/v1/cart/items', (route) =>
    route.fulfill(
      fail
        ? {
            status: 503,
            json: {
              error: {
                code: 'SERVICE_UNAVAILABLE',
                message: 'Temporary failure',
                requestId: 'm95',
              },
            },
          }
        : { json: cart },
    ),
  );
  await page.route(`**/api/v1/wishlist/items/${id(1)}`, (route) =>
    route.fulfill({
      json: {
        data: {
          id: id(802),
          items: [
            {
              id: id(803),
              productId: id(1),
              availability: 'IN_STOCK',
              product: product(1),
            },
          ],
          itemCount: 1,
        },
      },
    }),
  );
  await page.goto('/');
  const rail = page.locator('#home-rail-deals'),
    cards = rail.locator('.product-card');
  const first = cards.first(),
    add = first.getByRole('button', { name: /Add Long/ });
  await expect(page.getByRole('main')).toHaveAttribute('lang', 'vi');
  await expect(first).toHaveAttribute('lang', 'en');
  expect(await add.evaluate((node) => node.closest('[lang]').lang)).toBe('en');
  await expect(add).toBeEnabled();
  await expect(cards.nth(1).locator('img')).toHaveCount(0);
  await expect(cards.nth(1).getByText('MH')).toBeVisible();
  await expect(cards.nth(2).locator('img')).toHaveCount(1);
  const heights = await cards.evaluateAll((nodes) =>
    nodes.map((n) => n.getBoundingClientRect().height),
  );
  expect(Math.max(...heights) - Math.min(...heights)).toBeLessThan(1);
  const medias = await rail.locator('.product-media').evaluateAll((nodes) =>
    nodes.map((n) => {
      const r = n.getBoundingClientRect();
      return { width: r.width, height: r.height };
    }),
  );
  for (const media of medias)
    expect(Math.abs(media.width - media.height)).toBeLessThan(1);
  await expect(first.locator('.product-name')).toHaveCSS(
    '-webkit-line-clamp',
    '2',
  );
  await expect(first).toContainText('9.007.199.254.740.993');
  await expect(first).toContainText('9.223.372.036.854.775.807');
  await expect(
    cards.nth(3).getByRole('button', { name: /out of stock/ }),
  ).toBeDisabled();
  await add.click();
  await expect(first.locator('.action-feedback')).toContainText(
    'added to cart',
  );
  expect(
    Math.abs((await first.boundingBox()).height - heights[0]),
  ).toBeLessThan(1);
  fail = true;
  await add.click();
  await expect(first.locator('.action-feedback')).toContainText(
    'Could not add',
  );
  expect(
    Math.abs((await first.boundingBox()).height - heights[0]),
  ).toBeLessThan(1);
  await first.getByRole('button', { name: /Save Long/ }).click();
  await expect(first.locator('.wishlist-feedback')).toContainText(
    'Saved to wishlist',
  );
  expect(
    Math.abs((await first.boundingBox()).height - heights[0]),
  ).toBeLessThan(1);
  const name = first.locator('.product-name a');
  await page.keyboard.press('Tab');
  await name.focus();
  await expect(name).toHaveCSS('outline-width', '2px');
  const focus = await name.boundingBox(),
    clip = await rail.boundingBox();
  expect(focus.x - 4).toBeGreaterThanOrEqual(clip.x - 1);
  expect(focus.x + focus.width + 4).toBeLessThanOrEqual(
    clip.x + clip.width + 1,
  );
  await audit(page, 'feedback');
  for (const button of await first.getByRole('button').all()) {
    const box = await button.boundingBox();
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
});
