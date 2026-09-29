'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  adminInventoryAdjustmentResponseSchema,
  adminInventoryAdjustmentSchema,
  adminInventoryMovementListResponseSchema,
} from '@marthub/contracts';

function formatMoment(value) {
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

export function ProductInventoryManager({ product, auth, onChanged }) {
  const history = useQuery({
    queryKey: ['admin-inventory-movements', product.id],
    queryFn: () =>
      auth.request('/admin/inventory/' + product.id + '/movements', {
        schema: adminInventoryMovementListResponseSchema,
      }),
  });
  const [quantity, setQuantity] = useState(product.quantityOnHand);
  const [adjustment, setAdjustment] = useState('');
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');

  const submit = async (event) => {
    event.preventDefault();
    setMessage('');
    const parsed = adminInventoryAdjustmentSchema.safeParse({
      adjustment: Number(adjustment),
      reason,
    });
    if (!parsed.success) {
      setMessage(
        parsed.error.issues[0]?.message || 'Check the inventory adjustment.',
      );
      return;
    }
    setPending(true);
    try {
      const result = await auth.request(
        '/admin/inventory/' + product.id + '/adjustments',
        {
          method: 'POST',
          body: parsed.data,
          schema: adminInventoryAdjustmentResponseSchema,
        },
      );
      setQuantity(result.data.inventory.quantityOnHand);
      setAdjustment('');
      setReason('');
      await history.refetch();
      await onChanged(
        'Stock adjusted from ' +
          result.data.movement.quantityBefore +
          ' to ' +
          result.data.movement.quantityAfter +
          '.',
      );
    } catch (error) {
      setMessage(
        error.message || 'The inventory adjustment could not be saved.',
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <section
      className="mt-8 min-w-0 border-t border-neutral-200 pt-6"
      aria-labelledby="product-inventory-title"
    >
      <h3 id="product-inventory-title" className="text-lg font-semibold">
        Inventory
      </h3>
      <p className="mt-2 text-sm text-neutral-600">
        Current stock: <strong className="tabular-nums">{quantity}</strong>.
        Apply a signed change and record why it was needed.
      </p>
      {history.isPending ? (
        <p className="mt-4" role="status">
          Loading inventory history...
        </p>
      ) : history.isError ? (
        <div
          className="mt-4 rounded-md border border-red-200 bg-red-50 p-4"
          role="alert"
        >
          <p>We could not load inventory history.</p>
          <button
            className="button-secondary mt-3"
            onClick={() => history.refetch()}
          >
            Try inventory history again
          </button>
        </div>
      ) : history.data.data.length === 0 ? (
        <p className="mt-4 rounded-md border border-dashed border-neutral-300 p-4">
          No inventory movements yet.
        </p>
      ) : (
        <div
          className="mt-4 max-w-full overflow-x-auto rounded-md border border-neutral-300"
          tabIndex={0}
          aria-label="Inventory movement history table"
        >
          <table className="w-full min-w-[42rem] border-collapse text-left text-sm">
            <thead className="bg-neutral-100">
              <tr>
                {[
                  'Before',
                  'Adjustment',
                  'After',
                  'Reason',
                  'Actor',
                  'Recorded',
                ].map((heading) => (
                  <th key={heading} className="border-b px-3 py-2" scope="col">
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {history.data.data.map((row) => (
                <tr key={row.id}>
                  <td className="border-b px-3 py-3 tabular-nums">
                    {row.quantityBefore}
                  </td>
                  <td className="border-b px-3 py-3 tabular-nums">
                    {row.adjustment > 0 ? '+' : ''}
                    {row.adjustment}
                  </td>
                  <td className="border-b px-3 py-3 tabular-nums">
                    {row.quantityAfter}
                  </td>
                  <td className="border-b px-3 py-3">
                    {row.reason || 'System'}
                  </td>
                  <td className="border-b px-3 py-3">
                    {row.actor
                      ? row.actor.firstName + ' ' + row.actor.lastName
                      : 'System'}
                  </td>
                  <td className="border-b px-3 py-3">
                    {formatMoment(row.createdAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <form className="mt-6 space-y-4" onSubmit={submit} noValidate>
        <div>
          <label className="block font-medium" htmlFor="inventory-adjustment">
            Signed adjustment
          </label>
          <input
            id="inventory-adjustment"
            className="form-input mt-2"
            inputMode="numeric"
            value={adjustment}
            disabled={pending}
            onChange={(event) => setAdjustment(event.target.value)}
            placeholder="For example, 5 or -2"
          />
        </div>
        <div>
          <label className="block font-medium" htmlFor="inventory-reason">
            Reason
          </label>
          <textarea
            id="inventory-reason"
            className="mt-2 w-full rounded-md border border-neutral-400 px-3 py-2"
            rows={3}
            maxLength={240}
            value={reason}
            disabled={pending}
            onChange={(event) => setReason(event.target.value)}
          />
        </div>
        <button className="button-secondary" disabled={pending}>
          {pending ? 'Adjusting stock...' : 'Adjust stock'}
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
