import {
  STATISTICS_TIMEZONE,
  statisticsOverviewQuerySchema,
} from '@marthub/contracts';

export function validCustomRange(from, to, today) {
  return (
    Boolean(from && to) &&
    statisticsOverviewQuerySchema.safeParse({ from, to }).success &&
    (!today || to <= today)
  );
}

export function dashboardHref({ range = '30d', from, to }) {
  if (range === '30d') return '/admin';
  const params = new URLSearchParams({ range });
  if (range === 'custom') {
    params.set('from', from);
    params.set('to', to);
  }
  return '/admin?' + params.toString();
}

export function parseDashboardRange(search) {
  const range = search.get('range') ?? '30d';
  const from = search.get('from');
  const to = search.get('to');
  const invalid =
    ['range', 'from', 'to'].some((key) => search.getAll(key).length > 1) ||
    !['7d', '30d', '90d', 'custom'].includes(range) ||
    (range === 'custom'
      ? !validCustomRange(from, to)
      : Boolean(from !== null || to !== null));
  return invalid
    ? { range: '30d', invalid: true }
    : { range, ...(range === 'custom' ? { from, to } : {}), invalid: false };
}

export function resolveDashboardRange(applied, authoritativeRange) {
  if (applied.range === 'custom')
    return {
      from: applied.from,
      to: applied.to,
      timezone: STATISTICS_TIMEZONE,
    };
  if (!authoritativeRange) return null;
  const days = { '7d': 7, '30d': 30, '90d': 90 }[applied.range];
  // Calendar arithmetic only. No browser clock or local timezone is consulted.
  const end = Date.parse(authoritativeRange.to + 'T00:00:00.000Z');
  const from = new Date(end - (days - 1) * 86400000).toISOString().slice(0, 10);
  return { from, to: authoritativeRange.to, timezone: STATISTICS_TIMEZONE };
}

export function sameStatisticsRange(first, second) {
  return Boolean(
    first &&
    second &&
    first.from === second.from &&
    first.to === second.to &&
    first.timezone === second.timezone,
  );
}
