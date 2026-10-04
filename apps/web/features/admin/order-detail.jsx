'use client';

import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { adminOrderDetailResponseSchema } from '@marthub/contracts';
import { useAuth } from '../auth/auth-provider';
import { formatVnd } from '../catalog/catalog-query';

function MoneyRow({ label, value }) {
  return (
    <div className="flex justify-between gap-4 border-t border-neutral-200 py-3">
      <dt>{label}</dt>
      <dd className="font-semibold tabular-nums">{formatVnd(value)}</dd>
    </div>
  );
}

export function AdminOrderDetail({ orderId }) {
  const auth = useAuth();
  const router = useRouter();
  const query = useQuery({
    queryKey: ['admin-order', auth.user.id, orderId],
    queryFn: ({ signal }) =>
      auth.request(`/admin/orders/${encodeURIComponent(orderId)}`, {
        signal,
        schema: adminOrderDetailResponseSchema,
      }),
    retry: false,
  });

  return (
    <div className="min-w-0 space-y-6 break-words">
      <button className="button-secondary" onClick={() => router.back()}>
        Back to order queue
      </button>
      {query.isPending ? (
        <p role="status">Loading order detail…</p>
      ) : query.isError ? (
        <div
          role="alert"
          className="rounded-lg border border-red-300 bg-white p-5"
        >
          <p>
            {query.error.status === 404
              ? 'Order not found.'
              : 'We could not load this order.'}
          </p>
          {query.error.status !== 404 && (
            <button
              className="button-secondary mt-4"
              onClick={() => query.refetch()}
            >
              Try again
            </button>
          )}
        </div>
      ) : (
        <OrderDetailContent order={query.data.data} />
      )}
    </div>
  );
}

function OrderDetailContent({ order }) {
  return (
    <>
      <header>
        <p className="text-sm font-semibold uppercase tracking-wide text-emerald-800">
          Order operations
        </p>
        <h1 className="mt-2 text-3xl font-semibold">Order detail</h1>
        <p className="mt-2 break-all">{order.orderNumber}</p>
        <p className="mt-2 font-semibold">{order.status}</p>
      </header>
      <div className="grid gap-6 xl:grid-cols-2">
        <section
          aria-labelledby="customer-title"
          className="rounded-lg border border-neutral-300 bg-white p-5"
        >
          <h2 id="customer-title" className="text-xl font-semibold">
            Customer
          </h2>
          <p className="mt-3">
            {order.customer.firstName} {order.customer.lastName}
          </p>
          <p className="break-all">{order.customer.email}</p>
          {order.customer.phone && <p>{order.customer.phone}</p>}
          <p>Account status: {order.customer.status}</p>
          <p className="mt-2 break-all text-sm text-neutral-600">
            User ID: {order.customer.userId}
          </p>
        </section>
        <section
          aria-labelledby="delivery-title"
          className="rounded-lg border border-neutral-300 bg-white p-5"
        >
          <h2 id="delivery-title" className="text-xl font-semibold">
            Delivery snapshot
          </h2>
          <p className="mt-3">{order.address.recipientName}</p>
          <p>{order.address.phone}</p>
          <p>
            {[
              order.address.line1,
              order.address.line2,
              order.address.ward,
              order.address.district,
              order.address.province,
              order.address.postalCode,
            ]
              .filter(Boolean)
              .join(', ')}
          </p>
          {order.customerNote && (
            <p className="mt-3">Customer note: {order.customerNote}</p>
          )}
        </section>
      </div>
      <section
        aria-labelledby="items-title"
        className="rounded-lg border border-neutral-300 bg-white p-5"
      >
        <h2 id="items-title" className="text-xl font-semibold">
          Immutable item snapshots
        </h2>
        <ul className="mt-4 space-y-4">
          {order.items.map((item) => (
            <li
              key={item.id}
              className="border-t border-neutral-200 pt-4 first:border-0 first:pt-0"
            >
              <p className="font-semibold">{item.productName}</p>
              <p>
                {item.sku} · {item.sellingUnit}
              </p>
              <p>
                {item.quantity} × {formatVnd(item.unitPrice)}
              </p>
              {item.compareAtPrice && (
                <p>
                  Compare price at purchase: {formatVnd(item.compareAtPrice)}
                </p>
              )}
              <p className="font-semibold">
                Line total: {formatVnd(item.lineTotal)}
              </p>
            </li>
          ))}
        </ul>
      </section>
      <section
        aria-labelledby="totals-title"
        className="rounded-lg border border-neutral-300 bg-white p-5"
      >
        <h2 id="totals-title" className="text-xl font-semibold">
          Order totals
        </h2>
        <dl className="mt-3">
          <MoneyRow label="Subtotal" value={order.subtotal} />
          <MoneyRow label="Shipping" value={order.shippingFee} />
          <MoneyRow label="Discount" value={order.discountTotal} />
          <MoneyRow label="Total" value={order.total} />
        </dl>
        <p>
          {order.paymentMethod} · {order.currency}
        </p>
        <p>
          Created: <time dateTime={order.createdAt}>{order.createdAt}</time>
        </p>
        <p>
          Placed: <time dateTime={order.placedAt}>{order.placedAt}</time>
        </p>
      </section>
      <section aria-labelledby="history-title">
        <h2 id="history-title" className="text-xl font-semibold">
          Complete status history
        </h2>
        {order.statusHistory.length ? (
          <ol className="mt-4 space-y-3">
            {order.statusHistory.map((entry) => (
              <li
                key={entry.id}
                className="rounded-lg border border-neutral-300 bg-white p-4"
              >
                <p className="font-semibold">{entry.status}</p>
                <time dateTime={entry.createdAt}>{entry.createdAt}</time>
                {entry.reason && <p>Reason: {entry.reason}</p>}
                <p className="mt-2 break-all text-sm text-neutral-600">
                  Actor user ID: {entry.actorUserId ?? 'System'}
                </p>
              </li>
            ))}
          </ol>
        ) : (
          <p className="mt-3">No status history is available.</p>
        )}
      </section>
    </>
  );
}
