'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  adminUserListResponseSchema,
  adminUserQuerySchema,
} from '@marthub/contracts';
import { useAuth } from '../auth/auth-provider';

export function adminUserQueueParams(query) {
  const params = new URLSearchParams();
  for (const key of ['q', 'role', 'status'])
    if (query[key]) params.set(key, query[key]);
  if (query.sort !== 'newest') params.set('sort', query.sort);
  if (query.page !== 1) params.set('page', String(query.page));
  if (query.perPage !== 20) params.set('perPage', String(query.perPage));
  return params;
}
export const userStatusLabel = (status) =>
  status === 'SUSPENDED'
    ? 'Disabled'
    : status === 'ACTIVE'
      ? 'Active'
      : 'Archived';
export function AdminUserQueue() {
  const auth = useAuth();
  const router = useRouter();
  const search = useSearchParams();
  const parsed = adminUserQuerySchema.safeParse(
    Object.fromEntries(
      [...search.keys()].map((key) => [
        key,
        search.getAll(key).length > 1 ? search.getAll(key) : search.get(key),
      ]),
    ),
  );
  const params = parsed.success
    ? adminUserQueueParams(parsed.data).toString()
    : '';
  const query = useQuery({
    queryKey: ['admin-users', auth.user.id, params],
    queryFn: ({ signal }) =>
      auth.request('/admin/users' + (params ? '?' + params : ''), {
        signal,
        schema: adminUserListResponseSchema,
      }),
    enabled: parsed.success,
    retry: false,
  });
  const href = (updates) => {
    const next = { ...parsed.data, ...updates };
    if (typeof next.q === 'string')
      next.q = next.q.trim().replace(/\s+/gu, ' ') || undefined;
    const value = adminUserQueueParams(next).toString();
    return '/admin/users' + (value ? '?' + value : '');
  };
  const update = (updates) => router.push(href({ ...updates, page: 1 }));
  if (!parsed.success)
    return (
      <div role="alert">
        <p>These user filters are invalid.</p>
        <Link className="button-secondary" href="/admin/users">
          Reset filters
        </Link>
      </div>
    );
  return (
    <section className="mt-6 min-w-0" aria-label="User list">
      <form
        role="search"
        className="flex flex-col gap-3 sm:flex-row"
        onSubmit={(event) => {
          event.preventDefault();
          update({ q: new FormData(event.currentTarget).get('q') });
        }}
      >
        <label className="min-w-0 flex-1">
          Search users
          <input
            key={parsed.data.q ?? ''}
            name="q"
            className="form-input mt-2"
            maxLength={100}
            defaultValue={parsed.data.q ?? ''}
            placeholder="Email or name"
          />
        </label>
        <button className="button-primary self-end">Search</button>
      </form>
      <div className="my-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          [
            'Role',
            'role',
            [
              ['', 'All roles'],
              ['CUSTOMER', 'Customer'],
              ['ADMIN', 'Admin'],
            ],
          ],
          [
            'Status',
            'status',
            [
              ['', 'All statuses'],
              ['ACTIVE', 'Active'],
              ['SUSPENDED', 'Disabled'],
              ['ARCHIVED', 'Archived'],
            ],
          ],
          [
            'Sort',
            'sort',
            [
              ['newest', 'Newest'],
              ['oldest', 'Oldest'],
              ['email', 'Email'],
            ],
          ],
          [
            'Users per page',
            'perPage',
            [
              ...(![20, 50].includes(parsed.data.perPage)
                ? [[String(parsed.data.perPage), String(parsed.data.perPage)]]
                : []),
              ['20', '20'],
              ['50', '50'],
            ],
          ],
        ].map(([label, key, options]) => (
          <label className="grid gap-2" key={key}>
            {label}
            <select
              className="form-input"
              value={String(parsed.data[key] ?? '')}
              onChange={(e) =>
                update({
                  [key]:
                    key === 'perPage'
                      ? Number(e.target.value)
                      : e.target.value || undefined,
                })
              }
            >
              {options.map(([value, text]) => (
                <option key={value} value={value}>
                  {text}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      {query.isPending ? (
        <p role="status">Loading users...</p>
      ) : query.isError ? (
        <div role="alert">
          <p>We could not load users.</p>
          <button
            className="button-secondary mt-3"
            onClick={() => query.refetch()}
          >
            Try again
          </button>
        </div>
      ) : !query.data.data.length ? (
        <p>No users match these filters.</p>
      ) : (
        <>
          <ul className="divide-y divide-neutral-200 rounded-lg border border-neutral-200 bg-white">
            {query.data.data.map((user) => (
              <li
                key={user.id}
                className="grid min-w-0 gap-2 p-4 sm:grid-cols-3"
              >
                <div className="min-w-0 break-words">
                  <Link
                    className="inline-flex min-h-11 items-center font-semibold underline"
                    href={`/admin/users/${user.id}`}
                  >
                    {user.email}
                  </Link>
                  <p>
                    {user.firstName} {user.lastName}
                  </p>
                </div>
                <p>
                  {user.role} · {userStatusLabel(user.status)}
                </p>
                <p className="text-sm">
                  Created{' '}
                  <time dateTime={user.createdAt}>
                    {new Date(user.createdAt).toLocaleDateString('en-GB')}
                  </time>
                </p>
              </li>
            ))}
          </ul>
        </>
      )}
      {query.data && (
        <nav
          aria-label="User pagination"
          className="mt-5 flex flex-wrap items-center gap-3"
        >
          <p>
            Page {query.data.meta.page} of{' '}
            {Math.max(1, query.data.meta.totalPages)} ·{' '}
            {query.data.meta.totalItems} users
          </p>
          {parsed.data.page > 1 && (
            <Link
              className="button-secondary"
              href={href({ page: parsed.data.page - 1 })}
            >
              Previous page
            </Link>
          )}
          {parsed.data.page < query.data.meta.totalPages && (
            <Link
              className="button-secondary"
              href={href({ page: parsed.data.page + 1 })}
            >
              Next page
            </Link>
          )}
        </nav>
      )}
    </section>
  );
}
