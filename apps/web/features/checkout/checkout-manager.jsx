'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  addressListResponseSchema,
  checkoutQuoteResponseSchema,
  checkoutOrderInputSchema,
  checkoutOrderResponseSchema,
} from '@marthub/contracts';
import { useAuth } from '../auth/auth-provider';
import { useShopping } from '../shopping/shopping-provider';
import { formatVnd } from '../catalog/catalog-query';

export function OrderSummary({ summary, placed = false }) {
  return (
    <section
      className="rounded-2xl border border-neutral-200 bg-white p-5"
      aria-labelledby="order-summary-title"
    >
      <h2 id="order-summary-title" className="text-xl font-semibold">
        {placed ? 'Order summary' : 'Server summary'}
      </h2>
      <ul className="mt-4 space-y-4">
        {summary.items.map((item) => (
          <li
            key={item.productId}
            className="break-words border-b border-neutral-100 pb-3"
          >
            <p className="font-semibold">{item.name ?? item.productName}</p>
            <p>
              {item.quantity} × {formatVnd(item.unitPrice)}
            </p>
            <p>Line total: {formatVnd(item.lineTotal)}</p>
          </li>
        ))}
      </ul>
      <dl className="mt-4 space-y-3">
        {[
          ['Subtotal', summary.subtotal],
          ['Shipping', summary.shippingFee],
          ['Discount', summary.discountTotal],
          ['Total', summary.total],
        ].map(([label, value]) => (
          <div key={label} className="flex flex-wrap justify-between gap-2">
            <dt>{label}</dt>
            <dd className="font-semibold">{formatVnd(value)}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-4">Payment: Cash on delivery (COD)</p>
    </section>
  );
}

function CheckoutError({ error, items = [] }) {
  return (
    <div role="alert" className="break-words text-red-700">
      <p>{error.message}</p>
      {Array.isArray(error.details) &&
        error.details.map((detail, index) => (
          <p key={index}>
            {items.find((item) => item.productId === detail.productId)?.name ??
              detail.field ??
              'Item'}
            {detail.available !== undefined
              ? `: requested ${detail.requested}, available ${detail.available}.`
              : detail.message
                ? `: ${detail.message}`
                : ': currently unavailable.'}
          </p>
        ))}
    </div>
  );
}

export function CheckoutManager() {
  const auth = useAuth();
  const shopping = useShopping();
  const client = useQueryClient();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const [completed, setCompleted] = useState(false);
  const busy = useRef(false);
  const attemptKey = ['checkout-attempt', auth.user.id];
  const [attempt, setAttempt] = useState(
    () => client.getQueryData(attemptKey) ?? null,
  );
  const [addressId, setAddressId] = useState(attempt?.intent.addressId ?? '');
  const [note, setNote] = useState(attempt?.intent.customerNote ?? '');
  const addresses = useQuery({
    queryKey: ['addresses', auth.user.id],
    queryFn: () =>
      auth.request('/users/me/addresses', {
        schema: addressListResponseSchema,
      }),
  });
  const quote = useQuery({
    queryKey: ['checkout-quote', auth.user.id, addressId, shopping.cart],
    queryFn: () =>
      auth.request('/checkout/quote', {
        method: 'POST',
        body: { addressId },
        schema: checkoutQuoteResponseSchema,
      }),
    enabled: Boolean(
      addressId && shopping.cart.items.length && !attempt && !completed,
    ),
    staleTime: 0,
  });
  const submit = async (event) => {
    event.preventDefault();
    if (busy.current || completed) return;
    let current = attempt;
    if (!current) {
      const parsed = checkoutOrderInputSchema.safeParse({
        cartId: quote.data?.data.cartId,
        addressId,
        customerNote: note,
      });
      if (!parsed.success || !quote.data || quote.isFetching || quote.isError) {
        setError({
          message:
            'Choose an address and review a current server summary. Notes must be at most 500 characters after trimming.',
        });
        return;
      }
      if (Date.now() >= Date.parse(quote.data.data.expiresAt)) {
        setError({
          message:
            'The summary expired. Refresh it and review before submitting.',
        });
        await quote.refetch();
        return;
      }
      current = { key: crypto.randomUUID(), intent: parsed.data };
      client.setQueryData(attemptKey, current);
      setAttempt(current);
    }
    busy.current = true;
    setPending(true);
    setError(null);
    try {
      const result = await auth.request('/checkout/orders', {
        method: 'POST',
        body: current.intent,
        idempotencyKey: current.key,
        schema: checkoutOrderResponseSchema,
      });
      client.setQueryData(
        ['checkout-success', auth.user.id, result.data.orderNumber],
        result.data,
      );
      client.removeQueries({ queryKey: attemptKey, exact: true });
      setCompleted(true);
      // Fetch the active cart; replay may coexist with a new cart, which must be preserved.
      await shopping.retryCart();
      router.replace(
        '/checkout/success/' + encodeURIComponent(result.data.orderNumber),
      );
    } catch (failure) {
      setError(failure);
      // Only a definitive rejected request allows another intent. Unknown outcomes keep the key.
      if (
        failure.status >= 400 &&
        failure.status < 500 &&
        failure.code !== 'INVALID_RESPONSE'
      ) {
        client.removeQueries({ queryKey: attemptKey, exact: true });
        setAttempt(null);
      }
    } finally {
      busy.current = false;
      setPending(false);
    }
  };
  if (completed)
    return (
      <p role="status" className="mt-6">
        Order placed. Opening confirmation…
      </p>
    );
  if (!attempt && (!shopping.cartReady || addresses.isPending))
    return (
      <p role="status" className="mt-6">
        Loading checkout…
      </p>
    );
  if (!attempt && (shopping.cartError || addresses.isError))
    return (
      <div role="alert" className="mt-6">
        <p>Checkout could not be loaded.</p>
        <button
          className="button-secondary mt-3"
          onClick={() => {
            shopping.retryCart();
            addresses.refetch();
          }}
        >
          Retry checkout
        </button>
      </div>
    );
  if (!attempt && !shopping.cart.items.length)
    return (
      <div className="mt-6">
        <p>Your cart is empty.</p>
        <Link href="/categories" className="button-primary mt-4">
          Browse categories
        </Link>
      </div>
    );
  const locked = pending || Boolean(attempt);
  return (
    <form
      onSubmit={submit}
      noValidate
      className="mt-8 grid min-w-0 gap-6 lg:grid-cols-2"
    >
      <div className="min-w-0 space-y-5">
        <fieldset
          disabled={locked}
          className="rounded-2xl border border-neutral-200 bg-white p-5"
        >
          <legend className="px-2 text-xl font-semibold">
            Delivery address
          </legend>
          {!addresses.data?.data.length ? (
            <p>
              No saved addresses.{' '}
              <Link className="underline" href="/account/addresses">
                Add an address
              </Link>{' '}
              before checkout.
            </p>
          ) : (
            addresses.data.data.map((address) => (
              <label
                key={address.id}
                className="flex min-h-11 cursor-pointer items-start gap-3 py-3"
              >
                <input
                  type="radio"
                  name="address"
                  value={address.id}
                  checked={addressId === address.id}
                  onChange={() => {
                    setAddressId(address.id);
                    setError(null);
                  }}
                  className="mt-1 size-5 shrink-0 accent-emerald-700"
                />
                <span className="min-w-0 break-words">
                  <span className="block font-semibold">{address.label}</span>
                  {address.recipientName}, {address.phone}
                  <span className="block">
                    {address.line1}
                    {address.line2 ? `, ${address.line2}` : ''}, {address.ward},{' '}
                    {address.district}, {address.province}
                  </span>
                </span>
              </label>
            ))
          )}
        </fieldset>
        <label className="block font-medium" htmlFor="checkout-note">
          Customer note (optional)
        </label>
        <textarea
          id="checkout-note"
          value={note}
          disabled={locked}
          onChange={(event) => setNote(event.target.value)}
          className="min-h-24 w-full rounded-xl border border-neutral-300 p-3"
          aria-describedby="checkout-note-hint"
        />
        <p id="checkout-note-hint" className="text-sm">
          Up to 500 characters after trimming.
        </p>
        <p>
          Cash on delivery is the only payment method. Prices and stock are
          checked by the server when you place the order; this summary does not
          reserve stock or lock prices.
        </p>
        {attempt && !pending && (
          <p role="status">
            The previous result is uncertain. Retry the same submission to
            recover its result without creating another order. Address and note
            remain locked.
          </p>
        )}
        {error && (
          <CheckoutError error={error} items={quote.data?.data.items} />
        )}
        <div className="flex flex-wrap gap-3">
          <button
            className="button-primary"
            disabled={
              pending ||
              shopping.cartPending ||
              (!attempt && (!quote.data || quote.isFetching || quote.isError))
            }
          >
            {pending
              ? 'Placing order…'
              : attempt
                ? 'Retry same submission'
                : 'Place COD order'}
          </button>
          {!attempt && (
            <Link className="button-secondary" href="/cart">
              Review cart
            </Link>
          )}
        </div>
      </div>
      <div className="min-w-0 space-y-4">
        {!addressId && !attempt && (
          <p>Select an address to request your server summary.</p>
        )}
        {addressId && quote.isFetching && (
          <p role="status">Loading server summary…</p>
        )}
        {quote.isError && (
          <div role="alert">
            <CheckoutError
              error={quote.error}
              items={shopping.cart.items.map((item) => ({
                productId: item.productId,
                name: item.product?.name,
              }))}
            />
            <Link href="/cart" className="underline">
              Review affected cart items
            </Link>
          </div>
        )}
        {quote.data && <OrderSummary summary={quote.data.data} />}
        {!attempt && addressId && (
          <button
            type="button"
            className="button-secondary"
            disabled={pending || quote.isFetching}
            onClick={() => {
              setError(null);
              quote.refetch();
            }}
          >
            Refresh server summary
          </button>
        )}
      </div>
    </form>
  );
}

export function CheckoutSuccess({ orderNumber }) {
  const auth = useAuth();
  const shopping = useShopping();
  const client = useQueryClient();
  const order = client.getQueryData([
    'checkout-success',
    auth.user.id,
    orderNumber,
  ]);
  if (!order)
    return (
      <div className="mt-6">
        <p>
          This session has no confirmed submission for this order number. An
          order number alone does not confirm an order.
        </p>
        <Link href="/checkout" className="button-secondary mt-4">
          Return to checkout
        </Link>
      </div>
    );
  return (
    <div className="mt-8 space-y-6">
      <p role="status">Your COD order was placed successfully.</p>
      <p className="break-all">Order number: {order.orderNumber}</p>
      <p>Status: {order.status}</p>
      {shopping.cartError && (
        <div role="alert">
          <p>
            Your order is confirmed, but the active cart could not be refreshed.
          </p>
          <button
            className="button-secondary"
            onClick={() => shopping.retryCart()}
          >
            Retry cart refresh
          </button>
        </div>
      )}
      <OrderSummary summary={order} placed />
      <Link href="/categories" className="button-primary">
        Continue shopping
      </Link>
    </div>
  );
}
