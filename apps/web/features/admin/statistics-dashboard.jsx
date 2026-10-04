'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  STATISTICS_TIMEZONE,
  customerOrderStatusSchema,
  statisticsOverviewResponseSchema,
  statisticsTopProductsResponseSchema,
  statisticsLowStockResponseSchema,
} from '@marthub/contracts';
import { useAuth } from '../auth/auth-provider';
import { formatVnd } from '../catalog/catalog-query';
import { ApiClientError } from '../../lib/api/core';
import {
  dashboardHref,
  parseDashboardRange,
  resolveDashboardRange,
  sameStatisticsRange,
  validCustomRange,
} from './statistics-range';

const countFormatter = new Intl.NumberFormat('en-US');
const count = (value) => countFormatter.format(BigInt(value));
const presets = [
  ['7d', 'Last 7 days'],
  ['30d', 'Last 30 days'],
  ['90d', 'Last 90 days'],
];

async function checkedRange(response, expected) {
  const result = await response;
  if (!sameStatisticsRange(result.data.range, expected))
    throw new ApiClientError(
      'The statistics range did not match the request.',
      { code: 'INVALID_RESPONSE' },
    );
  return result;
}

function RangeControls({ applied, selected, today, apply, reset }) {
  const [custom, setCustom] = useState(applied.range === 'custom');
  const [from, setFrom] = useState(applied.from ?? selected?.from ?? '');
  const [to, setTo] = useState(applied.to ?? selected?.to ?? '');
  const [error, setError] = useState(false);
  return (
    <div className="mt-6 rounded-lg border border-neutral-300 bg-white p-4 sm:p-5">
      <div
        role="group"
        aria-label="Statistics range"
        className="flex flex-wrap gap-2"
      >
        {presets.map(([range, label]) => (
          <button
            key={range}
            type="button"
            className={
              !custom && applied.range === range
                ? 'button-primary'
                : 'button-secondary'
            }
            aria-pressed={!custom && applied.range === range}
            onClick={() => {
              setCustom(false);
              setError(false);
              apply({ range });
            }}
          >
            {label}
          </button>
        ))}
        <button
          type="button"
          className={custom ? 'button-primary' : 'button-secondary'}
          aria-pressed={custom}
          onClick={() => {
            if (!custom) {
              setFrom(applied.from ?? selected?.from ?? '');
              setTo(applied.to ?? selected?.to ?? '');
            }
            setCustom(true);
          }}
        >
          Custom
        </button>
        <button
          type="button"
          className="button-secondary"
          onClick={() => {
            setCustom(false);
            setError(false);
            reset();
          }}
        >
          Reset range
        </button>
      </div>
      {custom && (
        <form
          aria-label="Custom statistics range"
          noValidate
          className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"
          onSubmit={(event) => {
            event.preventDefault();
            if (!validCustomRange(from, to, today)) {
              setError(true);
              return;
            }
            setError(false);
            apply({ range: 'custom', from, to });
          }}
        >
          <label className="grid min-w-0 gap-2 font-medium">
            From (required)
            <input
              type="date"
              className="form-input min-w-0"
              required
              value={from}
              max={today}
              aria-invalid={error}
              aria-describedby={error ? 'range-error' : undefined}
              onChange={(event) => setFrom(event.target.value)}
            />
          </label>
          <label className="grid min-w-0 gap-2 font-medium">
            To (required)
            <input
              type="date"
              className="form-input min-w-0"
              required
              value={to}
              max={today}
              aria-invalid={error}
              aria-describedby={error ? 'range-error' : undefined}
              onChange={(event) => setTo(event.target.value)}
            />
          </label>
          <button className="button-primary self-end">Apply</button>
          {error && (
            <p
              id="range-error"
              role="alert"
              className="text-red-800 sm:col-span-3"
            >
              Enter both valid dates, in ascending order, within 366 days and
              not in the future.
            </p>
          )}
          <p className="text-sm text-neutral-600 sm:col-span-3">
            Dates are inclusive. Draft dates apply only after you press Apply.
          </p>
        </form>
      )}
    </div>
  );
}

