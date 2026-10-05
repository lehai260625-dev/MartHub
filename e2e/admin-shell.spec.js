import { expect, test } from './helpers/security-test.js';
import AxeBuilder from '@axe-core/playwright';
import { mockAdminSession } from './helpers/admin-session.js';
import { statisticsFixture } from '../apps/web/test/fixtures/statistics.js';

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
  await page.route('**/api/v1/admin/statistics/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(statisticsFixture(route.request().url())),
    }),
  );

  await page.goto('/admin');

  await expect(
    page.getByRole('heading', { name: 'Statistics dashboard' }),
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
