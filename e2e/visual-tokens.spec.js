import { expect, test } from './helpers/security-test.js';
import AxeBuilder from '@axe-core/playwright';

test('original brand, system typography and keyboard focus render without overflow', async ({
  page,
}) => {
  await page.goto('/');
  const wordmark = page.getByRole('banner').locator('.store-wordmark');
  await expect(wordmark).toHaveText('MartHub');
  await expect(wordmark).toHaveCSS('color', 'rgb(15, 118, 110)');
  await expect(page.locator('body')).toHaveCSS('font-size', '16px');
  await expect(page.locator('body')).toHaveCSS('line-height', '24px');
  await page.keyboard.press('Tab');
  await expect(
    page.getByRole('link', { name: 'Skip to content' }),
  ).toBeFocused();
  await expect(page.getByRole('link', { name: 'Skip to content' })).toHaveCSS(
    'outline-width',
    '2px',
  );
  await expect(page.getByRole('link', { name: 'Skip to content' })).toHaveCSS(
    'outline-offset',
    '2px',
  );
  await page.keyboard.press('Tab');
  await expect(wordmark).toBeFocused();
  const iconHref = await page.locator('link[rel="icon"]').getAttribute('href');
  expect(iconHref).toContain('/icon.svg');
  const assetPreviews = [];
  for (const path of ['/brand/wordmark.svg', '/brand/monogram.svg', iconHref]) {
    const response = await page.request.get(path);
    expect(response.ok()).toBe(true);
    expect(response.headers()['content-type']).toContain('image/svg+xml');
    const svg = await response.text();
    expect(svg).toContain('#0F766E');
    assetPreviews.push(
      `<img alt="${path}" width="${path.includes('wordmark') ? 200 : 64}" src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}">`,
    );
  }
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
    path: `test-results/m91-home-${page.viewportSize().width}.png`,
    fullPage: true,
  });
  // Test-only asset sheet, not a homepage module or production route.
  const preview = await page.context().newPage();
  await preview.setContent(
    `<html lang="en"><head><title>MartHub original brand audit</title></head><body><main><h1>MartHub original assets</h1>${assetPreviews.join('')}</main></body></html>`,
  );
  await expect(preview.getByRole('img')).toHaveCount(3);
  await preview.screenshot({
    path: `test-results/m91-assets-${page.viewportSize().width}.png`,
  });
  await preview.close();
});

test('affected catalog geometry, active/disabled actions and reduced motion use finalized tokens', async ({
  page,
}) => {
  await page.goto('/search?q=mug');
  const card = page.locator('.product-card').first();
  await expect(card).toBeVisible();
  await expect(card).toHaveCSS('border-radius', '8px');
  const action = card.locator('.button-primary');
  await expect(action).toHaveCSS('background-color', 'rgb(15, 118, 110)');
  await expect(action).toHaveCSS('border-radius', '6px');
  await action.hover();
  await expect(action).toHaveCSS('background-color', 'rgb(17, 94, 89)');
  const box = await action.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect(action).toHaveCSS('background-color', 'rgb(19, 78, 74)');
  // Release outside the action: visual review must not submit a cart mutation.
  await page.mouse.move(0, 0);
  await page.mouse.up();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(action).toHaveCSS('transition-duration', '0s');
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
        .analyze()
    ).violations,
  ).toEqual([]);
  expect(
    await page.evaluate(
      () =>
        globalThis.document.documentElement.scrollWidth <=
        globalThis.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `test-results/m91-catalog-${page.viewportSize().width}.png`,
    fullPage: true,
  });
  await page.goto('/products/pocket-zip-pouch');
  const disabled = page.locator('.button-primary:disabled:visible');
  await expect(disabled).toBeVisible();
  await expect(disabled).toHaveCSS('opacity', '1');
  await expect(disabled).toHaveCSS('background-color', 'rgb(226, 232, 240)');
  await expect(disabled).toHaveCSS('color', 'rgb(100, 116, 139)');
  await expect(page.locator('.product-purchase-panel:visible')).toHaveCSS(
    'border-radius',
    '8px',
  );
});
