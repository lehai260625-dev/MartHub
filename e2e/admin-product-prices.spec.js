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
const priceActor = {
  id: admin.id,
  email: admin.email,
  firstName: admin.firstName,
  lastName: admin.lastName,
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
const basePrice = {
  id: '7984f43d-f8fb-45a7-94d6-cdb60e278081',
  productId,
  price: '349000',
  compareAtPrice: '399000',
  startsAt: '2026-09-01T00:00:00.000Z',
  endsAt: null,
  createdAt: '2026-09-01T00:00:00.000Z',
  isCurrent: true,
  createdBy: priceActor,
};
function product() {
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
    quantityOnHand: 0,
    imageCount: 0,
    images: [],
  };
}

test('admin reviews history and schedules a successor price responsively', async ({
  page,
}) => {
  let history = [basePrice];
  let conflict = false;
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
      body: JSON.stringify({ data: [category] }),
    }),
  );
  await page.route('**/api/v1/admin/products**', async (route) => {
    const request = route.request();
    const parts = new URL(request.url()).pathname.split('/').filter(Boolean);
    const productIndex = parts.indexOf('products');
    const routeProductId = parts[productIndex + 1];
    const segment = parts[productIndex + 2];
    let status = 200;
    let body;
    if (request.method() === 'GET' && !routeProductId) {
      body = {
        data: [product()],
        meta: { page: 1, perPage: 24, totalItems: 1, totalPages: 1 },
      };
    } else if (segment === 'prices' && request.method() === 'GET') {
      body = { data: history };
    } else if (
      segment === 'prices' &&
      request.method() === 'POST' &&
      !conflict
    ) {
      const input = request.postDataJSON();
      const successor = {
        id: '4386553d-3fba-4c32-86f1-3a23de90a932',
        productId,
        price: input.price,
        compareAtPrice: input.compareAtPrice,
        startsAt: input.startsAt,
        endsAt: null,
        createdAt: '2026-09-21T00:00:00.000Z',
        isCurrent: false,
        createdBy: priceActor,
      };
      history = [successor, { ...basePrice, endsAt: input.startsAt }];
      conflict = true;
      status = 201;
      body = { data: successor };
    } else if (segment === 'prices' && request.method() === 'POST') {
      status = 409;
      body = {
        error: {
          code: 'PRICE_TIMELINE_CONFLICT',
          message:
            'The requested price conflicts with the existing price timeline.',
          requestId: 'req_price_test',
        },
      };
    } else {
      status = 404;
      body = {
        error: {
          code: 'NOT_FOUND',
          message: 'Not found.',
          requestId: 'req_price_test',
        },
      };
    }
    await route.fulfill({
      status,
      contentType: 'application/json',
      headers: { 'Cache-Control': 'no-store' },
      body: JSON.stringify(body),
    });
  });

  await page.goto('/admin/products');
  await page.getByRole('button', { name: 'Edit Desk lamp' }).click();
  await expect(
    page.getByRole('heading', { name: 'Price history' }),
  ).toBeVisible();
  await expect(page.getByText('Current')).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Admin User' })).toBeVisible();
  await page.getByLabel('New price (VND)').fill('359000');
  await page.getByLabel('New compare price (VND)').fill('409000');
  await page.getByLabel('Starts at').fill('2026-10-01T00:00');
  await page.getByRole('button', { name: 'Schedule price' }).click();
  await expect(
    page.getByText('Future price scheduled with history preserved.'),
  ).toBeVisible();
  await expect(page.getByText(/359\.000/u)).toBeVisible();

  await page.getByLabel('New price (VND)').fill('369000');
  await page.getByLabel('Starts at').fill('2026-09-28T00:00');
  await page.getByRole('button', { name: 'Schedule price' }).click();
  await expect(
    page.getByText(
      'The requested price conflicts with the existing price timeline.',
    ),
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
