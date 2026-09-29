import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const admin = {
  id: 'b2ecb79a-b74a-4748-93dc-f2fc02b93b3d',
  email: 'admin@example.test',
  firstName: 'Admin',
  lastName: 'User',
  phone: null,
  role: 'ADMIN',
  status: 'ACTIVE',
};
const category = {
  id: '37578ca4-f54b-4d06-9d46-09e0907e5751',
  parentId: null,
  name: 'Home',
  slug: 'home',
  description: null,
  status: 'ACTIVE',
  sortOrder: 0,
  archivedAt: null,
  parent: null,
  childCount: 0,
  productCount: 0,
};
function product(overrides = {}) {
  return {
    id: '0e7b73b7-9db0-4ae0-80b5-08e4049162cf',
    categoryId: category.id,
    sku: 'MHB-OPS-001',
    name: 'Desk lamp',
    slug: 'desk-lamp',
    shortDescription: 'A focused desk light.',
    description: null,
    brand: 'MartHub Studio',
    sellingUnit: 'each',
    status: 'DRAFT',
    isFeatured: false,
    isNew: true,
    isPopular: false,
    publishedAt: null,
    archivedAt: null,
    category: {
      id: category.id,
      name: category.name,
      slug: category.slug,
      status: 'ACTIVE',
    },
    price: '349000',
    compareAtPrice: null,
    quantityOnHand: 0,
    imageCount: 0,
    ...overrides,
  };
}

test('admin creates, edits, publishes, and archives a product responsively', async ({
  page,
}) => {
  let rows = [];
  await page.route('**/api/v1/auth/refresh', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          user: admin,
          accessToken: 'browser-memory-only-token',
          expiresIn: 900,
        },
      }),
    }),
  );
  await page.route('**/api/v1/admin', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'Cache-Control': 'no-store' },
      body: JSON.stringify({ data: { user: admin } }),
    }),
  );
  await page.route('**/api/v1/admin/categories', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'Cache-Control': 'no-store' },
      body: JSON.stringify({ data: [category] }),
    }),
  );
  await page.route('**/api/v1/admin/products**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const parts = url.pathname.split('/').filter(Boolean);
    const productId = parts[parts.indexOf('products') + 1];
    const command = parts.at(-1);
    let status = 200;
    let body;
    if (request.method() === 'GET' && !productId) {
      body = {
        data: rows,
        meta: {
          page: 1,
          perPage: 24,
          totalItems: rows.length,
          totalPages: rows.length ? 1 : 0,
        },
      };
    } else if (request.method() === 'POST' && !productId) {
      const input = request.postDataJSON();
      const created = product({
        ...input,
        compareAtPrice: input.compareAtPrice ?? null,
      });
      rows = [created];
      status = 201;
      body = { data: created };
    } else if (request.method() === 'PATCH' && productId) {
      const input = request.postDataJSON();
      rows = rows.map((row) =>
        row.id === productId ? { ...row, ...input } : row,
      );
      body = { data: rows.find(({ id }) => id === productId) };
    } else if (request.method() === 'POST' && command === 'publish') {
      rows = rows.map((row) =>
        row.id === productId
          ? {
              ...row,
              status: 'ACTIVE',
              publishedAt: '2026-09-20T00:00:00.000Z',
            }
          : row,
      );
      body = { data: rows.find(({ id }) => id === productId) };
    } else if (request.method() === 'POST' && command === 'archive') {
      rows = rows.map((row) =>
        row.id === productId
          ? {
              ...row,
              status: 'ARCHIVED',
              archivedAt: '2026-09-20T00:00:00.000Z',
            }
          : row,
      );
      body = { data: rows.find(({ id }) => id === productId) };
    } else {
      status = 404;
      body = { error: { code: 'NOT_FOUND', message: 'Not found.' } };
    }
    await route.fulfill({
      status,
      contentType: 'application/json',
      headers: { 'Cache-Control': 'no-store' },
      body: JSON.stringify(body),
    });
  });

  await page.goto('/admin');
  await page.getByRole('link', { name: 'Products' }).click();
  await expect(page).toHaveURL('/admin/products');
  await expect(
    page.getByRole('heading', { name: 'Product management' }),
  ).toBeVisible();
  await expect(page.getByText('No products found.')).toBeVisible();

  await page.getByLabel('Product name').fill('Desk lamp');
  await page.getByLabel('SKU').fill('MHB-OPS-001');
  await page.getByLabel('URL slug').fill('desk-lamp');
  await page.getByLabel('Price (VND)', { exact: true }).fill('349000');
  await page.getByRole('button', { name: 'Create draft' }).click();
  await expect(
    page.getByText('Desk lamp was created as a draft.'),
  ).toBeVisible();
  await expect(
    page.getByRole('rowheader', { name: /Desk lamp/ }),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Edit Desk lamp' }).click();
  await expect(page.getByLabel('SKU')).toHaveAttribute('readonly', '');
  await expect(page.getByLabel('Price (VND)', { exact: true })).toHaveAttribute(
    'readonly',
    '',
  );
  await page.getByLabel('Product name').fill('Focused desk lamp');
  await page.getByRole('button', { name: 'Save product' }).click();
  await expect(page.getByText('Focused desk lamp was updated.')).toBeVisible();

  await page.getByRole('button', { name: 'Publish Focused desk lamp' }).click();
  await expect(
    page.getByText('Focused desk lamp was published.'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Archive Focused desk lamp' }).click();
  await expect(page.getByText('Archive Focused desk lamp?')).toBeVisible();
  await page.getByRole('button', { name: 'Confirm archive' }).click();
  await expect(page.getByText('Focused desk lamp was archived.')).toBeVisible();

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
});
