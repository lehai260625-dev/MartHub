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
const rootId = '37578ca4-f54b-4d06-9d46-09e0907e5751';

function category(overrides = {}) {
  return {
    id: rootId,
    parentId: null,
    name: 'Home',
    slug: 'home',
    description: 'Home essentials',
    status: 'ACTIVE',
    sortOrder: 10,
    archivedAt: null,
    parent: null,
    childCount: 0,
    productCount: 2,
    ...overrides,
  };
}

test('admin creates, orders, edits, and archives a category responsively', async ({
  page,
}) => {
  let rows = [category()];

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
  await page.route('**/api/v1/admin/categories**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const parts = url.pathname.split('/').filter(Boolean);
    const categoryId = parts[parts.indexOf('categories') + 1];
    const archive = parts.at(-1) === 'archive';
    let status = 200;
    let body;

    if (request.method() === 'GET' && !categoryId) {
      body = { data: rows };
    } else if (request.method() === 'POST' && !categoryId) {
      const input = request.postDataJSON();
      const created = category({
        ...input,
        id: '0e7b73b7-9db0-4ae0-80b5-08e4049162cf',
        parent: null,
        childCount: 0,
        productCount: 0,
      });
      rows = [...rows, created];
      status = 201;
      body = { data: created };
    } else if (request.method() === 'PATCH' && categoryId) {
      const input = request.postDataJSON();
      rows = rows.map((row) =>
        row.id === categoryId ? { ...row, ...input } : row,
      );
      body = { data: rows.find(({ id }) => id === categoryId) };
    } else if (request.method() === 'POST' && archive) {
      rows = rows.map((row) =>
        row.id === categoryId
          ? {
              ...row,
              status: 'ARCHIVED',
              archivedAt: '2026-09-20T00:00:00.000Z',
            }
          : row,
      );
      body = { data: rows.find(({ id }) => id === categoryId) };
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
  await page.getByRole('link', { name: 'Categories' }).click();
  await expect(page).toHaveURL('/admin/categories');
  await expect(
    page.getByRole('heading', { name: 'Category management' }),
  ).toBeVisible();

  await page.getByLabel('Category name').fill('Office');
  await page.getByLabel('URL slug').fill('office');
  await page.getByLabel('Display order').fill('4');
  await page.getByRole('button', { name: 'Create category' }).click();
  await expect(page.getByText('Office was created.')).toBeVisible();
  await expect(page.getByRole('rowheader', { name: /Office/ })).toBeVisible();

  await page.getByRole('button', { name: 'Edit Office' }).click();
  await expect(page.getByLabel('URL slug')).toHaveAttribute('readonly', '');
  await page.getByLabel('Category name').fill('Office supplies');
  await page.getByLabel('Display order').fill('2');
  await page.getByRole('button', { name: 'Save category' }).click();
  await expect(page.getByText('Office supplies was updated.')).toBeVisible();

  await page.getByRole('button', { name: 'Archive Office supplies' }).click();
  await expect(page.getByText('Archive Office supplies?')).toBeVisible();
  await page.getByRole('button', { name: 'Confirm archive' }).click();
  await expect(page.getByText('Office supplies was archived.')).toBeVisible();

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
