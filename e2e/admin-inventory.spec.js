import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

import { mockAdminSession } from './helpers/admin-session.js';

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
  productCount: 1,
};
const productId = '0e7b73b7-9db0-4ae0-80b5-08e4049162cf';
const actor = {
  id: admin.id,
  email: admin.email,
  firstName: admin.firstName,
  lastName: admin.lastName,
};
function product(quantityOnHand) {
  return {
    id: productId,
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
      status: category.status,
    },
    price: '349000',
    compareAtPrice: '399000',
    quantityOnHand,
    imageCount: 0,
    images: [],
  };
}
const price = {
  id: '4386553d-3fba-4c32-86f1-3a23de90a932',
  productId,
  price: '349000',
  compareAtPrice: '399000',
  startsAt: '2026-09-01T00:00:00.000Z',
  endsAt: null,
  createdAt: '2026-09-01T00:00:00.000Z',
  isCurrent: true,
  createdBy: actor,
};
const history = (rows) => ({
  data: rows,
  meta: {
    page: 1,
    perPage: 20,
    totalItems: rows.length,
    totalPages: rows.length ? 1 : 0,
  },
});

test('admin adjusts inventory with authoritative history and conflict feedback', async ({
  page,
}) => {
  let quantity = 5;
  let movements = [];
  await mockAdminSession(page, admin);
  await page.route('**/api/v1/admin/categories', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: [category] }),
    }),
  );
  await page.route('**/api/v1/admin/inventory/**', async (route) => {
    const request = route.request();
    if (request.method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(history(movements)),
      });
      return;
    }
    const input = request.postDataJSON();
    const after = quantity + input.adjustment;
    if (after < 0) {
      await route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({
          error: {
            code: 'INSUFFICIENT_STOCK',
            message: 'The adjustment would make stock negative.',
            requestId: 'req_inventory_test',
          },
        }),
      });
      return;
    }
    const movement = {
      id: '7984f43d-f8fb-45a7-94d6-cdb60e278081',
      productId,
      type: 'ADJUSTMENT',
      adjustment: input.adjustment,
      quantityBefore: quantity,
      quantityAfter: after,
      orderId: null,
      reason: input.reason,
      createdAt: '2026-09-21T00:00:00.000Z',
      actor,
    };
    quantity = after;
    movements = [movement, ...movements];
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          inventory: {
            productId,
            sku: 'MHB-OPS-001',
            name: 'Desk lamp',
            status: 'DRAFT',
            quantityOnHand: quantity,
            updatedAt: '2026-09-21T00:00:00.000Z',
          },
          movement,
        },
      }),
    });
  });
  await page.route('**/api/v1/admin/products**', async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    const body = pathname.endsWith('/prices')
      ? { data: [price] }
      : {
          data: [product(quantity)],
          meta: { page: 1, perPage: 24, totalItems: 1, totalPages: 1 },
        };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });

  await page.goto('/admin/products');
  await page.getByRole('button', { name: 'Edit Desk lamp' }).click();
  await expect(page.getByRole('heading', { name: 'Inventory' })).toBeVisible();
  await expect(page.getByText('No inventory movements yet.')).toBeVisible();

  await page.getByLabel('Signed adjustment').fill('-2');
  await page.getByLabel('Reason').fill('Damaged during cycle count');
  await page.getByRole('button', { name: 'Adjust stock' }).click();
  await expect(page.getByText('Stock adjusted from 5 to 3.')).toBeVisible();
  await expect(
    page.getByRole('cell', { name: 'Damaged during cycle count' }),
  ).toBeVisible();
  await expect(
    page
      .getByLabel('Inventory movement history table')
      .getByRole('cell', { name: 'Admin User' }),
  ).toBeVisible();
  await expect(page.getByText(/Current stock:/)).toContainText('3');

  await page.getByLabel('Signed adjustment').fill('-4');
  await page.getByLabel('Reason').fill('Second count');
  await page.getByRole('button', { name: 'Adjust stock' }).click();
  await expect(
    page.getByText('The adjustment would make stock negative.'),
  ).toBeVisible();

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