function RangeLabel({ range, prefix = 'Selected range' }) {
  return (
    <p className="mt-2 break-words text-sm text-neutral-700">
      {prefix}:{' '}
      {range ? (
        <>
          <time dateTime={range.from}>{range.from}</time> to{' '}
          <time dateTime={range.to}>{range.to}</time> (inclusive)
        </>
      ) : (
        'Resolving backend calendar dates...'
      )}{' '}
      · {STATISTICS_TIMEZONE}
    </p>
  );
}

function SectionState({ query, label, children, visible = true }) {
  if (query.isError)
    return (
      <div role="alert" className="mt-4">
        <p>We could not load {label}.</p>
        <button
          className="button-secondary mt-3"
          onClick={() => query.refetch()}
        >
          Retry {label}
        </button>
      </div>
    );
  if (!query.data || !visible)
    return (
      <div role="status" className="mt-4">
        <p>Loading {label}...</p>
        <div
          aria-hidden="true"
          className="mt-3 h-32 rounded-lg bg-neutral-100"
        />
      </div>
    );
  return (
    <>
      {query.isFetching && (
        <p role="status" className="mt-3 text-sm">
          Updating {label}...
        </p>
      )}
      {children}
    </>
  );
}

function Overview({ data }) {
  return (
    <>
      <RangeLabel range={data.range} prefix="Overview range" />
      <dl className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ['Revenue', formatVnd(data.revenue)],
          ['Delivered orders', count(data.deliveredOrderCount)],
          ['Units sold', count(data.unitsSold)],
          ['Created orders', count(data.createdOrderCount)],
        ].map(([label, value]) => (
          <div
            key={label}
            className="min-w-0 rounded-lg border border-neutral-300 p-4"
          >
            <dt className="text-sm font-medium text-neutral-600">{label}</dt>
            <dd className="mt-2 break-words text-xl font-semibold tabular-nums [overflow-wrap:anywhere]">
              {value}
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-4 text-sm text-neutral-600">
        Sales count only currently DELIVERED orders by delivery date. Revenue
        uses immutable order totals, including shipping and reflected discounts;
        units use item quantities.
      </p>
      <h3 className="mt-5 font-semibold">Created-order status counts</h3>
      <p className="mt-1 text-sm text-neutral-600">
        Orders created in this range, grouped by their current status. Cancelled
        and non-delivered orders contribute here, not to sales.
      </p>
      <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {customerOrderStatusSchema.options.map((status) => (
          <div
            key={status}
            className="min-w-0 border-l-2 border-emerald-700 pl-3"
          >
            <dt className="break-words text-xs font-semibold">{status}</dt>
            <dd className="break-words tabular-nums [overflow-wrap:anywhere]">
              {count(data.statusCounts[status])}
            </dd>
          </div>
        ))}
      </dl>
    </>
  );
}

function ProductLists({ data, historical }) {
  if (!data.items.length)
    return (
      <p className="mt-4 rounded-lg bg-neutral-100 p-4">
        {historical
          ? 'No delivered product sales in this range.'
          : 'No low-stock products at this threshold.'}
      </p>
    );
  return (
    <>
      <p className="mt-3 text-sm text-neutral-600">
        Showing {data.items.length} of {count(data.totalProducts)} products ·
        Limit {data.limit}
      </p>
      <ol
        aria-label={historical ? 'Top products ranking' : 'Low-stock products'}
        className="mt-4 divide-y divide-neutral-200"
      >
        {data.items.map((item, index) => (
          <li
            key={item.productId}
            className="grid min-w-0 gap-3 py-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
          >
            <div className="flex min-w-0 gap-3">
              {historical && (
                <span className="font-semibold text-emerald-800">
                  #{index + 1}
                </span>
              )}
              {historical &&
                item.imageUrl /* Authoritative historical image; no current catalog lookup. */ && (
                  // eslint-disable-next-line @next/next/no-img-element -- Immutable external snapshot URL.
                  <img
                    src={item.imageUrl}
                    alt=""
                    width="48"
                    height="48"
                    className="h-12 w-12 shrink-0 rounded object-cover"
                  />
                )}
              <div className="min-w-0">
                <p className="break-words font-semibold [overflow-wrap:anywhere]">
                  {historical ? item.productName : item.name}
                </p>
                <p className="break-all text-sm text-neutral-600">
                  SKU: {item.sku}
                </p>
                {historical && (
                  <p className="break-words text-sm text-neutral-600 [overflow-wrap:anywhere]">
                    {item.sellingUnit}
                  </p>
                )}
              </div>
            </div>
            <dl className="grid min-w-0 gap-1 text-sm tabular-nums">
              <div>
                <dt className="inline text-neutral-600">
                  {historical ? 'Units sold: ' : 'Quantity: '}
                </dt>
                <dd className="inline break-words [overflow-wrap:anywhere]">
                  {historical ? count(item.soldQuantity) : item.quantity}
                </dd>
              </div>
              <div>
                <dt className="inline text-neutral-600">
                  {historical ? 'Item revenue: ' : 'Current price: '}
                </dt>
                <dd className="inline break-words font-semibold [overflow-wrap:anywhere]">
                  {formatVnd(historical ? item.revenue : item.currentPrice)}
                </dd>
              </div>
              {!historical && (
                <div>
                  <dt className="sr-only">Availability</dt>
                  <dd
                    className={
                      item.quantity === 0
                        ? 'font-semibold text-red-800'
                        : 'font-semibold text-emerald-800'
                    }
                  >
                    {item.quantity === 0
                      ? 'OUT_OF_STOCK · Zero stock'
                      : item.availability.status}
                  </dd>
                </div>
              )}
            </dl>
          </li>
        ))}
      </ol>
    </>
  );
}

export function StatisticsDashboard() {
  const auth = useAuth();
  const router = useRouter();
  const search = useSearchParams().toString();
  const applied = parseDashboardRange(new URLSearchParams(search));
  const canonical = dashboardHref(applied);
  const [recovered, setRecovered] = useState(false);
  const clock = useQuery({
    queryKey: ['admin-statistics', auth.user.id, 'default-overview'],
    queryFn: ({ signal }) =>
      auth.request('/admin/statistics/overview', {
        signal,
        schema: statisticsOverviewResponseSchema,
      }),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: false,
  });
  // A failed overview must not prevent top products from supplying its own
  // authoritative default range. No browser-clock fallback is permitted.
  const fallbackTop = useQuery({
    queryKey: ['admin-statistics', auth.user.id, 'default-top-products'],
    queryFn: ({ signal }) =>
      auth.request('/admin/statistics/top-products?limit=10', {
        signal,
        schema: statisticsTopProductsResponseSchema,
      }),
    enabled: !clock.data && clock.isError && applied.range !== 'custom',
    staleTime: 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const anchor = clock.data?.data.range ?? fallbackTop.data?.data.range;
  const selected = resolveDashboardRange(applied, anchor);
  const dates = selected ? new URLSearchParams(selected).toString() : '';
  const future = applied.range === 'custom' && anchor && applied.to > anchor.to;
  const datedOverview = useQuery({
    queryKey: ['admin-statistics', auth.user.id, 'overview', dates],
    queryFn: ({ signal }) =>
      checkedRange(
        auth.request('/admin/statistics/overview?' + dates, {
          signal,
          schema: statisticsOverviewResponseSchema,
        }),
        selected,
      ),
    enabled:
      Boolean(selected) &&
      applied.range !== '30d' &&
      !applied.invalid &&
      !future,
    placeholderData: (previous) => previous ?? clock.data,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const overview = applied.range === '30d' ? clock : datedOverview;
  const useFallbackTop =
    applied.range === '30d' &&
    sameStatisticsRange(fallbackTop.data?.data.range, selected);
  const datedTop = useQuery({
    queryKey: ['admin-statistics', auth.user.id, 'top-products', dates],
    queryFn: ({ signal }) =>
      checkedRange(
        auth.request('/admin/statistics/top-products?' + dates + '&limit=10', {
          signal,
          schema: statisticsTopProductsResponseSchema,
        }),
        selected,
      ),
    enabled:
      Boolean(selected) && !applied.invalid && !future && !useFallbackTop,
    placeholderData: keepPreviousData,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const top =
    useFallbackTop || (!clock.data && clock.isError && applied.range === '30d')
      ? fallbackTop
      : datedTop;
  const low = useQuery({
    queryKey: ['admin-statistics', auth.user.id, 'low-stock'],
    queryFn: ({ signal }) =>
      auth.request('/admin/statistics/low-stock?threshold=5&limit=10', {
        signal,
        schema: statisticsLowStockResponseSchema,
      }),
    staleTime: 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const rejectedRange =
    applied.range !== '30d' &&
    (overview.error?.status === 422 || top.error?.status === 422);
  if (!recovered && (applied.invalid || future || rejectedRange))
    setRecovered(true);
  useEffect(() => {
    if (applied.invalid || future || rejectedRange) {
      router.replace('/admin', { scroll: false });
    } else if (canonical !== '/admin' + (search ? '?' + search : '')) {
      router.replace(canonical, { scroll: false });
    }
  }, [applied.invalid, future, rejectedRange, canonical, search, router]);

  // Prior data can stay visible only as a matching pair, explicitly pending.
  const previousPair =
    overview.isPlaceholderData &&
    top.isPlaceholderData &&
    sameStatisticsRange(overview.data?.data.range, top.data?.data.range);
  const overviewVisible =
    sameStatisticsRange(overview.data?.data.range, selected) || previousPair;
  const topVisible =
    sameStatisticsRange(top.data?.data.range, selected) || previousPair;
  const anchorFailed = !selected && clock.isError;
  const topState = anchorFailed ? fallbackTop : top;
  const overviewState = anchorFailed ? clock : overview;
  return (
    <div className="min-w-0">
      <p className="text-sm font-semibold uppercase tracking-wide text-emerald-800">
        Store operations
      </p>
      <h1 className="mt-2 text-3xl font-semibold">Statistics dashboard</h1>
      <p className="mt-3 text-neutral-700">
        Delivered sales, created orders and current stock. Figures come directly
        from MartHub statistics.
      </p>
      {recovered && (
        <p
          role="status"
          className="mt-4 rounded-lg border border-amber-400 bg-amber-50 p-4 text-amber-950"
        >
          The invalid range was reset to Last 30 days.
        </p>
      )}
      <RangeControls
        key={canonical}
        applied={applied}
        selected={selected}
        today={anchor?.to}
        apply={(next) => router.push(dashboardHref(next), { scroll: false })}
        reset={() => router.push('/admin', { scroll: false })}
      />
      <RangeLabel range={selected} />
      <section
        aria-labelledby="statistics-overview"
        className="mt-6 min-w-0 rounded-lg border border-neutral-300 bg-white p-4 sm:p-5"
      >
        <h2 id="statistics-overview" className="text-xl font-semibold">
          Order overview
        </h2>
        <SectionState
          query={overviewState}
          label="overview"
          visible={overviewVisible}
        >
          {overview.data && <Overview data={overview.data.data} />}
        </SectionState>
      </section>
      <section
        aria-labelledby="statistics-top"
        className="mt-6 min-w-0 rounded-lg border border-neutral-300 bg-white p-4 sm:p-5"
      >
        <h2 id="statistics-top" className="text-xl font-semibold">
          Top products
        </h2>
        <p className="mt-2 text-sm text-neutral-600">
          Historical delivered sales ranked by units sold, then item revenue.
          Immutable product snapshots; item revenue excludes order shipping.
        </p>
        <SectionState
          query={topState}
          label="top products"
          visible={topVisible}
        >
          {top.data && (
            <>
              <RangeLabel
                range={top.data.data.range}
                prefix="Top-products range"
              />
              <ProductLists data={top.data.data} historical />
            </>
          )}
        </SectionState>
      </section>
      <section
        aria-labelledby="statistics-low"
        className="mt-6 min-w-0 rounded-lg border border-neutral-300 bg-white p-4 sm:p-5"
      >
        <h2 id="statistics-low" className="text-xl font-semibold">
          Low stock
        </h2>
        <p className="mt-2 text-sm text-neutral-600">
          Current operational stock, independent of the selected range.
          Threshold: {low.data?.data.threshold ?? 5} or fewer units, including
          zero.
        </p>
        <SectionState query={low} label="low stock">
          {low.data && <ProductLists data={low.data.data} />}
        </SectionState>
      </section>
    </div>
  );
}
