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
const initial = {
  id: '0e7b73b7-9db0-4ae0-80b5-08e4049162cf',
  email: 'customer-with-a-long-safe-identity@example.test',
  firstName: 'Safe',
  lastName: 'Customer',
  role: 'CUSTOMER',
  status: 'ACTIVE',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  archivedAt: null,
};
async function accessible(page) {
  expect(
    await page.evaluate(
      // eslint-disable-next-line no-undef -- Browser execution.
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
test('Admin URL-owned users journey confirms disable/reactivate/archive with keyboard and safe detail', async ({
  page,
}) => {
  let user = { ...initial };
  const commands = [];
  await mockAdminSession(page, admin);
  await page.route('**/api/v1/admin/users**', async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === 'PATCH') {
      const command = route.request().postDataJSON();
      commands.push(command);
      user = {
        ...user,
        status: command.toStatus,
        updatedAt: '2026-10-04T00:00:00.000Z',
        archivedAt:
          command.toStatus === 'ARCHIVED' ? '2026-10-04T00:00:00.000Z' : null,
      };
    }
    const payload =
      url.pathname !== '/api/v1/admin/users'
        ? { data: user }
        : {
            data: [user],
            meta: {
              page: Number(url.searchParams.get('page') ?? 1),
              perPage: Number(url.searchParams.get('perPage') ?? 20),
              totalItems: 51,
              totalPages: 2,
            },
          };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'Cache-Control': 'no-store' },
      body: JSON.stringify(payload),
    });
  });
  await page.goto('/admin/users?role=CUSTOMER&sort=email&page=2&perPage=50');
  await expect(
    page.getByRole('heading', { name: 'Users', exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel('Role')).toHaveValue('CUSTOMER');
  await expect(
    page.getByRole('link', { name: 'Previous page' }),
  ).toHaveAttribute('href', '/admin/users?role=CUSTOMER&sort=email&perPage=50');
  await accessible(page);
  await page.getByLabel('Search users').fill('  Safe   Customer  ');
  await page.getByLabel('Search users').press('Enter');
  await expect(page).toHaveURL(
    '/admin/users?q=Safe+Customer&role=CUSTOMER&sort=email&perPage=50',
  );
  await page.reload();
  await expect(page.getByLabel('Search users')).toHaveValue('Safe Customer');
  await page.getByRole('link', { name: user.email }).focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(`/admin/users/${user.id}`);
  await expect(
    page.getByRole('heading', { name: 'User detail' }),
  ).toBeVisible();
  await accessible(page);
  await page.getByRole('button', { name: 'Disable account' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText('Confirm disabling this account')).toBeVisible();
  await page.getByLabel('Reason (required)').fill('  Review account  ');
  await accessible(page);
  await page.getByRole('button', { name: 'Confirm status change' }).click();
  await expect(page.getByText('Account status updated.')).toBeVisible();
  expect(commands[0]).toEqual({
    expectedStatus: 'ACTIVE',
    toStatus: 'SUSPENDED',
    reason: 'Review account',
  });
  await page.getByRole('button', { name: 'Reactivate account' }).click();
  await expect(page.getByLabel('Reason (required)')).toHaveCount(0);
  await page.getByRole('button', { name: 'Confirm status change' }).click();
  await expect(
    page.getByRole('button', { name: 'Disable account' }),
  ).toBeVisible();
  expect(commands[1]).toEqual({
    expectedStatus: 'SUSPENDED',
    toStatus: 'ACTIVE',
  });
  await page.getByRole('button', { name: 'Archive account' }).click();
  await expect(
    page.getByText(
      'Archiving is permanent. Existing sessions will be revoked.',
    ),
  ).toBeVisible();
  await page.getByLabel('Reason (required)').fill('Archive account');
  await page.getByRole('button', { name: 'Confirm status change' }).click();
  await expect(
    page.getByText('This archived account cannot be changed.'),
  ).toBeVisible();
  await accessible(page);
  await page.getByRole('button', { name: 'Back to users' }).click();
  await expect(page).toHaveURL(
    '/admin/users?q=Safe+Customer&role=CUSTOMER&sort=email&perPage=50',
  );
  await expect(page.getByLabel('Search users')).toHaveValue('Safe Customer');
});
