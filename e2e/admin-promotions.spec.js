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
const actor = {
  id: admin.id,
  email: admin.email,
  firstName: admin.firstName,
  lastName: admin.lastName,
};
const promotionId = '0e7b73b7-9db0-4ae0-80b5-08e4049162cf';
const publicId = `marthub/promotions/${promotionId}/browser-hero`;
const list = (rows) => ({
  data: rows,
  meta: {
    page: 1,
    perPage: 24,
    totalItems: rows.length,
    totalPages: rows.length ? 1 : 0,
  },
});

test('admin creates, publishes, uploads, and archives a promotion while retaining media', async ({
  page,
}) => {
  let promotion = null;
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
      body: JSON.stringify({ data: { user: admin } }),
    }),
  );
  await page.route('https://api.cloudinary.test/upload', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ public_id: publicId }),
    }),
  );
  await page.route('https://res.cloudinary.test/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'image/png',
      body: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+X2NDWQAAAABJRU5ErkJggg==',
        'base64',
      ),
    }),
  );
  await page.route('**/api/v1/admin/promotions**', async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    const method = request.method();
    if (pathname.endsWith('/media/signature')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            cloudName: 'test',
            apiKey: 'public-key',
            uploadUrl: 'https://api.cloudinary.test/upload',
            expiresAt: '2026-09-21T00:05:00.000Z',
            parameters: {
              allowed_formats: 'jpg,png,webp',
              folder: `marthub/promotions/${promotionId}`,
              max_file_size: 4194304,
              public_id: publicId,
              timestamp: 1789948800,
              signature: 'a'.repeat(40),
            },
          },
        }),
      });
      return;
    }
    if (pathname.endsWith('/media') && method === 'POST') {
      promotion = {
        ...promotion,
        image: {
          publicId,
          url: `https://res.cloudinary.test/image/upload/f_auto,q_auto,c_limit,w_1200/${publicId}`,
        },
      };
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ data: promotion }),
      });
      return;
    }
    if (pathname.endsWith('/publish')) {
      promotion = {
        ...promotion,
        status: 'ACTIVE',
        updatedAt: '2026-09-21T00:01:00.000Z',
      };
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: promotion }),
      });
      return;
    }
    if (pathname.endsWith('/archive')) {
      promotion = {
        ...promotion,
        status: 'ARCHIVED',
        archivedAt: '2026-09-21T00:02:00.000Z',
        updatedAt: '2026-09-21T00:02:00.000Z',
      };
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: promotion }),
      });
      return;
    }
    if (method === 'POST') {
      const input = request.postDataJSON();
      promotion = {
        id: promotionId,
        ...input,
        status: 'DRAFT',
        image: null,
        archivedAt: null,
        createdAt: '2026-09-21T00:00:00.000Z',
        updatedAt: '2026-09-21T00:00:00.000Z',
        createdBy: actor,
      };
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ data: promotion }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(list(promotion ? [promotion] : [])),
    });
  });

  await page.goto('/admin/promotions');
  await expect(page.getByText('No promotions found.')).toBeVisible();
  await page.getByLabel('Title', { exact: true }).fill('Autumn table');
  await page.getByLabel('Internal destination').fill('https://outside.test');
  await page.getByLabel('Starts at').fill('2026-09-21T00:00');
  await page.getByLabel('Ends at').fill('2026-10-01T00:00');
  await page.getByRole('button', { name: 'Create draft' }).click();
  await expect(page.getByText('Use a MartHub internal path.')).toBeVisible();
  await page.getByLabel('Internal destination').fill('/category/tabletop');
  await page.getByRole('button', { name: 'Create draft' }).click();
  await expect(
    page.getByText('Autumn table was created as a draft.'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Publish promotion' }).click();
  await expect(page.getByText('Autumn table was published.')).toBeVisible();
  await page.getByLabel('Promotion image file').setInputFiles({
    name: 'hero.png',
    mimeType: 'image/png',
    buffer: Buffer.from([137, 80, 78, 71]),
  });
  await page.getByRole('button', { name: 'Upload image' }).click();
  await expect(
    page.getByText('Promotion image uploaded and verified.'),
  ).toBeVisible();
  await expect(page.getByRole('img', { name: 'Autumn table' })).toBeVisible();
  await page.getByRole('button', { name: 'Archive promotion' }).click();
  await page.getByRole('button', { name: 'Confirm archive' }).click();
  await expect(page.getByText('Autumn table was archived.')).toBeVisible();
  await expect(page.getByRole('img', { name: 'Autumn table' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'ARCHIVED' })).toBeVisible();
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
