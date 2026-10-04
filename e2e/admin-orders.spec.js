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
const orderId = '0e7b73b7-9db0-4ae0-80b5-08e4049162cf';
const actorId = '37578ca4-f54b-4d06-9d46-09e0907e5751';
const summary = {
  id: orderId,
  orderNumber: 'MH-ADMIN-E2E',
  status: 'PACKING',
  createdAt: '2026-10-01T01:00:00.000Z',
  subtotal: '18014398509481986',
  shippingFee: '30000',
  discountTotal: '0',
  total: '18014398509511986',
  currency: 'VND',
  paymentMethod: 'COD',
  itemCount: 2,
  customer: { userId: actorId, email: 'buyer@example.test' },
};
const detail = {
  id: summary.id,
  orderNumber: summary.orderNumber,
  status: summary.status,
  createdAt: summary.createdAt,
  subtotal: summary.subtotal,
  shippingFee: summary.shippingFee,
  discountTotal: summary.discountTotal,
  total: summary.total,
  currency: summary.currency,
  paymentMethod: summary.paymentMethod,
  placedAt: summary.createdAt,
  customerNote: 'Immutable customer note',
  address: {
    recipientName: 'Snapshot Recipient',
    phone: '0900000000',
    line1: 'Immutable address',
    line2: null,
    ward: 'Ward',
    district: 'District',
    province: 'Province',
    postalCode: null,
  },
  customer: {
    userId: actorId,
    email: 'buyer@example.test',
    firstName: 'Current',
    lastName: 'Customer',
    phone: null,
    status: 'ACTIVE',
  },
  items: [
    {
      id: 'dc8f3df4-3b6c-48fe-96c1-782b3c368dc0',
      productId: '7a2a0be5-dd10-4b22-bf87-fb3d47ea0eaa',
      sku: 'SNAPSHOT-SKU',
      productName: 'Immutable product name',
      imageUrl: null,
      sellingUnit: 'box',
      unitPrice: '9007199254740993',
      compareAtPrice: null,
      quantity: 2,
      lineTotal: '18014398509481986',
    },
  ],
  statusHistory: [
    {
      id: 'cb9ac56d-608c-439d-a6cf-d98a5a2831a5',
      status: 'PENDING',
      reason: null,
      createdAt: '2026-10-01T01:00:00.000Z',
      actorUserId: actorId,
    },
    {
      id: 'd850e160-7c8e-4378-a825-4e63f1592422',
      status: 'PACKING',
      reason: 'Preparing parcel',
      createdAt: '2026-10-02T01:00:00.000Z',
      actorUserId: admin.id,
    },
  ],
};

async function expectAccessibleWithoutOverflow(page) {
  expect(
    await page.evaluate(
      // eslint-disable-next-line no-undef -- Runs in the browser page.
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
}

test('Admin queue URL state opens immutable order detail and browser back restores filters', async ({
  page,
}) => {
  await mockAdminSession(page, admin);
  await page.route('**/api/v1/admin/orders**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === `/api/v1/admin/orders/${orderId}`) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'Cache-Control': 'no-store' },
        body: JSON.stringify({ data: detail }),
      });
      return;
    }
    const pageNumber = Number(url.searchParams.get('page') ?? 1);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'Cache-Control': 'no-store' },
      body: JSON.stringify({
        data: [summary],
        meta: {
          page: pageNumber,
          perPage: Number(url.searchParams.get('perPage') ?? 20),
          totalItems: 51,
          totalPages: 2,
        },
      }),
    });
  });

  await page.goto('/admin/orders?status=PACKING&sort=oldest&page=2&perPage=50');
  await expect(
    page.getByRole('heading', { name: 'Orders', exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel('Status')).toHaveValue('PACKING');
  await expect(page.getByLabel('Sort')).toHaveValue('oldest');
  await expect(page.getByLabel('Orders per page')).toHaveValue('50');
  await expect(
    page.getByRole('link', { name: 'Previous page' }),
  ).toHaveAttribute(
    'href',
    '/admin/orders?status=PACKING&sort=oldest&perPage=50',
  );
  await expectAccessibleWithoutOverflow(page);

  await page.getByLabel('Search orders').fill('  buyer@example.test  ');
  await page.getByLabel('Search orders').press('Enter');
  await expect(page).toHaveURL(
    '/admin/orders?q=buyer%40example.test&status=PACKING&sort=oldest&perPage=50',
  );
  const orderLink = page.getByRole('link', { name: 'MH-ADMIN-E2E' });
  await orderLink.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(`/admin/orders/${orderId}`);
  await expect(
    page.getByRole('heading', { name: 'Order detail' }),
  ).toBeVisible();
  await expect(page.getByText('Immutable product name')).toBeVisible();
  await expect(
    page.getByText('Immutable address, Ward, District, Province'),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Complete status history' }),
  ).toBeVisible();
  await expect(page.getByText(/Preparing parcel/u)).toBeVisible();
  await expect(
    page.getByText(`Actor user ID: ${actorId}`, { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: /transition|cancel/i }),
  ).toHaveCount(0);
  await expectAccessibleWithoutOverflow(page);

  await page.getByRole('button', { name: 'Back to order queue' }).click();
  await expect(page).toHaveURL(
    '/admin/orders?q=buyer%40example.test&status=PACKING&sort=oldest&perPage=50',
  );
  await expect(page.getByLabel('Search orders')).toHaveValue(
    'buyer@example.test',
  );
});
