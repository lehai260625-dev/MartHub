import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import { StatisticsDashboard } from '../features/admin/statistics-dashboard';
import {
  parseDashboardRange,
  resolveDashboardRange,
  validCustomRange,
} from '../features/admin/statistics-range';
import { createApiClient, ApiClientError } from '../lib/api/core';
import {
  statisticsFixture,
  statisticsLow,
  statisticsOverview,
  statisticsRange,
  statisticsTop,
} from './fixtures/statistics';

const nav = vi.hoisted(() => ({
  search: '',
  listeners: new Set(),
  push: vi.fn(),
  replace: vi.fn(),
}));
const auth = vi.hoisted(() => ({
  request: vi.fn(),
  user: { id: 'b2ecb79a-b74a-4748-93dc-f2fc02b93b3d' },
}));
vi.mock('next/navigation', async () => {
  const { useSyncExternalStore } = await import('react');
  return {
    useRouter: () => nav,
    useSearchParams: () =>
      new URLSearchParams(
        useSyncExternalStore(
          (fn) => {
            nav.listeners.add(fn);
            return () => nav.listeners.delete(fn);
          },
          () => nav.search,
        ),
      ),
  };
});
vi.mock('../features/auth/auth-provider', () => ({ useAuth: () => auth }));
function navigate(href) {
  nav.search = href.split('?')[1] ?? '';
  nav.listeners.forEach((listener) => listener());
}
function mount() {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <StatisticsDashboard />
    </QueryClientProvider>,
  );
}
const section = (name) => within(screen.getByRole('region', { name }));
beforeEach(() => {
  nav.search = '';
  nav.push.mockReset().mockImplementation(navigate);
  nav.replace.mockReset().mockImplementation(navigate);
  auth.request
    .mockReset()
    .mockImplementation(async (path, options) =>
      options.schema.parse(statisticsFixture(path)),
    );
});

