import { readFile } from 'node:fs/promises';
import { test, expect } from './helpers/security-test.js';

test('production HTML has unique trusted nonces, live hydration and exact Cloudinary image policy', async ({
  page,
  request,
}) => {
  const first = await request.get('/', {
    headers: {
      'x-nonce': 'forged-nonce',
      'Content-Security-Policy': "script-src 'unsafe-inline'",
    },
  });
  const second = await request.get('/');
  const policy = first.headers()['content-security-policy'];
  const nonce = policy.match(/'nonce-([^']+)'/)[1];
  expect(nonce).not.toBe('forged-nonce');
  expect(second.headers()['content-security-policy']).not.toBe(policy);
  expect(policy).not.toMatch(/unsafe-eval|script-src[^;]*unsafe-inline|\*/);
  expect(first.headers()['cache-control']).toContain('no-store');
  const html = await first.text();
  for (const [, attributes] of html.matchAll(/<script\b([^>]*)>/g))
    expect(attributes).toContain(`nonce="${nonce}"`);
  await page.goto('/products/cove-stoneware-mug');
  await expect(page.getByLabel('Quantity', { exact: true })).toBeVisible();
  await expect(page.locator('[hidden][id^="S:"]')).toHaveCount(0);
  await expect(page.locator('#product-structured-data')).toHaveCount(1);
  const jsonLdNonce = await page
    .locator('#product-structured-data')
    .evaluate((script) => script.nonce);
  expect(jsonLdNonce).toBeTruthy();
  await page.getByLabel('Quantity', { exact: true }).fill('2');
  await expect(page.getByLabel('Quantity', { exact: true })).toHaveValue('2');
  const image =
    'https://res.cloudinary.com/marthub-test/image/upload/smoke.svg';
  const svg = await readFile(
    new URL('../apps/web/public/brand/monogram.svg', import.meta.url),
  );
  await page.route(image, (route) =>
    route.fulfill({ contentType: 'image/svg+xml', body: svg }),
  );
  // The owned SVG fixture isolates delivery policy, not a production provider call.
  const loaded = await page.evaluate(
    (src) =>
      new Promise((resolve) => {
        const image = new globalThis.Image();
        image.onload = () => resolve(image.naturalWidth > 0);
        image.onerror = () => resolve(false);
        image.src = src;
      }),
    image,
  );
  expect(loaded).toBe(true);
  const health = await request.get('/api/v1/health/ready', {
    headers: { 'X-Request-Id': 'production_proxy_check' },
  });
  expect(health.status()).toBe(200);
  expect(health.headers()['x-request-id']).toBe('production_proxy_check');
});
