import { expect, test } from '@playwright/test';

import { mockAdminSession } from './helpers/admin-session.js';
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
  productCount: 1,
};
const productId = '0e7b73b7-9db0-4ae0-80b5-08e4049162cf';
const imageId = '7984f43d-f8fb-45a7-94d6-cdb60e278081';
const publicId = `marthub/products/${productId}/browser-upload`;
const imageUrl =
  'https://res.cloudinary.com/marthub-test/image/upload/f_auto,q_auto,c_limit,w_1200/marthub/products/item';

function product(images = []) {
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
    compareAtPrice: null,
    quantityOnHand: 0,
    imageCount: images.length,
    images,
  };
}

test('admin uploads, edits, and removes a product image responsively', async ({
  page,
}) => {
  let images = [];
  await mockAdminSession(page, admin);
  await page.route('**/api/v1/admin/categories', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: [category] }),
    }),
  );
  await page.route('https://api.cloudinary.com/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ public_id: publicId }),
    }),
  );
  await page.route('https://res.cloudinary.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: '' }),
  );
  await page.route('**/api/v1/admin/products**', async (route) => {
    const request = route.request();
    const parts = new URL(request.url()).pathname.split('/').filter(Boolean);
    const productIndex = parts.indexOf('products');
    const routeProductId = parts[productIndex + 1];
    const segment = parts[productIndex + 2];
    const routeImageId = parts[productIndex + 3];
    let status = 200;
    let body;
    if (request.method() === 'GET' && !routeProductId) {
      body = {
        data: [product(images)],
        meta: { page: 1, perPage: 24, totalItems: 1, totalPages: 1 },
      };
    } else if (
      request.method() === 'POST' &&
      segment === 'images' &&
      routeImageId === 'signature'
    ) {
      const timestamp = Math.floor(Date.now() / 1000);
      body = {
        data: {
          cloudName: 'marthub-test',
          apiKey: 'test-key',
          uploadUrl:
            'https://api.cloudinary.com/v1_1/marthub-test/image/upload',
          expiresAt: new Date((timestamp + 300) * 1000).toISOString(),
          parameters: {
            allowed_formats: 'jpg,png,webp',
            folder: `marthub/products/${productId}`,
            max_file_size: 4194304,
            public_id: publicId,
            timestamp,
            signature: 'a'.repeat(40),
          },
        },
      };
    } else if (request.method() === 'POST' && segment === 'images') {
      const input = request.postDataJSON();
      images = [
        {
          id: imageId,
          url: imageUrl,
          altText: input.altText,
          width: 1200,
          height: 900,
          sortOrder: input.sortOrder,
          isPrimary: true,
        },
      ];
      status = 201;
      body = { data: images[0] };
    } else if (
      request.method() === 'PATCH' &&
      segment === 'images' &&
      routeImageId === imageId
    ) {
      images = [{ ...images[0], ...request.postDataJSON() }];
      body = { data: images[0] };
    } else if (
      request.method() === 'DELETE' &&
      segment === 'images' &&
      routeImageId === imageId
    ) {
      images = [];
      status = 202;
      body = { data: { imageId, status: 'PENDING', attemptCount: 1 } };
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

  await page.goto('/admin/products');
  await page.getByRole('button', { name: 'Edit Desk lamp' }).click();
  await expect(
    page.getByRole('heading', { name: 'Product images' }),
  ).toBeVisible();
  await page.getByLabel('Image file').setInputFiles({
    name: 'desk-lamp.webp',
    mimeType: 'image/webp',
    buffer: Buffer.from('small-test-image'),
  });
  await page.getByLabel('Alternative text').fill('Desk lamp front view');
  await page.getByRole('button', { name: 'Upload image' }).click();
  await expect(page.getByText('Image uploaded and verified.')).toBeVisible();
  await expect(page.getByAltText('Desk lamp front view')).toBeVisible();

  await page.getByLabel('Alternative text').first().fill('Desk lamp side view');
  await page.getByLabel('Display order').first().fill('3');
  await page.getByRole('button', { name: 'Save image' }).click();
  await expect(page.getByText('Image details updated.')).toBeVisible();

  await page.getByRole('button', { name: 'Remove image' }).click();
  await expect(page.getByText('Remove this image?')).toBeVisible();
  await page.getByRole('button', { name: 'Confirm removal' }).click();
  await expect(
    page.getByText(
      'Image removed from MartHub. Cloudinary cleanup is pending.',
    ),
  ).toBeVisible();
  await expect(page.getByText('No images attached.')).toBeVisible();
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
