'use client';

import { useRef, useState } from 'react';
import {
  customerOrderCancelInputSchema,
  customerOrderDetailResponseSchema,
} from '@marthub/contracts';
import { useAuth } from '../auth/auth-provider';

export function OrderCancellation({ order, refresh }) {
  const auth = useAuth();
  const locked = useRef(false);
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [succeeded, setSucceeded] = useState(false);
  const submit = async (event) => {
    event.preventDefault();
    if (locked.current) return;
    const input = customerOrderCancelInputSchema.safeParse({ reason });
    if (!input.success) {
      setError('Reason must be at most 240 characters after trimming.');
      return;
    }
    locked.current = true;
    setPending(true);
    setError('');
    try {
      await auth.request(`/orders/${order.id}/cancel`, {
        method: 'POST',
        body: input.data,
        schema: customerOrderDetailResponseSchema,
      });
      setSucceeded(true);
      setConfirming(false);
      await refresh();
    } catch (failure) {
      setError(
        failure.status === 409
          ? 'This order can no longer be cancelled. Refresh the order to see its current status.'
          : 'Cancellation could not be confirmed. Refresh the order or try again.',
      );
    } finally {
      locked.current = false;
      setPending(false);
    }
  };
  return (
    <section aria-label="Order cancellation" className="space-y-3">
      {succeeded && (
        <p role="status">
          Cancellation succeeded. The status and history below come from your
          order.
        </p>
      )}
      {['PENDING', 'CONFIRMED'].includes(order.status) &&
        !succeeded &&
        (confirming ? (
          <form onSubmit={submit} className="space-y-3">
            <h2 className="text-xl font-semibold">Cancel this order?</h2>
            <p>This action cannot be undone.</p>
            <label className="grid gap-2">
              Cancellation reason (optional)
              <textarea
                className="w-full rounded border p-3"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                disabled={pending}
                aria-describedby="cancel-reason-help"
              />
            </label>
            <p id="cancel-reason-help">Up to 240 characters after trimming.</p>
            <div className="flex flex-wrap gap-3">
              <button className="button-primary" disabled={pending}>
                {pending ? 'Cancelling…' : 'Confirm cancellation'}
              </button>
              <button
                type="button"
                className="button-secondary"
                disabled={pending}
                onClick={() => {
                  setConfirming(false);
                  setError('');
                }}
              >
                Keep order
              </button>
            </div>
          </form>
        ) : (
          <button
            className="button-secondary"
            onClick={() => setConfirming(true)}
          >
            Cancel order
          </button>
        ))}
      {error && <p role="alert">{error}</p>}
      {(error || succeeded) && (
        <button
          className="button-secondary"
          disabled={pending}
          onClick={() => refresh()}
        >
          Refresh order
        </button>
      )}
    </section>
  );
}
