'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  adminOrderListResponseSchema,
  adminOrderQuerySchema,
  customerOrderStatusSchema,
} from '@marthub/contracts';
import { useAuth } from '../auth/auth-provider';
import { formatVnd } from '../catalog/catalog-query';

function queryInput(search) {
  return Object.fromEntries(
    [...search.keys()].map((key) => [
      key,
      search.getAll(key).length > 1 ? search.getAll(key) : search.get(key),
    ]),
  );
}

export function adminOrderQueueParams(query) {
  const params = new URLSearchParams();
  if (query.q) params.set('q', query.q);
  if (query.status) params.set('status', query.status);
  if (query.sort !== 'newest') params.set('sort', query.sort);
  if (query.page !== 1) params.set('page', String(query.page));
  if (query.perPage !== 20) params.set('perPage', String(query.perPage));
  return params;
}

export function AdminOrderQueue() {
  const auth = useAuth();
  const router = useRouter();
  const search = useSearchParams();
  const parsed = adminOrderQuerySchema.safeParse(queryInput(search));
  const canonical = parsed.success
    ? adminOrderQueueParams(parsed.data)
    : new URLSearchParams();
  const queryString = canonical.toString();
  const query = useQuery({
    queryKey: ['admin-orders', auth.user.id, queryString],
    queryFn: ({ signal }) =>
      auth.request('/admin/orders' + (queryString ? '?' + queryString : ''), {
        signal,
        schema: adminOrderListResponseSchema,
      }),
    enabled: parsed.success,
    retry: false,
  });

  const href = (updates) => {
    const next = { ...parsed.data, ...updates };
    if (typeof next.q === 'string')
      next.q = next.q.trim().replace(/\s+/gu, ' ') || undefined;
    return (
      '/admin/orders' +
      (adminOrderQueueParams(next).toString()
        ? '?' + adminOrderQueueParams(next).toString()
        : '')
    );
  };
  const update = (updates) => router.push(href({ ...updates, page: 1 }));

  if (!parsed.success)
    return (
      <div
        role="alert"
        className="mt-6 rounded-lg border border-red-300 bg-white p-5"
      >
        <p>These order queue filters are invalid.</p>
        <Link
          className="button-secondary mt-4 inline-flex items-center"
          href="/admin/orders"
        >
          Reset filters
        </Link>
      </div>
    );

  return (
    <section aria-labelledby="order-queue-title" className="mt-8 min-w-0">
      <h2 id="order-queue-title" className="text-xl font-semibold">
        Order queue
      </h2>
      <form
        role="search"
        className="mt-4 flex max-w-2xl flex-col gap-3 sm:flex-row"
        onSubmit={(event) => {
          event.preventDefault();
          update({ q: new FormData(event.currentTarget).get('q') });
        }}
      >
        <label className="min-w-0 flex-1">
          <span className="font-medium">Search orders</span>
          <input
            key={parsed.data.q ?? ''}
            name="q"
            className="form-input mt-2"
            defaultValue={parsed.data.q ?? ''}
            maxLength={100}
            placeholder="Order number, customer email, or recipient"
          />
        </label>
        <button className="button-primary self-end">Search</button>
      </form>
      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <label className="grid gap-2 font-medium">
          Status
          <select
            className="form-input"
            value={parsed.data.status ?? ''}
            onChange={(event) =>
              update({ status: event.target.value || undefined })
            }
          >
            <option value="">All statuses</option>
            {customerOrderStatusSchema.options.map((status) => (
              <option key={status}>{status}</option>
            ))}
          </select>
        </label>
        <label className="grid gap-2 font-medium">
          Sort
          <select
            className="form-input"
            value={parsed.data.sort}
            onChange={(event) => update({ sort: event.target.value })}
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
          </select>
        </label>
        <label className="grid gap-2 font-medium">
          Orders per page
          <select
            className="form-input"
            value={parsed.data.perPage}
            onChange={(event) =>
              update({ perPage: Number(event.target.value) })
            }
          >
            {[...new Set([20, 50, parsed.data.perPage])]
              .sort((a, b) => a - b)
              .map((value) => (
                <option key={value}>{value}</option>
              ))}
          </select>
        </label>
      </div>

      {query.isPending ? (
        <p role="status" className="mt-6">
          Loading orders…
        </p>
      ) : query.isError ? (
        <div
          role="alert"
          className="mt-6 rounded-lg border border-red-300 bg-white p-5"
        >
          <p>We could not load the order queue.</p>
          <button
            className="button-secondary mt-4"
            onClick={() => query.refetch()}
          >
            Try again
          </button>
        </div>
      ) : !query.data.data.length ? (
        <p className="mt-6 rounded-lg border border-neutral-300 bg-white p-5">
          No orders match these filters.
        </p>
      ) : (
        <>
          <div className="mt-6 hidden overflow-x-auto rounded-lg border border-neutral-300 bg-white md:block">
            <table className="w-full min-w-[52rem] text-left text-sm">
              <caption className="sr-only">Admin order queue</caption>
              <thead className="bg-neutral-100">
                <tr>
                  {[
                    'Order',
                    'Customer',
                    'Created',
                    'Items',
                    'Status',
                    'Total',
                  ].map((heading) => (
                    <th
                      key={heading}
                      scope="col"
                      className="border-b border-neutral-300 px-4 py-3 font-semibold"
                    >
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {query.data.data.map((order) => (
                  <tr key={order.id}>
                    <th
                      scope="row"
                      className="border-b border-neutral-200 px-4 py-4"
                    >
                      <Link
                        className="break-all font-semibold text-emerald-800 underline"
                        href={`/admin/orders/${order.id}`}
                      >
                        {order.orderNumber}
                      </Link>
                    </th>
                    <td className="border-b border-neutral-200 px-4 py-4 break-all">
                      {order.customer.email}
                    </td>
                    <td className="border-b border-neutral-200 px-4 py-4">
                      <time dateTime={order.createdAt}>
                        {order.createdAt.slice(0, 10)}
                      </time>
                    </td>
                    <td className="border-b border-neutral-200 px-4 py-4 tabular-nums">
                      {order.itemCount}
                    </td>
                    <td className="border-b border-neutral-200 px-4 py-4 font-semibold">
                      {order.status}
                    </td>
                    <td className="border-b border-neutral-200 px-4 py-4 tabular-nums">
                      {formatVnd(order.total)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul
            aria-label="Admin order queue"
            className="mt-6 space-y-4 md:hidden"
          >
            {query.data.data.map((order) => (
              <li
                key={order.id}
                className="min-w-0 rounded-lg border border-neutral-300 bg-white p-4"
              >
                <Link
                  className="break-all font-semibold text-emerald-800 underline"
                  href={`/admin/orders/${order.id}`}
                >
                  {order.orderNumber}
                </Link>
                <p className="mt-2 break-all">{order.customer.email}</p>
                <p>
                  {order.status} · {order.itemCount} items
                </p>
                <p className="font-semibold tabular-nums">
                  {formatVnd(order.total)}
                </p>
              </li>
            ))}
          </ul>
        </>
      )}

      {query.data && (
        <nav
          aria-label="Order pages"
          className="mt-6 flex flex-wrap items-center gap-4"
        >
          {query.data.meta.page > 1 ? (
            <Link
              className="button-secondary inline-flex items-center"
              href={href({ page: query.data.meta.page - 1 })}
            >
              Previous page
            </Link>
          ) : (
            <span aria-disabled="true" className="text-neutral-500">
              Previous page
            </span>
          )}
          <span>
            Page {query.data.meta.page} of{' '}
            {Math.max(1, query.data.meta.totalPages)}
          </span>
          {query.data.meta.page < query.data.meta.totalPages ? (
            <Link
              className="button-secondary inline-flex items-center"
              href={href({ page: query.data.meta.page + 1 })}
            >
              Next page
            </Link>
          ) : (
            <span aria-disabled="true" className="text-neutral-500">
              Next page
            </span>
          )}
        </nav>
      )}
    </section>
  );
}
