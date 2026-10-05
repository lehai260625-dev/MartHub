import { test, expect } from './helpers/security-test.js';
import { randomUUID } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import { createDatabase } from '../apps/api/src/db/client.js';
import { validateDatabaseUrl } from '../apps/api/src/config/env.js';
import { throttleKey } from '../apps/api/src/modules/auth/throttle.js';

const password = 'Test-only correct horse battery staple';

async function cleanAccount(email) {
  const database = createDatabase(
    validateDatabaseUrl(process.env.DATABASE_URL),
  );
  try {
    await database.prisma.user.deleteMany({ where: { email } });
    await database.prisma.authThrottle.deleteMany({
      where: {
        key: {
          in: ['register', 'login'].map((operation) =>
            throttleKey(operation, 'email', email),
          ),
        },
      },
    });
  } finally {
    await database.close();
  }
}

async function fillAddress(page, label, line1) {
  await page.getByLabel('Address label').fill(label);
  await page.getByLabel('Recipient name').fill('Minh Nguyen');
  await page.getByLabel('Phone number').fill('+84 912 345 678');
  await page.getByLabel('Address line 1').fill(line1);
  await page.getByLabel('Ward').fill('Ward 1');
  await page.getByLabel('District').fill('District 3');
  await page.getByLabel('Province or city').fill('Ho Chi Minh City');
  await page.getByLabel('Postal code (optional)').fill('700000');
}

async function audit(page, testInfo, name) {
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
  await page.screenshot({
    path: testInfo.outputPath(`${name}.png`),
    fullPage: true,
  });
}

test('customer manages owned addresses and one default through the protected account UI', async ({
  page,
}, testInfo) => {
  const email = `e2e-address-${randomUUID()}@example.test`;
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  try {
    await page.goto('/register?returnTo=%2Faccount');
    await page.getByLabel('First name', { exact: true }).fill('Minh');
    await page.getByLabel('Last name', { exact: true }).fill('Nguyen');
    await page.getByLabel('Email', { exact: true }).fill(email);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Create account' }).click();
    await page.getByRole('link', { name: 'Delivery addresses' }).click();
    await expect(
      page.getByRole('heading', { name: 'Delivery addresses' }),
    ).toBeVisible();
    await expect(page.getByText('No delivery addresses yet.')).toBeVisible();
    await audit(page, testInfo, 'addresses-empty');

    await fillAddress(page, 'Home', '12 Market Street');
    await page.getByLabel('Postal code (optional)').press('Enter');
    const home = page.getByRole('listitem').filter({ hasText: 'Home' });
    await expect(home.getByText('Default')).toBeVisible();

    await fillAddress(page, 'Office', '20 Commerce Avenue');
    await page.getByRole('button', { name: 'Add address' }).click();
    const office = page.getByRole('listitem').filter({ hasText: 'Office' });
    await expect(office).toBeVisible();
    await office.getByRole('button', { name: 'Make Office default' }).click();
    await expect(
      page.getByText('Office is now your default address.'),
    ).toBeVisible();
    await expect(office.getByText('Default', { exact: true })).toBeVisible();
    await expect(home.getByText('Default', { exact: true })).not.toBeVisible();

    await office.getByRole('button', { name: 'Edit Office' }).click();
    await page.getByLabel('Address label').fill('Work');
    await page.getByRole('button', { name: 'Save changes' }).click();
    const work = page.getByRole('listitem').filter({ hasText: 'Work' });
    await expect(work).toBeVisible();
    await home.getByRole('button', { name: 'Remove Home' }).click();
    await home.getByRole('button', { name: 'Confirm remove' }).click();
    await expect(home).not.toBeVisible();
    await expect(page.getByText('Home was removed.')).toBeVisible();
    await audit(page, testInfo, 'addresses-managed');
    expect(pageErrors).toEqual([]);
  } finally {
    await cleanAccount(email);
  }
});