test('default backend-anchored range, exact unbounded VND/counts, ranking, snapshots and current zero stock', async () => {
  mount();
  await screen.findByText('OUT_OF_STOCK · Zero stock');
  await screen.findByText(
    'Historical snapshot product with a long immutable name',
  );
  expect(screen.getByRole('button', { name: 'Last 30 days' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(
    section('Order overview').getByText('18.446.744.073.709.551.614 ₫'),
  ).toBeVisible();
  expect(
    section('Order overview').getAllByText('9,007,199,254,740,993'),
  ).toHaveLength(2);
  expect(section('Top products').getByText('#1')).toBeVisible();
  expect(
    section('Top products').getByText('SKU: HISTORICAL-SKU'),
  ).toBeVisible();
  expect(
    section('Low stock').getByText('9.007.199.254.740.993 ₫'),
  ).toBeVisible();
  expect(
    section('Top products').queryByText('Current operational product'),
  ).not.toBeInTheDocument();
  expect(auth.request).toHaveBeenCalledWith(
    '/admin/statistics/top-products?from=2026-09-05&to=2026-10-04&timezone=Asia%2FHo_Chi_Minh&limit=10',
    expect.anything(),
  );
  expect(screen.getByText(/Selected range:/)).toHaveTextContent(
    '2026-09-05 to 2026-10-04',
  );
  expect(section('Low stock').getByText(/Threshold: 5/)).toBeVisible();
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
});

test('7d/90d apply immediately, same explicit dated requests and low-stock cache independence, reset omits defaults', async () => {
  mount();
  await screen.findByText(
    'Historical snapshot product with a long immutable name',
  );
  for (const [label, from, range] of [
    ['Last 7 days', '2026-09-28', '7d'],
    ['Last 90 days', '2026-07-07', '90d'],
  ]) {
    fireEvent.click(screen.getByRole('button', { name: label }));
    await waitFor(() =>
      expect(
        section('Order overview').getByText(/Overview range:/),
      ).toHaveTextContent(from),
    );
    await waitFor(() =>
      expect(
        section('Top products').getByText(/Top-products range:/),
      ).toHaveTextContent(from),
    );
    const query = `from=${from}&to=2026-10-04&timezone=Asia%2FHo_Chi_Minh`;
    expect(auth.request).toHaveBeenCalledWith(
      '/admin/statistics/overview?' + query,
      expect.anything(),
    );
    expect(auth.request).toHaveBeenCalledWith(
      '/admin/statistics/top-products?' + query + '&limit=10',
      expect.anything(),
    );
    expect(nav.push).toHaveBeenLastCalledWith('/admin?range=' + range, {
      scroll: false,
    });
  }
  expect(
    auth.request.mock.calls.filter(([path]) => path.includes('low-stock')),
  ).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Reset range' }));
  expect(nav.push).toHaveBeenLastCalledWith('/admin', { scroll: false });
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Last 30 days' }),
    ).toHaveAttribute('aria-pressed', 'true'),
  );
});

test('custom local draft, pre-submit validation, Apply and URL/history state restore', async () => {
  mount();
  await screen.findByText(
    'Historical snapshot product with a long immutable name',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Custom', exact: true }));
  const change = (from, to) => {
    fireEvent.change(screen.getByLabelText('From (required)'), {
      target: { value: from },
    });
    fireEvent.change(screen.getByLabelText('To (required)'), {
      target: { value: to },
    });
  };
  const before = auth.request.mock.calls.length;
  for (const [from, to] of [
    ['', ''],
    ['2026-10-04', '2026-10-03'],
    ['2025-01-01', '2026-10-04'],
    ['2026-10-01', '2026-10-05'],
  ]) {
    change(from, to);
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Enter both valid dates',
    );
  }
  expect(nav.push).not.toHaveBeenCalled();
  expect(auth.request).toHaveBeenCalledTimes(before);
  change('2026-08-01', '2026-08-03');
  expect(nav.search).toBe('');
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
  await waitFor(() =>
    expect(
      section('Top products').getByText(/Top-products range:/),
    ).toHaveTextContent('2026-08-01 to 2026-08-03'),
  );
  expect(nav.search).toBe('range=custom&from=2026-08-01&to=2026-08-03');
  act(() => navigate('/admin?range=7d'));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Last 7 days' })).toHaveAttribute(
      'aria-pressed',
      'true',
    ),
  );
  act(() => navigate('/admin?range=custom&from=2026-08-01&to=2026-08-03'));
  expect(screen.getByLabelText('From (required)')).toHaveValue('2026-08-01');
  expect(screen.getByLabelText('To (required)')).toHaveValue('2026-08-03');
});

test.each([
  'range=bad',
  'range=custom&from=2026-09-01',
  'range=custom&from=2026-02-30&to=2026-03-01',
  'range=7d&range=90d',
  'range=custom&from=2025-01-01&to=2026-10-04',
  'range=custom&from=2026-10-01&to=2026-10-05',
])(
  'invalid URL recovers visibly and removes invalid canonical query: %s',
  async (search) => {
    nav.search = search;
    mount();
    await screen.findByText('The invalid range was reset to Last 30 days.');
    await waitFor(() => expect(nav.search).toBe(''));
    expect(nav.replace).toHaveBeenCalledWith('/admin', { scroll: false });
    await screen.findByText(
      'Historical snapshot product with a long immutable name',
    );
  },
);

test('backend 422 custom range also recovers without hiding independent low stock', async () => {
  nav.search = 'range=custom&from=2026-09-01&to=2026-09-02';
  auth.request.mockImplementation(async (path) => {
    if (path.includes('from=2026-09-01'))
      throw new ApiClientError('Invalid range', { status: 422 });
    return statisticsFixture(path);
  });
  mount();
  await screen.findByText('The invalid range was reset to Last 30 days.');
  await screen.findByText('OUT_OF_STOCK · Zero stock');
  expect(nav.search).toBe('');
});

test('zero KPI/status values, top/low empty and partial empty stay usable', async () => {
  auth.request.mockImplementation(async (path) =>
    statisticsFixture(path, { zero: true, topEmpty: true, lowEmpty: true }),
  );
  const view = mount();
  await screen.findByText('No delivered product sales in this range.');
  await screen.findByText('No low-stock products at this threshold.');
  expect(section('Order overview').getByText('0 ₫')).toBeVisible();
  expect(section('Order overview').getAllByText('0')).toHaveLength(9);
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  view.unmount();
  auth.request.mockImplementation(async (path) =>
    statisticsFixture(path, { topEmpty: true }),
  );
  mount();
  await screen.findByText('No delivered product sales in this range.');
  await screen.findByText('OUT_OF_STOCK · Zero stock');
  expect(
    section('Order overview').getByText('18.446.744.073.709.551.614 ₫'),
  ).toBeVisible();
});

