import { productQuerySchema } from '@marthub/contracts';

const QUERY_KEYS = new Set([
  'q',
  'category',
  'minPrice',
  'maxPrice',
  'availability',
  'featured',
  'new',
  'popular',
  'sort',
  'page',
  'perPage',
]);

function serializeValue(key, value) {
  if (key === 'page' || key === 'perPage') return String(value);
  if (typeof value === 'boolean') return String(value);
  return value;
}

export function parseCatalogQuery(searchParams = {}, forcedCategory) {
  const input = {};
  for (const [key, value] of Object.entries(searchParams)) {
    if (!QUERY_KEYS.has(key) || Array.isArray(value)) {
      return {
        success: false,
        message: 'This catalog URL contains an unsupported filter.',
      };
    }
    if (value !== undefined && value !== '') input[key] = value;
  }
  if (forcedCategory && input.category) {
    return {
      success: false,
      message: 'The category is already defined by this page.',
    };
  }
  if (forcedCategory) input.category = forcedCategory;

  const parsed = productQuerySchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      message: 'One or more catalog filters are invalid.',
    };
  }

  const state = {};
  for (const key of Object.keys(input)) {
    if (forcedCategory && key === 'category') continue;
    state[key] = serializeValue(key, parsed.data[key]);
  }
  const apiQuery = {
    ...state,
    ...(forcedCategory ? { category: forcedCategory } : {}),
    sort: parsed.data.sort,
    page: String(parsed.data.page),
    perPage: String(parsed.data.perPage),
  };
  return { success: true, query: parsed.data, state, apiQuery };
}

export function toQueryString(values) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== null && value !== '') {
      params.set(key, String(value));
    }
  }
  return params.toString();
}

export function catalogHref(path, state, changes = {}) {
  const next = { ...state, ...changes };
  for (const [key, value] of Object.entries(next)) {
    if (value === undefined || value === null || value === '') delete next[key];
  }
  const query = toQueryString(next);
  return query ? `${path}?${query}` : path;
}

const vndFormatter = new Intl.NumberFormat('vi-VN', {
  style: 'currency',
  currency: 'VND',
  maximumFractionDigits: 0,
});

export function formatVnd(value) {
  return vndFormatter.format(BigInt(value));
}
