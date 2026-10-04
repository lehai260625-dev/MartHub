'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  customerOrderQuerySchema,
  customerOrderListResponseSchema,
  customerOrderStatusSchema,
} from '@marthub/contracts';
import { useAuth } from '../auth/auth-provider';
import { formatVnd } from '../catalog/catalog-query';

export function CustomerOrderHistory() {
  const auth = useAuth();
  const search = useSearchParams();
  const router = useRouter();
  const input = Object.fromEntries(
    [...search.keys()].map((key) => [
      key,
      search.getAll(key).length > 1 ? search.getAll(key) : search.get(key),
    ]),
  );
  const parsed = customerOrderQuerySchema.safeParse(input);
  const params = new URLSearchParams();
  if (parsed.success)
    for (const [key, value] of Object.entries(parsed.data))
      params.set(key, String(value));
  const query = useQuery({
    queryKey: ['owned-orders', auth.user.id, params.toString()],
    queryFn: ({ signal }) =>
      auth.request(`/orders?${params}`, {
        signal,
        schema: customerOrderListResponseSchema,
      }),
    enabled: parsed.success,
    retry: false,
  });
  const href = (updates) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(updates))
      value ? next.set(key, String(value)) : next.delete(key);
    return `/account/orders?${next}`;
  };
  return (
    <div className="space-y-6 break-words">
      <h1 className="text-3xl font-semibold">Order history</h1>
      {!parsed.success ? (
        <div role="alert">
          <p>Invalid order filters.</p>
          <Link href="/account/orders" className="button-secondary">
            Reset filters
          </Link>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-4">
            <label className="grid gap-2">
              Order status
              <select
                className="rounded border p-2"
                value={parsed.data.status ?? ''}
                onChange={(event) =>
                  router.push(href({ status: event.target.value, page: 1 }))
                }
              >
                <option value="">All statuses</option>
                {customerOrderStatusSchema.options.map((status) => (
                  <option key={status}>{status}</option>
                ))}
              </select>
            </label>
            <label className="grid gap-2">
              Order sort
              <select
                className="rounded border p-2"
                value={parsed.data.sort}
                onChange={(event) =>
                  router.push(href({ sort: event.target.value, page: 1 }))
                }
              >
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
              </select>
            </label>
            <label className="grid gap-2">
              Orders per page
              <select
                className="rounded border p-2"
                value={parsed.data.perPage}
                onChange={(event) =>
                  router.push(href({ perPage: event.target.value, page: 1 }))
                }
              >
                {[...new Set([20, 50, parsed.data.perPage])]
                  .sort((a, b) => a - b)
                  .map((count) => (
                    <option key={count}>{count}</option>
                  ))}
              </select>
            </label>
          </div>
          {query.isPending ? (
            <p role="status">Loading your orders…</p>
          ) : query.isError ? (
            <div role="alert">
              <p>We could not load your orders.</p>
              <button
                className="button-secondary"
                onClick={() => query.refetch()}
              >
                Try again
              </button>
            </div>
          ) : (
            <>
              {!query.data.data.length ? (
                <p>No orders match these filters.</p>
              ) : (
                <ul aria-label="Your orders" className="space-y-4">
                  {query.data.data.map((order) => (
                    <li
                      key={order.id}
                      className="rounded-2xl border border-neutral-200 bg-white p-5"
                    >
                      <Link
                        className="break-all font-semibold text-emerald-800 underline"
                        href={`/account/orders/${encodeURIComponent(order.orderNumber)}`}
                      >
                        {order.orderNumber}
                      </Link>
                      <p>Status: {order.status}</p>
                      <p>
                        Placed:{' '}
                        <time dateTime={order.createdAt}>
                          {order.createdAt.slice(0, 10)}
                        </time>
                      </p>
                      <p>
                        {order.itemCount} items · {order.paymentMethod}
                      </p>
                      <p>Total: {formatVnd(order.total)}</p>
                    </li>
                  ))}
                </ul>
              )}
              <nav
                aria-label="Order pages"
                className="flex flex-wrap items-center gap-4"
              >
                {query.data.meta.page > 1 && (
                  <Link
                    className="button-secondary"
                    href={href({ page: query.data.meta.page - 1 })}
                  >
                    Previous page
                  </Link>
                )}
                <p>
                  Page {query.data.meta.page} of{' '}
                  {Math.max(1, query.data.meta.totalPages)}
                </p>
                {query.data.meta.page < query.data.meta.totalPages && (
                  <Link
                    className="button-secondary"
                    href={href({ page: query.data.meta.page + 1 })}
                  >
                    Next page
                  </Link>
                )}
              </nav>
            </>
          )}
        </>
      )}
    </div>
  );
}
