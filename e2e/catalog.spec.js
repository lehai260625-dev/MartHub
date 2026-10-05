import { expect, test } from './helpers/security-test.js';
import AxeBuilder from '@axe-core/playwright';

async function auditCatalog(page) {
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

test('category navigation and cards remain usable at the approved viewport', async ({
  page,
}) => {
  await page.goto('/categories');
  await expect(
    page.getByRole('heading', { name: 'Browse categories' }),
  ).toBeVisible();
  const department = page.locator('.category-card h2 a').first();
  await expect(department).toBeVisible();
  await department.click();
  await expect(page).toHaveURL(/\/category\/[a-z0-9-]+$/);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByRole('article').first()).toBeVisible();
  const cardBox = await page.getByRole('article').first().boundingBox();
  expect(cardBox.width).toBeLessThanOrEqual(page.viewportSize().width - 32);
  await auditCatalog(page);
});

test('search filters survive reload, browser history, and a shared URL', async ({
  page,
  browser,
}) => {
  const viewport = page.viewportSize();
  await page.goto(
    '/search?q=mug&minPrice=100000&availability=in-stock&sort=price-asc&perPage=12',
  );
  const disclosure = page.locator('details.catalog-filter-disclosure:visible');
  if (viewport.width < 1024) {
    await expect(disclosure.locator('summary')).toContainText('2 applied');
    await disclosure.locator('summary').click();
    await expect(disclosure.getByLabel('Minimum')).not.toBeVisible();
    await disclosure.locator('summary').click();
  }

  await expect(disclosure.getByLabel('Minimum')).toHaveValue('100000');
  await expect(disclosure.getByLabel('In stock')).toBeChecked();
  await expect(disclosure.getByLabel('Sort by')).toHaveValue('price-asc');
  await expect(page.getByRole('article').first()).toBeVisible();
  await page.reload();
  await expect(disclosure.getByLabel('Sort by')).toHaveValue('price-asc');

  await disclosure.getByLabel('Sort by').selectOption('price-desc');
  await disclosure.getByRole('button', { name: 'Apply filters' }).click();
  await expect(page).toHaveURL(/sort=price-desc/);
  await expect(page).toHaveURL(/q=mug/);
  await page.goBack();
  await expect(disclosure.getByLabel('Sort by')).toHaveValue('price-asc');

  const sharedUrl = page.url();
  const sharedContext = await browser.newContext({ viewport });
  const sharedPage = await sharedContext.newPage();
  try {
    await sharedPage.goto(sharedUrl);
    const sharedDisclosure = sharedPage.locator(
      'details.catalog-filter-disclosure:visible',
    );
    await expect(sharedDisclosure.getByLabel('Minimum')).toHaveValue('100000');
    await expect(sharedDisclosure.getByLabel('In stock')).toBeChecked();
    await expect(sharedDisclosure.getByLabel('Sort by')).toHaveValue(
      'price-asc',
    );
    await auditCatalog(sharedPage);
  } finally {
    await sharedContext.close();
  }
});
