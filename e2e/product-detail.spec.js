import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

async function auditProduct(page) {
  await expect(page).toHaveTitle(/\S/u);
  expect(
    await page.evaluate(
      // eslint-disable-next-line no-undef -- This callback runs in the browser page.
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
        .analyze()
    ).violations,
  ).toEqual([]);
}

test('guest opens an active product from search and sees a usable missing-image PDP', async ({
  page,
}) => {
  await page.goto('/search?q=mug');
  await page
    .getByRole('link', { name: 'Cove Stoneware Mug', exact: true })
    .click();
  await expect(page).toHaveURL('/products/cove-stoneware-mug');
  const product = page.locator('main#main-content:visible');
  await expect(
    product.getByRole('heading', { name: 'Cove Stoneware Mug' }),
  ).toBeVisible();
  await expect(product.getByText('149.000')).toBeVisible();
  await expect(product.getByText('Sale')).toBeVisible();
  await expect(product.getByText('In stock')).toBeVisible();
  await expect(product.getByLabel('Quantity')).toBeEnabled();
  const addToCart = product.getByRole('button', {
    name: 'Add to cart: Cove Stoneware Mug',
    exact: true,
  });
  await expect(addToCart).toBeEnabled();
  await expect(
    product.getByRole('img', {
      name: 'No image available for Cove Stoneware Mug',
    }),
  ).toContainText('Image unavailable');
  await auditProduct(page);
  await addToCart.click();
  await expect(page).toHaveURL(/\/login\?returnTo=/u);
  expect(new URL(page.url()).searchParams.get('returnTo')).toBe(
    '/products/cove-stoneware-mug',
  );
  await page.goto('/products/harbor-felt-organizer');
  await expect(
    page.getByRole('heading', { name: 'Page not found' }),
  ).toBeVisible();
});

test('out-of-stock product remains identifiable with purchase controls unavailable', async ({
  page,
}) => {
  await page.goto('/products/pocket-zip-pouch');
  const product = page.locator('main#main-content:visible');
  await expect(
    product.getByRole('heading', { name: 'Pocket Zip Pouch' }),
  ).toBeVisible();
  await expect(product.locator('#product-availability')).toHaveText(
    'Out of stock',
  );
  await expect(product.getByLabel('Quantity')).toBeDisabled();
  await expect(
    product.getByRole('button', { name: 'Out of stock' }),
  ).toBeDisabled();
  await expect(
    product.getByRole('img', {
      name: 'No image available for Pocket Zip Pouch',
    }),
  ).toBeVisible();
  await auditProduct(page);
});
