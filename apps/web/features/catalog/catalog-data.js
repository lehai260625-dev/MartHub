import 'server-only';
import { cache } from 'react';
import {
  categoryListResponseSchema,
  categoryResponseSchema,
  productListResponseSchema,
  productResponseSchema,
} from '@marthub/contracts';
import { serverApi } from '../../lib/api/server';
import { parseCatalogQuery, toQueryString } from './catalog-query';

export const getCategories = cache(async () =>
  serverApi('/categories', { schema: categoryListResponseSchema }),
);

export const getCategory = cache(async (slug) =>
  serverApi(`/categories/${encodeURIComponent(slug)}`, {
    schema: categoryResponseSchema,
  }),
);

export async function getProductListing(searchParams, forcedCategory) {
  const parsed = parseCatalogQuery(searchParams, forcedCategory);
  if (!parsed.success) return parsed;
  const query = toQueryString(parsed.apiQuery);
  const result = await serverApi(`/products?${query}`, {
    schema: productListResponseSchema,
  });
  return {
    success: true,
    result,
    state: { query: parsed.query, values: parsed.state },
  };
}

export const getProduct = cache(async (slug) =>
  serverApi(`/products/${encodeURIComponent(slug)}`, {
    schema: productResponseSchema,
  }),
);

export async function getAllPublicProducts() {
  const products = [];
  let page = 1;
  let totalPages = 1;
  do {
    const listing = await getProductListing({
      page: String(page),
      perPage: '60',
      sort: 'newest',
    });
    products.push(...listing.result.data);
    totalPages = listing.result.meta.totalPages;
    page += 1;
  } while (page <= totalPages);
  return products;
}
