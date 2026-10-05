import { expect, test } from '@playwright/test';

const origin = 'http://127.0.0.1:13000';

async function readJsonLd(page, id) {
  return page
    .locator(`#${id}`)
    .last()
    .evaluate((node) => JSON.parse(node.textContent));
}

test('catalog metadata, structured data, sitemap, and hidden-content handling are public-safe', async ({
  page,
  request,
}) => {
  await page.goto('/products/cove-stoneware-mug');
  await expect(page).toHaveTitle('Cove Stoneware Mug | MartHub');
  await expect(page.locator('meta[name="description"]').last()).toHaveAttribute(
    'content',
    /\S/,
  );
  const bot = await request.get('/products/cove-stoneware-mug', {
    headers: { 'User-Agent': 'bingbot' },
  });
  expect(bot.status()).toBe(200);
  const botHead = (await bot.text()).match(/<head>([\s\S]*?)<\/head>/)[1];
  expect(botHead).toMatch(/<meta name="description" content="[^"]+"/);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    'href',
    `${origin}/products/cove-stoneware-mug`,
  );
  const productData = await readJsonLd(page, 'product-structured-data');
  const product = productData['@graph'].find(
    (entry) => entry['@type'] === 'Product',
  );
  const breadcrumbs = productData['@graph'].find(
    (entry) => entry['@type'] === 'BreadcrumbList',
  );
  expect(product.offers).toMatchObject({
    priceCurrency: 'VND',
    price: '149000',
    availability: 'https://schema.org/InStock',
  });
  expect(product).not.toHaveProperty('aggregateRating');
  expect(breadcrumbs.itemListElement.at(-1).item).toBe(
    `${origin}/products/cove-stoneware-mug`,
  );

  await page.goto('/category/tabletop?sort=price-desc&page=2');
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    'href',
    `${origin}/category/tabletop`,
  );
  const categoryBreadcrumbs = await readJsonLd(page, 'category-breadcrumbs');
  expect(categoryBreadcrumbs.itemListElement.at(-1).item).toBe(
    `${origin}/category/tabletop`,
  );

  await page.goto('/search?q=mug');
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Search results' }),
  ).toBeVisible();
  await expect(
    page.getByRole('search', { name: 'Storefront search' }),
  ).toBeVisible();
  await expect(
    page.getByRole('search', { name: 'Catalog search' }),
  ).toBeVisible();
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    'href',
    `${origin}/search`,
  );
  await expect(page.locator('head meta[name="robots"]')).toHaveAttribute(
    'content',
    /noindex.*follow/,
  );

  await page.goto('/products/harbor-felt-organizer');
  await expect(
    page.getByRole('heading', { name: 'Page not found' }),
  ).toBeVisible();
  await expect(page.locator('head meta[name="robots"]')).toHaveAttribute(
    'content',
    /noindex/,
  );

  const sitemap = await request.get('/sitemap.xml');
  expect(sitemap.status()).toBe(200);
  expect(sitemap.headers()['content-type']).toContain('application/xml');
  const xml = await sitemap.text();
  expect(xml).toContain(`${origin}/category/tabletop`);
  expect(xml).toContain(`${origin}/products/cove-stoneware-mug`);
  expect(xml).toContain(`${origin}/products/pocket-zip-pouch`);
  expect(xml).not.toContain('harbor-felt-organizer');
  expect(xml).not.toContain('season-notes-planner');
  expect(xml).not.toContain(`${origin}/search`);
});
