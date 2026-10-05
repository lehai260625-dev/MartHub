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

test('My Items tabs, historical provenance, current availability and owned detail are accessible', async ({
  page,
}) => {
  const url = validateDatabaseUrl(process.env.DATABASE_URL);
  if (!new URL(url).pathname.includes('test'))
    throw new Error('My Items E2E requires a dedicated test database.');
  const database = createDatabase(url);
  const { prisma } = database;
  const suffix = randomUUID();
  const email = `e2e-my-items-${suffix}@example.test`;
  const products = [];
  let user;
  try {
    await page.goto('/account/my-items?tab=reorder');
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
    await expect(page.getByText('No delivered purchases yet')).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Popular products' }),
    ).toBeVisible();
    await audit(page);
    user = await prisma.user.findUniqueOrThrow({ where: { email } });
    const category = await prisma.category.create({
      data: { name: 'My Items fixture', slug: `items-${suffix}` },
    });
    for (const [index, name] of [
      'Available mug',
      'Sold out plate',
      'Hidden bowl',
    ].entries()) {
      products.push(
        await prisma.product.create({
          data: {
            categoryId: category.id,
            sku: `ITEMS-${suffix}-${index}`,
            slug: `items-${suffix}-${index}`,
            name,
            sellingUnit: 'each',
            status: index === 2 ? 'DRAFT' : 'ACTIVE',
            publishedAt: index === 2 ? null : new Date(),
            prices: {
              create: { price: 120000n, startsAt: new Date('2020-01-01') },
            },
            inventory: { create: { quantityOnHand: index === 1 ? 0 : 5 } },
          },
        }),
      );
    }
    const order = await prisma.order.create({
      data: {
        userId: user.id,
        orderNumber: `MH-${randomUUID()}`,
        idempotencyKey: randomUUID(),
        requestFingerprint: 'private-e2e-fingerprint',
        status: 'DELIVERED',
        subtotal: 270000n,
        shippingFee: 30000n,
        discountTotal: 0n,
        total: 300000n,
        recipientName: 'Historical recipient',
        recipientPhone: '0900000000',
        addressLine1: 'Historical delivery address',
        ward: 'Ward',
        district: 'District',
        province: 'Province',
        customerNote: 'Historical note',
        items: {
          create: products.map((product, index) => ({
            productId: product.id,
            sku: `HISTORICAL-${index}`,
            productName: ['Original mug', 'Original plate', 'Original bowl'][
              index
            ],
            sellingUnit: 'box',
            imageUrl: null,
            unitPrice: 90000n,
            quantity: 1,
            lineTotal: 90000n,
          })),
        },
        statusHistory: {
          create: [
            {
              fromStatus: null,
              toStatus: 'PENDING',
              actorUserId: user.id,
              createdAt: new Date('2026-01-01'),
            },
            {
              fromStatus: 'SHIPPING',
              toStatus: 'DELIVERED',
              actorUserId: user.id,
              reason: 'Delivery recorded',
              createdAt: new Date('2026-01-02'),
            },
          ],
        },
      },
    });
    await prisma.wishlist.create({
      data: {
        userId: user.id,
        items: {
          create: [
            { productId: products[1].id },
            { productId: products[2].id },
          ],
        },
      },
    });
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    await page.route('**/api/v1/users/me/items?*', async (route) => {
      await gate;
      await route.continue();
    });
    await page.reload();
    await expect(
      page.getByText('Loading your delivered purchases…'),
    ).toBeVisible();
    release();
    await expect(page.getByText('Purchased as: Original mug')).toBeVisible();
    await page.unroute('**/api/v1/users/me/items?*');
    const purchased = page.getByRole('list', { name: 'Purchased products' });
    await expect(
      purchased.getByRole('button', { name: 'Sold out plate is out of stock' }),
    ).toBeDisabled();
    await expect(
      purchased.getByRole('heading', { name: 'Original bowl' }),
    ).toBeVisible();
    await expect(purchased.getByText('Hidden bowl')).toHaveCount(0);
    const source = purchased
      .getByRole('link', { name: 'View purchase order' })
      .first();
    await expect(source).toHaveAttribute(
      'href',
      `/account/orders/${order.orderNumber}`,
    );
    await expect(
      purchased.getByRole('link', { name: 'View purchase order' }),
    ).toHaveCount(3);
    expect(
      await purchased.evaluate((list) =>
        [...list.children].every((item) => {
          const bounds = item.getBoundingClientRect();
          return [...item.querySelectorAll('a, button')].every(
            (action) =>
              action.getBoundingClientRect().bottom <= bounds.bottom + 1,
          );
        }),
      ),
    ).toBe(true);
    await audit(page);
    await purchased
      .getByRole('button', { name: 'Add to cart: Available mug' })
      .click();
    await expect(page.getByLabel('1 items in cart')).toBeVisible();
    const wishlistTab = page
      .getByRole('navigation', { name: 'My Items', exact: true })
      .getByRole('link', { name: 'Wishlist' });
    await wishlistTab.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL('/account/my-items?tab=wishlist');
    await expect(wishlistTab).toHaveAttribute('aria-current', 'page');
    await expect(
      page.getByRole('heading', { name: 'Saved product unavailable' }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Sold out plate is out of stock' }),
    ).toBeDisabled();
    await audit(page);
    await page.getByRole('button', { name: 'Remove saved item' }).click();
    await expect(
      page.getByRole('heading', { name: 'Saved product unavailable' }),
    ).toHaveCount(0);
    await page.getByRole('link', { name: 'Reorder', exact: true }).click();
    await page.getByRole('link', { name: 'Most purchased' }).click();
    await expect(page).toHaveURL(
      '/account/my-items?tab=reorder&sort=frequent&page=1',
    );
    await page.reload();
    await expect(
      page.getByRole('link', { name: 'Most purchased' }),
    ).toHaveAttribute('aria-current', 'page');
    await page
      .getByRole('link', { name: 'View purchase order' })
      .first()
      .click();
    await expect(page).toHaveURL(`/account/orders/${order.orderNumber}`);
    await expect(
      page.getByText('Historical delivery address, Ward, District, Province'),
    ).toBeVisible();
    await expect(page.getByText('Delivery recorded')).toBeVisible();
    await expect(
      page.getByText('Historical note', { exact: false }),
    ).toBeVisible();
    await expect(page.getByText('private-e2e-fingerprint')).toHaveCount(0);
    await expect(page.getByText(user.id, { exact: true })).toHaveCount(0);
    await page.reload();
    await expect(
      page.getByRole('heading', { name: 'Status history' }),
    ).toBeVisible();
    await audit(page);
    await page
      .getByRole('button', { name: 'Reorder this order', exact: true })
      .click();
    await expect(page.getByText('Original mug: 1 added')).toBeVisible();
    await expect(page.getByText('Original plate: Out of stock')).toBeVisible();
    await expect(page.getByText('Original bowl: Unavailable')).toBeVisible();
    await expect(page.getByLabel('2 items in cart')).toBeVisible();
    await audit(page);
    await page.goto('/account/orders/MH-' + randomUUID());
    await expect(page.getByText('Order not found.')).toBeVisible();
    await audit(page);
    await page.route('**/api/v1/users/me/items?*', (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({
          error: {
            code: 'SERVICE_UNAVAILABLE',
            message: 'Private provider detail',
            requestId: randomUUID(),
          },
        }),
      }),
    );
    await page.goto('/account/my-items?tab=reorder');
    await expect(
      page.getByText('We could not load your delivered purchases.'),
    ).toBeVisible();
    await audit(page);
    await page.unroute('**/api/v1/users/me/items?*');
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await expect(page.getByText('Purchased as: Original mug')).toBeVisible();
  } finally {
    // Retain immutable order/history fixtures, archive only this test's resources.
    for (const product of products)
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
