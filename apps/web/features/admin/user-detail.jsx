'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  adminUserDetailResponseSchema,
  adminUserStatusInputSchema,
  allowedAdminUserStatuses,
} from '@marthub/contracts';
import { useAuth } from '../auth/auth-provider';
import { userStatusLabel } from './user-queue';

export function AdminUserDetail({ userId }) {
  const auth = useAuth();
  const router = useRouter();
  const client = useQueryClient();
  const key = ['admin-user', auth.user.id, userId];
  const query = useQuery({
    queryKey: key,
    queryFn: ({ signal }) =>
      auth.request(`/admin/users/${encodeURIComponent(userId)}`, {
        signal,
        schema: adminUserDetailResponseSchema,
      }),
    retry: false,
  });
  return (
    <div className="min-w-0 space-y-5 break-words">
      <button className="button-secondary" onClick={() => router.back()}>
        Back to users
      </button>
      {query.isPending ? (
        <p role="status">Loading user detail...</p>
      ) : query.isError ? (
        <div role="alert">
          <p>
            {query.error.status === 404
              ? 'User not found.'
              : 'We could not load this user.'}
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
          <h1 className="text-3xl font-semibold">User detail</h1>
          <dl className="grid gap-3 rounded-lg border border-neutral-200 bg-white p-5">
            {Object.entries({
              Email: query.data.data.email,
              Name: `${query.data.data.firstName} ${query.data.data.lastName}`,
              Role: query.data.data.role,
              Status: userStatusLabel(query.data.data.status),
              'User ID': query.data.data.id,
              Created: query.data.data.createdAt,
              Updated: query.data.data.updatedAt,
              Archived: query.data.data.archivedAt ?? 'Not archived',
            }).map(([label, value]) => (
              <div key={label}>
                <dt className="font-semibold">{label}</dt>
                <dd className="break-all">{value}</dd>
              </div>
            ))}
          </dl>
          <UserStatusActions
            user={query.data.data}
            auth={auth}
            refresh={() => query.refetch()}
            onSuccess={(response) => {
              client.setQueryData(key, response);
              client.invalidateQueries({ queryKey: ['admin-users'] });
            }}
          />
        </>
      )}
    </div>
  );
}
function UserStatusActions({ user, auth, onSuccess, refresh }) {
  const [target, setTarget] = useState(null);
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const guard = useRef(false);
  const actions = allowedAdminUserStatuses(user);
  if (user.id === auth.user.id)
    return <p role="status">You cannot change your own account status.</p>;
  const submit = async (event) => {
    event.preventDefault();
    if (guard.current) return;
    const result = adminUserStatusInputSchema.safeParse({
      expectedStatus: user.status,
      toStatus: target,
      ...(target === 'ACTIVE' ? {} : { reason }),
    });
    if (!result.success) {
      setError('Enter a nonblank reason of at most 240 characters.');
      return;
    }
    guard.current = true;
    setPending(true);
    setError('');
    setMessage('');
    try {
      const response = await auth.request(
        `/admin/users/${encodeURIComponent(user.id)}/status`,
        {
          method: 'PATCH',
          body: result.data,
          schema: adminUserDetailResponseSchema,
        },
      );
      onSuccess(response);
      setTarget(null);
      setReason('');
      setMessage('Account status updated.');
    } catch (failure) {
      const current = failure.details?.[0]?.currentStatus;
      setError(
        failure.code === 'USER_STATUS_CONFLICT'
          ? `Account status changed to ${current ? userStatusLabel(current) : 'a different state'}. Refresh before retrying.`
          : failure.code === 'LAST_ACTIVE_ADMIN_REQUIRED'
            ? 'At least one active Admin must remain.'
            : failure.code === 'ADMIN_SELF_STATUS_CHANGE_FORBIDDEN'
              ? 'You cannot change your own account status.'
              : 'Status update failed. Refresh or retry.',
      );
    } finally {
      guard.current = false;
      setPending(false);
    }
  };
  return (
    <section aria-label="Account status actions" className="space-y-4">
      {message && <p role="status">{message}</p>}
      {error && (
        <div role="alert">
          <p>{error}</p>
          <button
            disabled={pending}
            className="button-secondary mt-3"
            onClick={async () => {
              const result = await refresh();
              if (!result.isError) {
                setTarget(null);
                setError('');
              }
            }}
          >
            Refresh account
          </button>
        </div>
      )}
      {!target ? (
        <div className="flex flex-wrap gap-3">
          {actions.map((status) => (
            <button
              key={status}
              className="button-secondary"
              onClick={() => {
                setTarget(status);
                setReason('');
                setError('');
                setMessage('');
              }}
            >
              {status === 'ACTIVE'
                ? 'Reactivate account'
                : status === 'SUSPENDED'
                  ? 'Disable account'
                  : 'Archive account'}
            </button>
          ))}
          {!actions.length && <p>This archived account cannot be changed.</p>}
        </div>
      ) : (
        <form
          onSubmit={submit}
          className="space-y-4 rounded-lg border border-neutral-300 bg-white p-5"
        >
          <p className="font-semibold">
            {target === 'ACTIVE'
              ? 'Reactivate this account?'
              : target === 'SUSPENDED'
                ? 'Confirm disabling this account'
                : 'Confirm archiving this account'}
          </p>
          {target !== 'ACTIVE' && (
            <>
              <p>
                {target === 'ARCHIVED'
                  ? 'Archiving is permanent. Existing sessions will be revoked.'
                  : 'Existing sessions will be revoked. The user must log in again after reactivation.'}
              </p>
              <label className="grid gap-2" htmlFor="user-status-reason">
                Reason (required)
                <textarea
                  id="user-status-reason"
                  className="form-input"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  disabled={pending}
                  aria-invalid={Boolean(error)}
                  aria-describedby={error ? 'user-reason-help' : undefined}
                />
              </label>
              <p id="user-reason-help">Use 1–240 characters after trimming.</p>
            </>
          )}
          <div className="flex flex-wrap gap-3">
            <button className="button-primary" disabled={pending}>
              {pending ? 'Updating...' : 'Confirm status change'}
            </button>
            <button
              type="button"
              className="button-secondary"
              disabled={pending}
              onClick={() => {
                setTarget(null);
                setError('');
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