test.each(['overview', 'top-products', 'low-stock'])(
  'independent %s error/retry does not refetch successful sections',
  async (endpoint) => {
    let fail = true;
    auth.request.mockImplementation(async (path) => {
      if (
        new URL(path, 'http://test').pathname.endsWith('/' + endpoint) &&
        fail
      )
        throw new Error('offline');
      return statisticsFixture(path);
    });
    mount();
    const label = {
      overview: 'overview',
      'top-products': 'top products',
      'low-stock': 'low stock',
    }[endpoint];
    await screen.findByRole('button', { name: 'Retry ' + label });
    if (endpoint !== 'low-stock')
      await screen.findByText('OUT_OF_STOCK · Zero stock');
    if (endpoint === 'overview')
      await screen.findByText(
        'Historical snapshot product with a long immutable name',
      );
    if (endpoint !== 'overview')
      await waitFor(() =>
        expect(section('Order overview').getByText('Revenue')).toBeVisible(),
      );
    const lowCalls = auth.request.mock.calls.filter(([path]) =>
      path.includes('low-stock'),
    ).length;
    const topCalls = auth.request.mock.calls.filter(([path]) =>
      path.includes('top-products'),
    ).length;
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry ' + label }));
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'Retry ' + label }),
      ).not.toBeInTheDocument(),
    );
    await screen.findByText(
      'Historical snapshot product with a long immutable name',
    );
    if (endpoint !== 'low-stock')
      expect(
        auth.request.mock.calls.filter(([path]) => path.includes('low-stock')),
      ).toHaveLength(lowCalls);
    if (endpoint === 'overview')
      expect(
        auth.request.mock.calls.filter(([path]) =>
          path.includes('top-products'),
        ),
      ).toHaveLength(topCalls);
  },
);

