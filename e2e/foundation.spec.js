import { test, expect } from './helpers/security-test.js';
import AxeBuilder from '@axe-core/playwright';

test('storefront renders accessibly and recovers from missing pages', async ({
  page,
}, testInfo) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page).toHaveTitle('MartHub');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('MartHub');
  expect(
    await page.evaluate(
      () =>
        globalThis.document.documentElement.scrollWidth <=
        globalThis.innerWidth,
    ),
  ).toBe(true);
  await page.keyboard.press('Tab');
  await expect(
    page.getByRole('link', { name: 'Skip to content' }),
  ).toBeFocused();
  await expect(
    page.getByRole('link', { name: 'Skip to content' }),
  ).toBeInViewport();
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.screenshot({
    path: testInfo.outputPath('home.png'),
    fullPage: true,
  });
  const response = await page.goto('/missing-foundation-page');
  expect(response.status()).toBe(404);
  await expect(
    page.getByRole('heading', { name: 'Page not found' }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        globalThis.document.documentElement.scrollWidth <=
        globalThis.innerWidth,
    ),
  ).toBe(true);
  await page.getByRole('link', { name: 'Return to MartHub' }).click();
  await expect(page).toHaveURL('/');
  expect(errors).toEqual([]);
});

test('same-origin proxy preserves health contracts and request IDs', async ({
  request,
}) => {
  const response = await request.get('/api/v1/health/ready', {
    headers: { 'X-Request-Id': 'req_e2e' },
  });
  expect(response.status()).toBe(200);
  expect(response.headers()['x-request-id']).toBe('req_e2e');
  expect(await response.json()).toEqual({
    data: { status: 'ready', version: 'v1' },
  });
  const missing = await request.get('/api/v1/missing');
  expect(missing.status()).toBe(404);
  expect((await missing.json()).error.code).toBe('NOT_FOUND');
});
