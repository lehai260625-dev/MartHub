import { test, expect } from '@playwright/test';
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
async function audit(page, testInfo, name) {
  expect(
    await page.evaluate(
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
    path: testInfo.outputPath(name + '.png'),
    fullPage: true,
  });
}

test('register, safe return, reload recovery, logout and login use real sessions', async ({
  page,
  context,
}, testInfo) => {
  const email = 'e2e-auth-' + randomUUID() + '@example.test';
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.goto('/account?returnProbe=1');
    await expect(page).toHaveURL(/\/login\?returnTo=/);
    expect(new URL(page.url()).searchParams.get('returnTo')).toBe(
      '/account?returnProbe=1',
    );
    await audit(page, testInfo, 'login');
    await page.getByRole('link', { name: 'Create an account' }).click();
    await expect(
      page.getByRole('heading', { name: 'Create your account' }),
    ).toBeVisible();
    await page.getByLabel('First name', { exact: true }).fill('Minh');
    await page.getByLabel('Last name', { exact: true }).fill('Nguyen');
    await page.getByLabel('Email', { exact: true }).fill(email);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await audit(page, testInfo, 'register');
    await page
      .getByRole('button', { name: 'Create account', exact: true })
      .click();
    await expect(page).toHaveURL('/account?returnProbe=1');
    await expect(
      page.getByRole('heading', { name: 'Your account', exact: true }),
    ).toBeVisible();
    const cookie = (await context.cookies()).find(
      (item) => item.name === 'mh_refresh',
    );
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.sameSite).toBe('Lax');
    expect(cookie.path).toBe('/api/v1/auth');
    expect(
      await page.evaluate(() => ({
        local: Object.keys(localStorage),
        session: Object.keys(sessionStorage),
      })),
    ).toEqual({ local: [], session: [] });
    await page.reload();
    await expect(
      page.getByRole('heading', { name: 'Your account', exact: true }),
    ).toBeVisible();
    expect(
      (await context.cookies()).find((item) => item.name === 'mh_refresh')
        .value,
    ).not.toBe(cookie.value);
    await audit(page, testInfo, 'account');
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page).toHaveURL(/\/login/);
    expect(
      (await context.cookies()).some((item) => item.name === 'mh_refresh'),
    ).toBe(false);
    await page.reload();
    await page.getByLabel('Email', { exact: true }).fill(email);
    await page
      .getByLabel('Password', { exact: true })
      .fill('Incorrect password for this test');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(
      page.getByText('Email or password is incorrect.', { exact: true }),
    ).toBeVisible();
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByLabel('Password', { exact: true }).press('Enter');
    await expect(
      page.getByRole('heading', { name: 'Your account', exact: true }),
    ).toBeVisible();
    await page
      .getByRole('button', { name: 'Sign out everywhere', exact: true })
      .click();
    await expect(page).toHaveURL(/\/login/);
    expect(errors).toEqual([]);
  } finally {
    await cleanAccount(email);
  }
});

test('auth bootstrap service failure offers retry and preserves the protected destination', async ({
  page,
}) => {
  let fail = true;
  await page.route('**/api/v1/auth/refresh', (route) =>
    fail
      ? route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({
            error: {
              code: 'SERVICE_UNAVAILABLE',
              message: 'Please try again.',
              requestId: 'e2e_retry',
            },
          }),
        })
      : route.continue(),
  );
  await page.goto('/account?returnProbe=retry');
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  fail = false;
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page).toHaveURL(/\/login\?returnTo=/);
  expect(new URL(page.url()).searchParams.get('returnTo')).toBe(
    '/account?returnProbe=retry',
  );
});