test('independent loading and out-of-order responses never display two final ranges', async () => {
  let resolveTop;
  auth.request.mockImplementation(async (path) => {
    if (path.includes('top-products') && path.includes('from=2026-09-28'))
      return new Promise((resolve) => {
        resolveTop = resolve;
      });
    return statisticsFixture(path);
  });
  mount();
  await screen.findByText(
    'Historical snapshot product with a long immutable name',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Last 7 days' }));
  await waitFor(() =>
    expect(
      section('Order overview').getByText(/Overview range:/),
    ).toHaveTextContent('2026-09-28'),
  );
  expect(section('Top products').getByRole('status')).toHaveTextContent(
    'Loading top products',
  );
  expect(
    section('Top products').queryByText(/Top-products range:/),
  ).not.toBeInTheDocument();
  expect(
    section('Low stock').getByText('OUT_OF_STOCK · Zero stock'),
  ).toBeVisible();
  resolveTop(statisticsTop(statisticsRange('2026-09-28')));
  await waitFor(() =>
    expect(
      section('Top products').getByText(/Top-products range:/),
    ).toHaveTextContent('2026-09-28'),
  );
});

test('initial per-section loading preserves populated sibling data', async () => {
  let resolveLow;
  auth.request.mockImplementation(async (path) =>
    path.includes('low-stock')
      ? new Promise((resolve) => {
          resolveLow = resolve;
        })
      : statisticsFixture(path),
  );
  mount();
  expect(section('Order overview').getByRole('status')).toHaveTextContent(
    'Loading overview',
  );
  expect(section('Top products').getByRole('status')).toHaveTextContent(
    'Loading top products',
  );
  await screen.findByText(
    'Historical snapshot product with a long immutable name',
  );
  expect(section('Low stock').getByRole('status')).toHaveTextContent(
    'Loading low stock',
  );
  resolveLow(statisticsLow());
  await screen.findByText('OUT_OF_STOCK · Zero stock');
});

test('real API client validates all schemas, redacts unexpected fields and keeps no-store', async () => {
  let corrupt = false;
  const fetchImpl = vi.fn(async (path) => {
    const payload = statisticsFixture(path);
    if (corrupt && path.includes('top-products'))
      payload.data.secret = 'internal';
    return Response.json(payload);
  });
  const request = createApiClient({ fetchImpl });
  auth.request.mockImplementation(request);
  const view = mount();
  await screen.findByText(
    'Historical snapshot product with a long immutable name',
  );
  expect(
    fetchImpl.mock.calls.every(([, options]) => options.cache === 'no-store'),
  ).toBe(true);
  view.unmount();
  corrupt = true;
  mount();
  await screen.findByRole('button', { name: 'Retry top products' });
  expect(screen.queryByText('internal')).not.toBeInTheDocument();
  expect(
    screen.queryByText(
      'Historical snapshot product with a long immutable name',
    ),
  ).not.toBeInTheDocument();
});

test('calendar helper uses only backend anchor across leap year and shared range bounds', () => {
  expect(
    resolveDashboardRange({ range: '7d' }, { to: '2024-03-01' }),
  ).toMatchObject({ from: '2024-02-24', to: '2024-03-01' });
  expect(validCustomRange('2024-01-01', '2024-12-31')).toBe(true);
  expect(validCustomRange('2024-01-01', '2025-01-01')).toBe(false);
  expect(parseDashboardRange(new URLSearchParams('range=30d')).range).toBe(
    '30d',
  );
  expect(statisticsOverview().data.range).toEqual(statisticsRange());
});

test.each(['30d', '7d'])(
  'matching previous %s pair stays labeled and pending until the new pair arrives',
  async (initial) => {
    let resolveOverview;
    let resolveTop;
    nav.search = 'range=' + initial;
    auth.request.mockImplementation(async (path) => {
      if (path.includes('from=2026-07-07'))
        return new Promise((resolve) => {
          if (path.includes('overview')) resolveOverview = resolve;
          else resolveTop = resolve;
        });
      return statisticsFixture(path);
    });
    mount();
    await screen.findByText(
      'Historical snapshot product with a long immutable name',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Last 90 days' }));
    await screen.findByText('Updating overview...');
    expect(section('Top products').getByRole('status')).toHaveTextContent(
      'Updating top products',
    );
    expect(
      section('Order overview').getByText(/Overview range:/),
    ).toHaveTextContent(initial === '30d' ? '2026-09-05' : '2026-09-28');
    expect(
      section('Top products').getByText(/Top-products range:/),
    ).toHaveTextContent(initial === '30d' ? '2026-09-05' : '2026-09-28');
    resolveOverview(statisticsOverview(statisticsRange('2026-07-07')));
    await waitFor(() =>
      expect(
        section('Order overview').getByText(/Overview range:/),
      ).toHaveTextContent('2026-07-07'),
    );
    expect(
      section('Top products').queryByText(/Top-products range:/),
    ).not.toBeInTheDocument();
    resolveTop(statisticsTop(statisticsRange('2026-07-07')));
    await waitFor(() =>
      expect(
        section('Top products').getByText(/Top-products range:/),
      ).toHaveTextContent('2026-07-07'),
    );
  },
);

test('schema-valid but mismatched dated response becomes a section retry, not stale visible data', async () => {
  auth.request.mockImplementation(async (path) =>
    path.includes('top-products')
      ? statisticsTop(statisticsRange('2026-01-01', '2026-01-02'))
      : statisticsFixture(path),
  );
  mount();
  await screen.findByRole('button', { name: 'Retry top products' });
  expect(
    section('Top products').queryByText(
      'Historical snapshot product with a long immutable name',
    ),
  ).not.toBeInTheDocument();
  expect(section('Order overview').getByText('Revenue')).toBeVisible();
});

test('reset also clears an unapplied custom draft while already at the default URL', async () => {
  mount();
  await screen.findByText(
    'Historical snapshot product with a long immutable name',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Custom', exact: true }));
  fireEvent.change(screen.getByLabelText('From (required)'), {
    target: { value: '2026-08-01' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Reset range' }));
  expect(screen.queryByLabelText('From (required)')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Last 30 days' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(nav.search).toBe('');
});
