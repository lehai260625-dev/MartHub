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

test('authorized admin shell is accessible and responsive', async ({
  page,
}) => {
  await mockAdminSession(page, admin);

  await page.goto('/admin');

  await expect(
    page.getByRole('heading', { name: 'Admin workspace' }),
  ).toBeVisible();
  await expect(
    page.getByRole('navigation', { name: 'Admin navigation' }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Overview' })).toBeVisible();
  await expect(page.locator('head meta[name="robots"]')).toHaveAttribute(
    'content',
    /noindex/,
  );
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
