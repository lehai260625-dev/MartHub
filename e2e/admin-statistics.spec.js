import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mockAdminSession } from './helpers/admin-session.js';
import {
  statisticsAdmin,
  statisticsFixture,
} from '../apps/web/test/fixtures/statistics.js';

async function accessible(page, testInfo, state) {
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
  await page.screenshot({
    path: testInfo.outputPath(state + '.png'),
    fullPage: true,
  });
}

async function setup(page, handler) {
  await mockAdminSession(page, statisticsAdmin);
  await page.route('**/api/v1/admin/statistics/**', async (route) => {
    const path = new URL(route.request().url());
    const override = handler ? await handler(path) : undefined;
    if (override?.status) {
      await route.fulfill({
        status: override.status,
        contentType: 'application/json',
        body: JSON.stringify({
          error: {
            code: 'SERVICE_UNAVAILABLE',
            message: 'Temporarily unavailable.',
            requestId: 'e2e_statistics',
          },
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'Cache-Control': 'no-store' },
      body: JSON.stringify(statisticsFixture(path.href, override)),
    });
  });
}

const overview = (page) => page.getByRole('region', { name: 'Order overview' });
const top = (page) => page.getByRole('region', { name: 'Top products' });

test('dashboard range/URL journey, exact historical/current statistics, keyboard and Admin navigation', async ({
  page,
}, testInfo) => {
  const calls = [];
  await setup(page, (url) => {
    calls.push(url);
  });
  await page.goto('/admin');
  await expect(
    page.getByRole('heading', { name: 'Statistics dashboard' }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Last 30 days' }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(top(page).getByText('SKU: HISTORICAL-SKU')).toBeVisible();
  await expect(
    overview(page).getByText('18.446.744.073.709.551.614 ₫'),
  ).toBeVisible();
  await expect(page.getByText('OUT_OF_STOCK · Zero stock')).toBeVisible();
  await accessible(page, testInfo, 'populated-30d');
  await page.getByRole('button', { name: 'Last 7 days' }).focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL('/admin?range=7d');
  await expect(overview(page).getByText(/Overview range:/)).toContainText(
    '2026-09-28 to 2026-10-04',
  );
  await expect(top(page).getByText(/Top-products range:/)).toContainText(
    '2026-09-28 to 2026-10-04',
  );
  await page.getByRole('button', { name: 'Last 90 days' }).click();
  await expect(page).toHaveURL('/admin?range=90d');
  await expect(top(page).getByText(/Top-products range:/)).toContainText(
    '2026-07-07 to 2026-10-04',
  );
  expect(
    calls.filter((url) => url.pathname.endsWith('/low-stock')),
  ).toHaveLength(1);
  await page.getByRole('button', { name: 'Custom', exact: true }).click();
  await page.getByLabel('From (required)').fill('2026-08-01');
  await page.getByLabel('To (required)').fill('2026-08-03');
  await expect(page).toHaveURL('/admin?range=90d');
  await accessible(page, testInfo, 'custom-draft');
  await page.getByRole('button', { name: 'Apply', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(
    '/admin?range=custom&from=2026-08-01&to=2026-08-03',
  );
  await expect(top(page).getByText(/Top-products range:/)).toContainText(
    '2026-08-01 to 2026-08-03',
  );
  await page.reload();
  await expect(page.getByLabel('From (required)')).toHaveValue('2026-08-01');
  await expect(top(page).getByText(/Top-products range:/)).toContainText(
    '2026-08-01 to 2026-08-03',
  );
  await page.goBack();
  await expect(page).toHaveURL('/admin?range=90d');
  await page.goForward();
  await expect(page.getByLabel('To (required)')).toHaveValue('2026-08-03');
  await page.getByRole('button', { name: 'Reset range' }).click();
  await expect(page).toHaveURL('/admin');
  await expect(top(page).getByText(/Top-products range:/)).toContainText(
    '2026-09-05 to 2026-10-04',
  );
  await page.getByRole('link', { name: 'Overview', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('navigation', { name: 'Admin navigation' }),
  ).toBeVisible();
  await accessible(page, testInfo, 'reset');
});

test('invalid URL recovery, empty/zero/partial states and localized retry', async ({
  page,
}, testInfo) => {
  let mode = 'empty';
  const calls = [];
  await setup(page, (url) => {
    calls.push(url.pathname);
    if (mode === 'error' && url.pathname.endsWith('/top-products'))
      return { status: 503 };
    return {
      zero: mode === 'empty',
      topEmpty: mode === 'empty',
      lowEmpty: mode === 'empty',
    };
  });
  await page.goto('/admin?range=custom&from=bad');
  await expect(page).toHaveURL('/admin');
  await expect(
    page.getByText('The invalid range was reset to Last 30 days.'),
  ).toBeVisible();
  await expect(overview(page).getByText('0 ₫')).toBeVisible();
  await expect(
    top(page).getByText('No delivered product sales in this range.'),
  ).toBeVisible();
  await expect(
    page.getByText('No low-stock products at this threshold.'),
  ).toBeVisible();
  await accessible(page, testInfo, 'empty-recovered');
  mode = 'error';
  await page.reload();
  await expect(
    page.getByRole('button', { name: 'Retry top products' }),
  ).toBeVisible();
  await expect(
    overview(page).getByText('Revenue', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText('OUT_OF_STOCK · Zero stock')).toBeVisible();
  await accessible(page, testInfo, 'section-error');
  const lowCount = calls.filter((path) => path.endsWith('/low-stock')).length;
  const overviewCount = calls.filter((path) =>
    path.endsWith('/overview'),
  ).length;
  mode = 'populated';
  await page.getByRole('button', { name: 'Retry top products' }).focus();
  await page.keyboard.press('Enter');
  await expect(top(page).getByText('SKU: HISTORICAL-SKU')).toBeVisible();
  expect(calls.filter((path) => path.endsWith('/low-stock'))).toHaveLength(
    lowCount,
  );
  expect(calls.filter((path) => path.endsWith('/overview'))).toHaveLength(
    overviewCount,
  );
  await accessible(page, testInfo, 'retry-populated');
});

test('localized loading, range synchronization and partial empty remain accessible', async ({
  page,
}, testInfo) => {
  let releaseLow;
  let releaseTop;
  const lowWait = new Promise((resolve) => {
    releaseLow = resolve;
  });
  const topWait = new Promise((resolve) => {
    releaseTop = resolve;
  });
  await setup(page, async (url) => {
    if (url.pathname.endsWith('/low-stock')) await lowWait;
    if (
      url.pathname.endsWith('/top-products') &&
      url.searchParams.get('from') === '2026-09-28'
    ) {
      await topWait;
      return { topEmpty: true };
    }
  });
  await page.goto('/admin');
  await expect(top(page).getByText('SKU: HISTORICAL-SKU')).toBeVisible();
  await expect(
    page.getByRole('region', { name: 'Low stock' }).getByRole('status'),
  ).toContainText('Loading low stock');
  await accessible(page, testInfo, 'independent-loading');
  releaseLow();
  await expect(page.getByText('OUT_OF_STOCK · Zero stock')).toBeVisible();
  await page.getByRole('button', { name: 'Last 7 days' }).click();
  await expect(overview(page).getByText(/Overview range:/)).toContainText(
    '2026-09-28',
  );
  await expect(top(page).getByRole('status')).toContainText(
    'Loading top products',
  );
  await expect(top(page).getByText(/Top-products range:/)).toHaveCount(0);
  await accessible(page, testInfo, 'range-pending');
  releaseTop();
  await expect(
    top(page).getByText('No delivered product sales in this range.'),
  ).toBeVisible();
  await expect(
    overview(page).getByText('Revenue', { exact: true }),
  ).toBeVisible();
  await accessible(page, testInfo, 'partial-empty');
  await page.getByRole('button', { name: 'Custom', exact: true }).click();
  await page.getByLabel('From (required)').fill('2026-10-04');
  await page.getByLabel('To (required)').fill('2026-10-03');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(
    page
      .getByRole('form', { name: 'Custom statistics range' })
      .getByRole('alert'),
  ).toContainText('Enter both valid dates');
  await expect(page).toHaveURL('/admin?range=7d');
  await accessible(page, testInfo, 'custom-validation');
});
