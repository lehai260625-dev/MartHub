import { randomUUID } from 'node:crypto';
import { expect, test } from './helpers/security-test.js';
import AxeBuilder from '@axe-core/playwright';
import { createDatabase } from '../apps/api/src/db/client.js';
import { validateDatabaseUrl } from '../apps/api/src/config/env.js';
import { waitForSettledUi } from './helpers/settled-ui.js';

async function audit(page) {
  await waitForSettledUi(page);
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

test('owned-address COD checkout recovers a lost committed response without duplicate effects', async ({
  page,
}) => {
  const url = validateDatabaseUrl(process.env.DATABASE_URL);
  if (!new URL(url).pathname.includes('test'))
    throw new Error('Checkout E2E requires a dedicated test database.');
  const database = createDatabase(url);
  const prisma = database.prisma;
  const unique = randomUUID();
  const email = `e2e-checkout-${unique}@example.test`;
  let product;
  try {
    const category = await prisma.category.findFirst({
      where: { status: 'ACTIVE', archivedAt: null, parentId: null },
    });
    product = await prisma.product.create({
      data: {
        categoryId: category.id,
        sku: `E2E-${unique}`,
        slug: `checkout-${unique}`,
        name: `Checkout Cup ${unique}`,
        sellingUnit: 'each',
        status: 'ACTIVE',
        publishedAt: new Date(),
        prices: {
          create: { price: 110000n, startsAt: new Date('2020-01-01') },
        },
        inventory: { create: { quantityOnHand: 3 } },
      },
    });
    await page.goto('/checkout');
    await expect(page).toHaveURL(/\/login\?returnTo=%2Fcheckout/);
    await page.getByRole('link', { name: 'Create an account' }).click();
    for (const [label, value] of [
      ['First name', 'Minh'],
      ['Last name', 'Nguyen'],
      ['Email', email],
      ['Password', 'Test-only correct horse battery staple'],
    ])
      await page.getByLabel(label, { exact: true }).fill(value);
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByText('Your cart is empty.')).toBeVisible();
    await page.goto(`/products/${product.slug}`);
    await page.getByRole('button', { name: /^Add to cart:/i }).click();
    await expect(page.getByLabel('1 items in cart')).toBeVisible();
    await page.goto('/account/addresses');
    for (const [label, value] of [
      ['Address label', 'Home'],
      ['Recipient name', 'Minh Nguyen'],
      ['Phone number', '+84 912345678'],
      ['Address line 1', '12 Market Street'],
      ['Ward', 'Ward 1'],
      ['District', 'District 3'],
      ['Province or city', 'Ho Chi Minh City'],
    ])
      await page.getByLabel(label, { exact: true }).fill(value);
    await page
      .getByRole('button', { name: 'Add address', exact: true })
      .click();
    await expect(page.getByText('Address saved.')).toBeVisible();
    await page.goto('/cart');
    await page.getByLabel('Quantity').fill('2');
    await page.getByRole('button', { name: 'Update', exact: true }).click();
    await expect(page.getByLabel('2 items in cart')).toBeVisible();
    await page.getByRole('link', { name: 'Continue to checkout' }).click();
    await page.getByRole('radio').check();
    await expect(
      page.getByRole('button', { name: 'Place COD order' }),
    ).toBeEnabled();
    await audit(page);
    // The quote does not lock prices: the committed order must display server repricing.
    const [{ now }] = await prisma.$queryRaw`SELECT CURRENT_TIMESTAMP AS now`;
    await prisma.$transaction(async (tx) => {
      await tx.productPriceHistory.updateMany({
        where: { productId: product.id },
        data: { endsAt: now },
      });
      await tx.productPriceHistory.create({
        data: { productId: product.id, price: 120000n, startsAt: now },
      });
    });
    const attempts = [];
    let stage = 0;
    await page.route('**/api/v1/checkout/orders', async (route) => {
      attempts.push({
        key: route.request().headers()['idempotency-key'],
        body: route.request().postDataJSON(),
      });
      stage++;
      if (stage === 1) {
        const response = await route.fetch();
        expect(response.status()).toBe(409);
        await route.fulfill({ response });
      } else if (stage === 2) {
        const response = await route.fetch();
        expect(response.status()).toBe(201);
        await route.abort('failed');
      } else {
        const response = await route.fetch();
        expect(response.status()).toBe(200);
        await route.fulfill({ response });
      }
    });
    await page.getByLabel('Customer note (optional)').fill('Please call');
    await prisma.inventory.update({
      where: { productId: product.id },
      data: { quantityOnHand: 1 },
    });
    await page.getByRole('button', { name: 'Place COD order' }).click();
    await expect(page.getByText(/requested 2, available 1/)).toBeVisible();
    expect(
      await prisma.orderItem.count({ where: { productId: product.id } }),
    ).toBe(0);
    await audit(page);
    await prisma.inventory.update({
      where: { productId: product.id },
      data: { quantityOnHand: 3 },
    });
    await page.getByRole('button', { name: 'Refresh server summary' }).click();
    await expect(
      page.getByRole('button', { name: 'Place COD order' }),
    ).toBeEnabled();
    await page.getByRole('button', { name: 'Place COD order' }).click();
    await expect(
      page.getByRole('button', { name: 'Retry same submission' }),
    ).toBeEnabled();
    await expect(page.getByRole('radio')).toBeDisabled();
    await audit(page);
    await page.getByRole('button', { name: 'Retry same submission' }).click();
    await expect(page).toHaveURL(/\/checkout\/success\/MH-/);
    await expect(
      page.getByText('Your COD order was placed successfully.'),
    ).toBeVisible();
    await expect(page.getByText('270.000 ₫')).toBeVisible();
    await expect(page.getByLabel('0 items in cart')).toBeVisible();
    await audit(page);
    expect(attempts).toHaveLength(3);
    expect(attempts[2]).toEqual(attempts[1]);
    expect(attempts[1].key).not.toBe(attempts[0].key);
    expect(Object.keys(attempts[0].body).sort()).toEqual([
      'addressId',
      'cartId',
      'customerNote',
    ]);
    const user = await prisma.user.findUnique({ where: { email } });
    const orders = await prisma.order.findMany({ where: { userId: user.id } });
    expect(orders).toHaveLength(1);
    expect(orders[0].total).toBe(270000n);
    expect(
      await prisma.inventoryMovement.count({
        where: { orderId: orders[0].id, type: 'ORDER_DEBIT' },
      }),
    ).toBe(1);
    expect(
      (await prisma.inventory.findUnique({ where: { productId: product.id } }))
        .quantityOnHand,
    ).toBe(1);
    expect(
      await prisma.cartItem.count({ where: { cart: { userId: user.id } } }),
    ).toBe(0);
    expect(
      await prisma.orderStatusHistory.count({
        where: { orderId: orders[0].id },
      }),
    ).toBe(1);
    await page.goto('/cart');
    await expect(page.getByText('Your cart is empty')).toBeVisible();
  } finally {
    // Immutable order/history fixtures are retained; archive only this test's own catalog/account.
    if (product)
      await prisma.product.update({
        where: { id: product.id },
        data: { status: 'ARCHIVED', archivedAt: new Date() },
      });
    await prisma.user.updateMany({
      where: { email },
      data: { archivedAt: new Date() },
    });
    await database.close();
  }
});
