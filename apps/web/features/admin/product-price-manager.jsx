'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  adminProductPriceCreateSchema,
  adminProductPriceHistoryResponseSchema,
  adminProductPriceResponseSchema,
} from '@marthub/contracts';
import { formatVnd } from '../catalog/catalog-query';

function localDateTime(date = new Date()) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}
function formatMoment(value) {
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

export function ProductPriceManager({ product, auth, onChanged }) {
  const history = useQuery({
    queryKey: ['admin-product-prices', product.id],
    queryFn: () =>
      auth.request(`/admin/products/${product.id}/prices`, {
        schema: adminProductPriceHistoryResponseSchema,
      }),
  });
  const [price, setPrice] = useState('');
  const [compareAtPrice, setCompareAtPrice] = useState('');
  const [startsAt, setStartsAt] = useState(() => localDateTime());
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');

  const submit = async (event) => {
    event.preventDefault();
    setMessage('');
    const instant = new Date(startsAt);
    const input = {
      price,
      compareAtPrice: compareAtPrice || null,
      startsAt: Number.isNaN(instant.getTime())
        ? startsAt
        : instant.toISOString(),
    };
    const parsed = adminProductPriceCreateSchema.safeParse(input);
    if (!parsed.success) {
      setMessage(parsed.error.issues[0]?.message || 'Check the price fields.');
      return;
    }
    setPending(true);
    try {
      const result = await auth.request(
        `/admin/products/${product.id}/prices`,
        {
          method: 'POST',
          body: parsed.data,
          schema: adminProductPriceResponseSchema,
        },
      );
      setPrice('');
      setCompareAtPrice('');
      setStartsAt(localDateTime());
      await history.refetch();
      await onChanged(
        result.data.isCurrent
          ? 'Current price updated with history preserved.'
          : 'Future price scheduled with history preserved.',
      );
    } catch (error) {
      setMessage(error.message || 'The price could not be scheduled.');
    } finally {
      setPending(false);
    }
  };

  return (
    <section
      className="mt-8 min-w-0 border-t border-neutral-200 pt-6"
      aria-labelledby="product-prices-title"
    >
      <h3 id="product-prices-title" className="text-lg font-semibold">
        Price history
      </h3>
      <p className="mt-2 text-sm text-neutral-600">
        New prices close the latest interval at the selected start time.
        Existing price values and history cannot be edited.
      </p>
      {history.isPending ? (
        <p className="mt-4" role="status">
          Loading price history...
        </p>
      ) : history.isError ? (
        <div
          className="mt-4 rounded-md border border-red-200 bg-red-50 p-4"
          role="alert"
        >
          <p>We could not load price history.</p>
          <button
            className="button-secondary mt-3"
            onClick={() => history.refetch()}
          >
            Try price history again
          </button>
        </div>
      ) : history.data.data.length === 0 ? (
        <p className="mt-4 rounded-md border border-dashed border-neutral-300 p-4">
          No price history found.
        </p>
      ) : (
        <div
          className="mt-4 max-w-full overflow-x-auto rounded-md border border-neutral-300"
          tabIndex={0}
          aria-label="Price history table"
        >
          <table className="w-full min-w-[42rem] border-collapse text-left text-sm">
            <thead className="bg-neutral-100">
              <tr>
                {['Price', 'Compare price', 'Starts', 'Ends', 'Actor'].map(
                  (heading) => (
                    <th
                      key={heading}
                      className="border-b px-3 py-2"
                      scope="col"
                    >
                      {heading}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {history.data.data.map((row) => (
                <tr key={row.id}>
                  <td className="border-b px-3 py-3 tabular-nums">
                    {formatVnd(row.price)}
                    {row.isCurrent && (
                      <span className="ml-2 rounded-full bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-900">
                        Current
                      </span>
                    )}
                  </td>
                  <td className="border-b px-3 py-3 tabular-nums">
                    {row.compareAtPrice ? formatVnd(row.compareAtPrice) : '�'}
                  </td>
                  <td className="border-b px-3 py-3">
                    {formatMoment(row.startsAt)}
                  </td>
                  <td className="border-b px-3 py-3">
                    {row.endsAt ? formatMoment(row.endsAt) : 'Open-ended'}
                  </td>
                  <td className="border-b px-3 py-3">
                    {row.createdBy
                      ? `${row.createdBy.firstName} ${row.createdBy.lastName}`
                      : 'System'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <form className="mt-6 space-y-4" onSubmit={submit} noValidate>
        <div>
          <label className="block font-medium" htmlFor="successor-price">
            New price (VND)
          </label>
          <input
            id="successor-price"
            className="form-input mt-2"
            inputMode="numeric"
            value={price}
            disabled={pending}
            onChange={(event) => setPrice(event.target.value)}
          />
        </div>
        <div>
          <label
            className="block font-medium"
            htmlFor="successor-compare-price"
          >
            New compare price (VND)
          </label>
          <input
            id="successor-compare-price"
            className="form-input mt-2"
            inputMode="numeric"
            value={compareAtPrice}
            disabled={pending}
            onChange={(event) => setCompareAtPrice(event.target.value)}
          />
        </div>
        <div>
          <label className="block font-medium" htmlFor="successor-starts-at">
            Starts at
          </label>
          <input
            id="successor-starts-at"
            className="form-input mt-2"
            type="datetime-local"
            value={startsAt}
            disabled={pending}
            onChange={(event) => setStartsAt(event.target.value)}
          />
        </div>
        <button className="button-secondary" disabled={pending}>
          {pending ? 'Scheduling price...' : 'Schedule price'}
        </button>
      </form>
      <p
        className="mt-3 min-h-6 text-sm text-red-800"
        role={message ? 'alert' : undefined}
      >
        {message}
      </p>
    </section>
  );
}
