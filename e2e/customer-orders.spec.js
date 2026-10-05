import { randomUUID } from 'node:crypto';
import { expect, test } from './helpers/security-test.js';
import AxeBuilder from '@axe-core/playwright';
import { createDatabase } from '../apps/api/src/db/client.js';
import { validateDatabaseUrl } from '../apps/api/src/config/env.js';

async function audit(page) {
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
}

test('owned order history URL state and confirmed cancellation use authoritative history', async ({
  page,
}) => {
  const url = validateDatabaseUrl(process.env.DATABASE_URL);
  if (!new URL(url).pathname.includes('test'))
    throw new Error('Requires dedicated test database');
  const database = createDatabase(url);
  const { prisma } = database;
  const suffix = randomUUID();
  const email = `orders-ui-${suffix}@example.test`;
  let user;
  let product;
  try {
    await page.goto('/account/orders');
    await expect(page).toHaveURL(/\/login\?returnTo=/);
    await page.getByRole('link', { name: 'Create an account' }).click();
    for (const [label, value] of [
      ['First name', 'Minh'],
      ['Last name', 'Nguyen'],
      ['Email', email],
      ['Password', 'Test-only correct horse battery staple'],
    ])
      await page.getByLabel(label, { exact: true }).fill(value);
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(
      page.getByText('No orders match these filters.'),
    ).toBeVisible();
    await audit(page);
    await page.goto('/account');
    await page
      .getByRole('link', { name: 'Order history', exact: true })
      .click();
    await expect(page).toHaveURL(/\/account\/orders$/);
    user = await prisma.user.findUniqueOrThrow({ where: { email } });
    const category = await prisma.category.create({
      data: { name: 'Order UI fixture', slug: `orders-ui-${suffix}` },
    });
    product = await prisma.product.create({
      data: {
        categoryId: category.id,
        sku: `ORD-${suffix}`,
        slug: `ord-${suffix}`,
        name: 'Current name',
        sellingUnit: 'each',
        prices: {
          create: { price: 120000n, startsAt: new Date('2020-01-01') },
        },
        inventory: { create: { quantityOnHand: 5 } },
      },
    });
    const orders = [];
    for (const [index, status] of [
      'CONFIRMED',
      'PENDING',
      'PACKING',
      'SHIPPING',
      'DELIVERED',
      'CANCELLED',
    ].entries()) {
      orders.push(
        await prisma.order.create({
          data: {
            userId: user.id,
            orderNumber: `MH-${randomUUID()}`,
            idempotencyKey: randomUUID(),
            requestFingerprint: 'private-fixture',
            status,
            createdAt: new Date(`2026-01-0${index + 1}`),
            subtotal: 90000n,
            shippingFee: 30000n,
            discountTotal: 0n,
            total: 120000n,
            recipientName: 'Stored recipient',
            recipientPhone: '0900000000',
            addressLine1: 'Stored address',
            ward: 'Ward',
            district: 'District',
            province: 'Province',
            items: {
              create: {
                productId: product.id,
                sku: 'HISTORICAL',
                productName: 'Historical cup',
                sellingUnit: 'box',
                unitPrice: 90000n,
                quantity: 1,
                lineTotal: 90000n,
              },
            },
            statusHistory: {
              create: {
                fromStatus: null,
                toStatus: status,
                actorUserId: user.id,
                createdAt: new Date('2026-01-01'),
              },
            },
          },
        }),
      );
    }
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    await page.route('**/api/v1/orders?*', async (route) => {
      await gate;
      await route.continue();
    });
    await page.reload();
    await expect(page.getByText('Loading your orders…')).toBeVisible();
    release();
    await expect(
      page.getByRole('list', { name: 'Your orders' }).getByRole('link'),
    ).toHaveCount(6);
    await page.unroute('**/api/v1/orders?*');
    await page.goto('/account/orders?perPage=1&sort=oldest');
    await expect(
      page.getByRole('list', { name: 'Your orders' }).getByRole('link'),
    ).toHaveText(orders[0].orderNumber);
    await page.getByRole('link', { name: 'Next page' }).click();
    await expect(page).toHaveURL(/page=2/);
    await expect(
      page.getByRole('list', { name: 'Your orders' }).getByRole('link'),
    ).toHaveText(orders[1].orderNumber);
    await page.getByLabel('Order status').selectOption('CONFIRMED');
    await expect(page).toHaveURL(/page=1/);
    await page.getByLabel('Order sort').selectOption('newest');
    await expect(page).toHaveURL(/sort=newest/);
    await page.reload();
    await expect(page.getByLabel('Order status')).toHaveValue('CONFIRMED');
    await expect(page.getByLabel('Order sort')).toHaveValue('newest');
    await audit(page);
    await page.getByRole('link', { name: orders[0].orderNumber }).click();
    await expect(page.getByText('Status: CONFIRMED')).toBeVisible();
    await expect(
      page.getByText('Historical cup — HISTORICAL (box)'),
    ).toBeVisible();
    await page
      .getByRole('button', { name: 'Cancel order', exact: true })
      .focus();
    await page.keyboard.press('Enter');
    await page
      .getByLabel('Cancellation reason (optional)')
      .fill('x'.repeat(241));
    await page.getByRole('button', { name: 'Confirm cancellation' }).click();
    await expect(
      page
        .getByRole('region', { name: 'Order cancellation' })
        .getByRole('alert'),
    ).toContainText('240');
    await page
      .getByLabel('Cancellation reason (optional)')
      .fill('  Changed plans  ');
    await audit(page);
    let cancelRelease;
    const cancelGate = new Promise((resolve) => {
      cancelRelease = resolve;
    });
    let calls = 0;
    await page.route('**/api/v1/orders/*/cancel', async (route) => {
      calls++;
      await cancelGate;
      await route.continue();
    });
    await page.getByRole('button', { name: 'Confirm cancellation' }).click();
    await expect(
      page.getByRole('button', { name: 'Cancelling…' }),
    ).toBeDisabled();
    cancelRelease();
    await expect(page.getByText('Status: CANCELLED')).toBeVisible();
    await expect(
      page
        .getByRole('heading', { name: 'Status history' })
        .locator('..')
        .getByText('Changed plans'),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Cancel order', exact: true }),
    ).toHaveCount(0);
    expect(calls).toBe(1);
    await audit(page);
    expect(
      (
        await prisma.inventory.findUniqueOrThrow({
          where: { productId: product.id },
        })
      ).quantityOnHand,
    ).toBe(6);
    expect(
      await prisma.inventoryMovement.count({
        where: { orderId: orders[0].id, type: 'ORDER_CANCEL_RESTORE' },
      }),
    ).toBe(1);
    await page.reload();
    await expect(page.getByText('Status: CANCELLED')).toBeVisible();
    for (const order of orders.slice(2)) {
      await page.goto(`/account/orders/${order.orderNumber}`);
      await expect(page.getByText(`Status: ${order.status}`)).toBeVisible();
      await expect(
        page.getByRole('button', { name: 'Cancel order', exact: true }),
      ).toHaveCount(0);
    }
    await page.route('**/api/v1/orders?*', (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({
          error: { code: 'UNAVAILABLE', message: 'Fixture unavailable' },
        }),
      }),
    );
    await page.goto('/account/orders');
    await expect(
      page.getByText('We could not load your orders.'),
    ).toBeVisible();
    await audit(page);
    await page.unroute('**/api/v1/orders?*');
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await expect(
      page.getByRole('list', { name: 'Your orders' }).getByRole('link'),
    ).toHaveCount(6);
  } finally {
    if (product)
      await prisma.product.update({
        where: { id: product.id },
        data: { status: 'ARCHIVED', archivedAt: new Date() },
      });
    if (user)
      await prisma.user.update({
        where: { id: user.id },
        data: { archivedAt: new Date() },
      });
    await database.close();
  }
});
