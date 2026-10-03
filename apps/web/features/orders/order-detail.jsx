'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  customerOrderDetailResponseSchema,
  reorderResponseSchema,
} from '@marthub/contracts';
import { useAuth } from '../auth/auth-provider';
import { useShopping } from '../shopping/shopping-provider';
import { OrderSummary } from '../checkout/checkout-manager';
import { formatVnd } from '../catalog/catalog-query';

export function PurchaseProvenance({ orderId }) {
  const auth = useAuth();
  const query = useQuery({
    queryKey: ['owned-order', auth.user.id, orderId],
    queryFn: ({ signal }) =>
      auth.request(`/orders/${encodeURIComponent(orderId)}`, {
        signal,
        schema: customerOrderDetailResponseSchema,
      }),
    retry: false,
  });
  if (query.isPending) return <p role="status">Loading purchase link…</p>;
  if (query.isError)
    return (
      <div>
        <p>Purchase link could not be loaded.</p>
        <button className="button-secondary" onClick={() => query.refetch()}>
          Retry purchase link
        </button>
      </div>
    );
  return (
    <Link
      className="font-semibold text-emerald-800 underline"
      href={`/account/orders/${encodeURIComponent(query.data.data.orderNumber)}`}
    >
      View purchase order
    </Link>
  );
}

export function CustomerOrderDetail({ orderNumber }) {
  const auth = useAuth();
  const shopping = useShopping();
  const submitting = useRef(false);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const query = useQuery({
    queryKey: ['owned-order-number', auth.user.id, orderNumber],
    queryFn: ({ signal }) =>
      auth.request(`/orders/by-number/${encodeURIComponent(orderNumber)}`, {
        signal,
        schema: customerOrderDetailResponseSchema,
      }),
    retry: false,
  });
  const reorder = async () => {
    if (submitting.current) return;
    submitting.current = true;
    setPending(true);
    setError('');
    setResult(null);
    try {
      const response = await auth.request(
        `/orders/${query.data.data.id}/reorder`,
        { method: 'POST', body: {}, schema: reorderResponseSchema },
      );
      setResult(response.data);
      await shopping.retryCart();
    } catch {
      setError('Could not reorder. Check your cart before trying again.');
    } finally {
      submitting.current = false;
      setPending(false);
    }
  };
  return (
    <div className="space-y-6 break-words">
      <header>
        <h1 className="text-3xl font-semibold">Order detail</h1>
        <p className="mt-2 break-all">{orderNumber}</p>
      </header>
      <Link
        className="font-semibold text-emerald-800 underline"
        href="/account/my-items?tab=reorder"
      >
        Back to My Items
      </Link>
      {query.isPending ? (
        <p role="status">Loading your order…</p>
      ) : query.isError ? (
        <div role="alert">
          <p>
            {query.error.status === 404
              ? 'Order not found.'
              : 'We could not load your order.'}
          </p>
          {query.error.status !== 404 && (
            <button
              className="button-secondary mt-3"
              onClick={() => query.refetch()}
            >
              Try again
            </button>
          )}
        </div>
      ) : (
        <>
          <p>Status: {query.data.data.status}</p>
          <p>
            Placed:{' '}
            <time dateTime={query.data.data.placedAt}>
              {query.data.data.placedAt.slice(0, 10)}
            </time>
          </p>
          <OrderSummary summary={query.data.data} placed />
          <section aria-labelledby="snapshot-title">
            <h2 id="snapshot-title" className="text-xl font-semibold">
              Purchased item details
            </h2>
            <ul className="mt-3 space-y-3">
              {query.data.data.items.map((item) => (
                <li key={item.id ?? item.productId}>
                  <p>
                    {item.productName} — {item.sku} ({item.sellingUnit})
                  </p>
                  {item.compareAtPrice && (
                    <p>
                      Reference price at purchase:{' '}
                      {formatVnd(item.compareAtPrice)}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </section>
          <section
            aria-labelledby="delivery-title"
            className="rounded-2xl border border-neutral-200 bg-white p-5"
          >
            <h2 id="delivery-title" className="text-xl font-semibold">
              Delivery address
            </h2>
            <p>{query.data.data.address.recipientName}</p>
            <p>{query.data.data.address.phone}</p>
            <p>
              {[
                query.data.data.address.line1,
                query.data.data.address.line2,
                query.data.data.address.ward,
                query.data.data.address.district,
                query.data.data.address.province,
                query.data.data.address.postalCode,
              ]
                .filter(Boolean)
                .join(', ')}
            </p>
            {query.data.data.customerNote && (
              <p className="mt-3">
                Customer note: {query.data.data.customerNote}
              </p>
            )}
          </section>
          <section aria-labelledby="timeline-title">
            <h2 id="timeline-title" className="text-xl font-semibold">
              Status history
            </h2>
            {query.data.data.statusHistory.length ? (
              <ol className="mt-3 space-y-3">
                {query.data.data.statusHistory.map((entry, index) => (
                  <li
                    key={index}
                    className="rounded-xl border border-neutral-200 bg-white p-4"
                  >
                    <p className="font-semibold">{entry.toStatus}</p>
                    <time dateTime={entry.createdAt}>{entry.createdAt}</time>
                    {entry.reason && <p>{entry.reason}</p>}
                  </li>
                ))}
              </ol>
            ) : (
              <p>No status history available.</p>
            )}
          </section>
          <section aria-labelledby="whole-order-title">
            <h2 id="whole-order-title" className="text-xl font-semibold">
              Reorder this order
            </h2>
            <p className="mt-2">
              Uses current catalog prices and availability. Unavailable items
              are reported separately.
            </p>
            <button
              className="button-primary mt-3"
              disabled={pending || shopping.cartPending}
              onClick={reorder}
            >
              {pending ? 'Reordering…' : 'Reorder this order'}
            </button>
            {error && <p role="alert">{error}</p>}
            {shopping.cartError && (
              <div role="alert">
                <p>
                  Cart could not be refreshed. Your reorder result remains
                  recorded below.
                </p>
                <button
                  className="button-secondary"
                  onClick={() => shopping.retryCart()}
                >
                  Retry cart refresh
                </button>
              </div>
            )}
            {result && (
              <div role="status" className="mt-3">
                <h3 className="font-semibold">Added</h3>
                {result.added.length ? (
                  <ul>
                    {result.added.map((item) => (
                      <li key={item.productId}>
                        {
                          query.data.data.items.find(
                            (source) => source.productId === item.productId,
                          )?.productName
                        }
                        : {item.quantity} added
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>No items added.</p>
                )}
                <h3 className="mt-3 font-semibold">Skipped</h3>
                {result.skipped.length ? (
                  <ul>
                    {result.skipped.map((item) => (
                      <li key={item.productId}>
                        {
                          query.data.data.items.find(
                            (source) => source.productId === item.productId,
                          )?.productName
                        }
                        :{' '}
                        {item.reason === 'QUANTITY_LIMITED'
                          ? 'Cart quantity limit reached'
                          : item.reason === 'OUT_OF_STOCK'
                            ? 'Out of stock'
                            : 'Unavailable'}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>No items skipped.</p>
                )}
                <Link
                  className="font-semibold text-emerald-800 underline"
                  href="/cart"
                >
                  View cart
                </Link>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
