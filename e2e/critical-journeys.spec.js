import { expect, test } from './helpers/security-test.js';
import { createDatabase } from '../apps/api/src/db/client.js';
import { hashPassword } from '../apps/api/src/modules/auth/passwords.js';
import { e2eDatabaseUrl } from '../scripts/lib/e2e-database.js';

const password = 'Test-only correct horse battery staple';
test.setTimeout(120_000); // Two real authenticated contexts and a complete commerce chain.
const apiResponse = (page, path, method) =>
  page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === '/api/v1' + path &&
      r.request().method() === method,
  );

async function login(page, email, destination = '/account') {
  await page.goto('/login?returnTo=' + encodeURIComponent(destination));
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  const response = apiResponse(page, '/auth/login', 'POST');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  expect((await response).status()).toBe(200);
  await expect(page).toHaveURL(destination);
}

async function purchase(page, email, product, expectedTotal) {
  await page.goto('/register?returnTo=%2Faccount');
  for (const [label, value] of [
    ['First name', 'Journey'],
    ['Last name', 'Customer'],
    ['Email', email],
    ['Password', password],
  ])
    await page.getByLabel(label, { exact: true }).fill(value);
  await page
    .getByRole('button', { name: 'Create account', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Your account', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL(/\/login/);
  await login(page, email);

  await page.goto('/categories');
  await page
    .locator('.category-card h2')
    .getByRole('link', { name: 'Home & Living', exact: true })
    .click();
  await expect(page).toHaveURL('/category/home-living');
  await expect(page.getByRole('article').first()).toBeVisible();
  const search = page.getByRole('banner').getByLabel('Search products');
  await search.fill(product.sku);
  await search.press('Enter');
  await expect(page).toHaveURL(new RegExp('/search\\?q=' + product.sku));
  await page
    .getByRole('article')
    .filter({ hasText: product.name })
    .getByRole('link', { name: product.name, exact: true })
    .click();
  await expect(page).toHaveURL('/products/' + product.slug);
  await page
    .getByRole('button', { name: `Add to cart: ${product.name}`, exact: true })
    .click();
  await expect(page.getByLabel('1 items in cart')).toBeVisible();
  await page.goto('/account');
  await page
    .getByRole('link', { name: 'Delivery addresses', exact: true })
    .click();
  for (const [label, value] of [
    ['Address label', 'Journey Home'],
    ['Recipient name', 'Journey Customer'],
    ['Phone number', '+84 912345678'],
    ['Address line 1', '12 Market Street'],
    ['Ward', 'Ward 1'],
    ['District', 'District 3'],
    ['Province or city', 'Ho Chi Minh City'],
  ])
    await page.getByLabel(label, { exact: true }).fill(value);
  await page.getByRole('button', { name: 'Add address', exact: true }).click();
  await expect(
    page
      .getByRole('listitem')
      .filter({ hasText: 'Journey Home' })
      .getByText('Default', { exact: true }),
  ).toBeVisible();
  await page
    .getByRole('banner')
    .getByRole('link', { name: 'Giỏ hàng', exact: true })
    .click();
  await page.getByLabel('Quantity').fill('2');
  await page.getByRole('button', { name: 'Update', exact: true }).click();
  await expect(page.getByLabel('2 items in cart')).toBeVisible();
  await page
    .getByRole('link', { name: 'Continue to checkout', exact: true })
    .click();
  await page.getByRole('radio').check();
  await expect(
    page.getByRole('button', { name: 'Place COD order', exact: true }),
  ).toBeEnabled();
  const response = apiResponse(page, '/checkout/orders', 'POST');
  await page
    .getByRole('button', { name: 'Place COD order', exact: true })
    .click();
  const committed = await response;
  expect(committed.status()).toBe(201);
  const { data: order } = await committed.json();
  expect(order.status).toBe('PENDING');
  expect(order.paymentMethod).toBe('COD');
  expect(order.total).toBe(expectedTotal);
  expect(order.items).toHaveLength(1);
  expect(order.items[0].quantity).toBe(2);
  expect(order.address.recipientName).toBe('Journey Customer');
  await expect(page).toHaveURL('/checkout/success/' + order.orderNumber);
  await expect(
    page.getByText('Your COD order was placed successfully.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel('0 items in cart')).toBeVisible();
  await page.reload();
  await expect(
    page.getByText(
      'This session has no confirmed submission for this order number. An order number alone does not confirm an order.',
      { exact: true },
    ),
  ).toBeVisible();
  await page.goto('/account');
  await page.getByRole('link', { name: 'Order history', exact: true }).click();
  await page
    .getByRole('link', { name: order.orderNumber, exact: true })
    .click();
  await expect(page).toHaveURL('/account/orders/' + order.orderNumber);
  await expect(
    page.getByText('Status: PENDING', { exact: true }),
  ).toBeVisible();
  const detailResponse = apiResponse(
    page,
    '/orders/by-number/' + order.orderNumber,
    'GET',
  );
  await page.reload();
  const fetchedDetail = await detailResponse;
  const detail = (await fetchedDetail.json()).data;
  expect(detail.id).toBe(order.id);
  expect(detail.total).toBe(order.total);
  expect(detail.statusHistory.map((entry) => entry.toStatus)).toEqual([
    'PENDING',
  ]);
  const summary = page.getByRole('region', {
    name: 'Order summary',
    exact: true,
  });
  await expect(
    summary
      .locator('dt')
      .filter({ hasText: /^Total$/ })
      .locator('..')
      .locator('dd'),
  ).toHaveText(expectedTotal === '250000' ? '250.000 ₫' : '698.000 ₫');
  return {
    order,
    customerAuthorization: fetchedDetail.request().headers().authorization,
  };
}

async function fixture(testInfo) {
  const database = createDatabase(e2eDatabaseUrl());
  const key = `${testInfo.project.name}-${testInfo.repeatEachIndex}`;
  const emails = [];
  const products = [];
  const errors = [];
  return {
    ...database,
    key,
    emails,
    products,
    observe(page) {
      page.on('pageerror', (error) => errors.push(error.message));
    },
    async finish() {
      try {
        await database.prisma.product.updateMany({
          where: { id: { in: products } },
          data: { status: 'ARCHIVED', archivedAt: new Date() },
        });
        await database.prisma.user.updateMany({
          where: { email: { in: emails } },
          data: { status: 'ARCHIVED', archivedAt: new Date() },
        });
        expect(errors).toEqual([]);
      } finally {
        await database.close();
      }
    },
  };
}

test('Customer real registration/login -> browse/search/PDP -> cart/address -> COD -> owned order detail', async ({
  page,
}, testInfo) => {
  const f = await fixture(testInfo);
  f.observe(page);
  const email = `journey-customer-${f.key}@example.test`;
  f.emails.push(email);
  try {
    const category = await f.prisma.category.findUniqueOrThrow({
      where: { slug: 'home-living' },
    });
    const product = await f.prisma.product.create({
      data: {
        categoryId: category.id,
        sku: 'JC-' + f.key.toUpperCase(),
        slug: 'journey-customer-' + f.key,
        name: 'Journey Cup ' + f.key,
        sellingUnit: 'each',
        status: 'ACTIVE',
        publishedAt: new Date(),
        prices: {
          create: { price: 110000n, startsAt: new Date('2020-01-01') },
        },
        inventory: { create: { quantityOnHand: 5 } },
      },
    });
    f.products.push(product.id);
    const { order } = await purchase(page, email, product, '250000');
    expect(await f.prisma.order.count({ where: { user: { email } } })).toBe(1);
    expect(
      await f.prisma.inventoryMovement.count({
        where: { orderId: order.id, type: 'ORDER_DEBIT' },
      }),
    ).toBe(1);
    expect(
      (
        await f.prisma.inventory.findUniqueOrThrow({
          where: { productId: product.id },
        })
      ).quantityOnHand,
    ).toBe(3);
  } finally {
    await f.finish();
  }
});

test('Admin real login -> UI product/inventory/order -> authenticated transition API -> authoritative detail', async ({
  page,
  browser,
}, testInfo) => {
  const f = await fixture(testInfo);
  f.observe(page);
  const adminEmail = `journey-admin-${f.key}@example.test`;
  const customerEmail = `journey-buyer-${f.key}@example.test`;
  f.emails.push(adminEmail, customerEmail);
  const buyerContext = await browser.newContext({
    viewport: page.viewportSize(),
    baseURL: 'http://127.0.0.1:13000',
  });
  const buyer = await buyerContext.newPage();
  f.observe(buyer);
  try {
    const admin = await f.prisma.user.create({
      data: {
        email: adminEmail,
        passwordHash: await hashPassword(password),
        firstName: 'Journey',
        lastName: 'Admin',
        role: 'ADMIN',
      },
    });
    await login(page, adminEmail, '/admin/products');
    const name = 'Journey Lamp ' + f.key;
    const sku = 'JA-' + f.key.toUpperCase();
    const slug = 'journey-admin-' + f.key;
    await expect(
      page.getByRole('heading', { name: 'Product management', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Create product', exact: true }),
    ).toBeVisible();
    for (const [label, value] of [
      ['Product name', name],
      ['SKU', sku],
      ['URL slug', slug],
      ['Price (VND)', '349000'],
    ])
      await page.getByLabel(label, { exact: true }).fill(value);
    await page
      .getByLabel('Category', { exact: true })
      .selectOption({ label: 'Home & Living' });
    const created = apiResponse(page, '/admin/products', 'POST');
    await page
      .getByRole('button', { name: 'Create draft', exact: true })
      .click();
    const createResponse = await created;
    expect(createResponse.status()).toBe(201);
    const product = (await createResponse.json()).data;
    f.products.push(product.id);
    await expect(
      page.getByText(name + ' was created as a draft.', { exact: true }),
    ).toBeVisible();
    await page
      .getByRole('button', { name: 'Publish ' + name, exact: true })
      .click();
    await expect(
      page.getByText(name + ' was published.', { exact: true }),
    ).toBeVisible();
    await page
      .getByRole('button', { name: 'Edit ' + name, exact: true })
      .click();
    await page.getByLabel('Signed adjustment').fill('5');
    await page
      .getByLabel('Reason', { exact: true })
      .fill('Journey initial count');
    await page
      .getByRole('button', { name: 'Adjust stock', exact: true })
      .click();
    await expect(
      page.getByText('Stock adjusted from 0 to 5.', { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('cell', { name: 'Journey initial count', exact: true }),
    ).toBeVisible();
    const { order, customerAuthorization } = await purchase(
      buyer,
      customerEmail,
      { ...product, sku, slug, name },
      '698000',
    );
    await page.getByRole('link', { name: 'Orders', exact: true }).click();
    await page
      .getByLabel('Search orders', { exact: true })
      .fill(order.orderNumber);
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    const detailRequest = page.waitForRequest(
      (r) =>
        new URL(r.url()).pathname === `/api/v1/admin/orders/${order.id}` &&
        r.method() === 'GET',
    );
    await page
      .getByRole('link', { name: order.orderNumber, exact: true })
      .click();
    const authorization = (await detailRequest).headers().authorization;
    expect(typeof authorization).toBe('string');
    await expect(
      page.getByRole('heading', { name: 'Order detail', exact: true }),
    ).toBeVisible();
    const commandPath = `/api/v1/admin/orders/${order.id}/transitions`;
    const denied = await buyer.request.post(commandPath, {
      headers: { Authorization: customerAuthorization },
      data: { expectedStatus: 'PENDING', toStatus: 'CONFIRMED' },
    });
    expect(denied.status()).toBe(403);
    const transitioned = await page.request.post(commandPath, {
      headers: { Authorization: authorization },
      data: { expectedStatus: 'PENDING', toStatus: 'CONFIRMED' },
    });
    expect(transitioned.status()).toBe(200);
    const authoritative = (await transitioned.json()).data;
    expect(authoritative.status).toBe('CONFIRMED');
    expect(authoritative.total).toBe(order.total);
    expect(authoritative.statusHistory.map((entry) => entry.status)).toEqual([
      'PENDING',
      'CONFIRMED',
    ]);
    expect(authoritative.statusHistory[1].actorUserId).toBe(admin.id);
    await page.reload();
    await expect(
      page.getByRole('heading', { name: 'Order detail', exact: true }),
    ).toBeVisible();
    const history = page.getByRole('region', {
      name: 'Complete status history',
      exact: true,
    });
    await expect(history.getByRole('listitem')).toHaveCount(2);
    await expect(
      history
        .getByRole('listitem')
        .last()
        .getByText('CONFIRMED', { exact: true }),
    ).toBeVisible();
    await expect(
      history
        .getByRole('listitem')
        .last()
        .getByText('Actor user ID: ' + admin.id, { exact: true }),
    ).toBeVisible();
    await expect(
      page.locator('main header').getByText('CONFIRMED', { exact: true }),
    ).toBeVisible();
    expect(
      await f.prisma.adminAuditLog.count({
        where: { entityId: order.id, action: 'ORDER_STATUS_TRANSITION' },
      }),
    ).toBe(1);
  } finally {
    await buyerContext.close();
    await f.finish();
  }
});
