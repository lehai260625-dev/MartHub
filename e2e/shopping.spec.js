import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createDatabase } from '../apps/api/src/db/client.js';
import { validateDatabaseUrl } from '../apps/api/src/config/env.js';
import { throttleKey } from '../apps/api/src/modules/auth/throttle.js';

const password = 'Test-only correct horse battery staple';

async function cleanAccount(email) {
  const database = createDatabase(
    validateDatabaseUrl(process.env.DATABASE_URL),
  );
  try {
    await database.prisma.user.deleteMany({ where: { email } });
    await database.prisma.authThrottle.deleteMany({
      where: {
        key: {
          in: ['register', 'login'].map((operation) =>
            throttleKey(operation, 'email', email),
          ),
        },
      },
    });
  } finally {
    await database.close();
  }
}

async function audit(page) {
  const overflow = await page.evaluate(() =>
    [...globalThis.document.querySelectorAll('body *')]
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.right > globalThis.innerWidth + 1 || rect.left < -1;
      })
      .map((element) => ({
        element: element.tagName.toLowerCase(),
        className: String(element.className || ''),
        text: element.textContent.trim().slice(0, 60),
      }))
      .slice(0, 10),
  );
  expect(overflow).toEqual([]);
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
        .analyze()
    ).violations,
  ).toEqual([]);
}

test('customer login return, cart, wishlist, counts and rollback work responsively', async ({
  page,
}) => {
  const email = `e2e-shopping-${randomUUID()}@example.test`;
  try {
    await page.goto('/wishlist');
    await expect(page).toHaveURL(/\/login\?returnTo=/);
    expect(new URL(page.url()).searchParams.get('returnTo')).toBe(
      '/account/my-items?tab=wishlist',
    );
    await page.goto('/cart');
    await expect(page).toHaveURL(/\/login\?returnTo=/);
    expect(new URL(page.url()).searchParams.get('returnTo')).toBe('/cart');
    await page.getByRole('link', { name: 'Create an account' }).click();
    await page.getByLabel('First name', { exact: true }).fill('Minh');
    await page.getByLabel('Last name', { exact: true }).fill('Nguyen');
    await page.getByLabel('Email', { exact: true }).fill(email);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page).toHaveURL('/cart');
    await expect(page.getByText('Your cart is empty')).toBeVisible();
    await expect(page.getByLabel('0 items in cart')).toBeVisible();

    await page.goto('/search?q=mug');
    const mug = page
      .getByRole('article')
      .filter({ hasText: 'Cove Stoneware Mug' });
    await mug.getByRole('button', { name: /add .* to cart/i }).click();
    await expect(mug.getByText('1 added to cart.')).toBeVisible();
    await expect(page.getByLabel('1 items in cart')).toBeVisible();
    await mug.getByRole('button', { name: /save .* to wishlist/i }).click();
    await expect(
      mug.getByRole('button', { name: /remove .* from wishlist/i }),
    ).toBeVisible();

    const departments = page.locator('details.store-menu');
    await departments.locator('summary').click();
    await departments.getByRole('link', { name: 'My Items' }).click();
    await expect(page).toHaveURL('/account/my-items?tab=wishlist');
    await expect(page.getByRole('heading', { name: 'My Items' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Wishlist' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(page.getByText('Cove Stoneware Mug')).toBeVisible();
    await audit(page);

    await page.getByRole('link', { name: /cart/i }).first().click();
    await expect(page).toHaveURL('/cart');
    const quantity = page.getByLabel('Quantity');
    await quantity.fill('2');
    await page.getByRole('button', { name: 'Update' }).click();
    await expect(page.getByText('Quantity updated.')).toBeVisible();
    await expect(page.getByLabel('2 items in cart')).toBeVisible();

    await page.route('**/api/v1/cart/items/*', async (route) => {
      if (route.request().method() !== 'PATCH') return route.continue();
      await route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({
          error: {
            code: 'PRODUCT_UNAVAILABLE',
            message: 'Unavailable.',
            requestId: 'e2e_stock_conflict',
          },
        }),
      });
    });
    await quantity.fill('3');
    await page.getByRole('button', { name: 'Update' }).click();
    await expect(page.getByText(/became unavailable/i)).toBeVisible();
    await expect(quantity).toHaveValue('2');
    await expect(page.getByLabel('2 items in cart')).toBeVisible();
    await audit(page);
  } finally {
    await cleanAccount(email);
  }
});
