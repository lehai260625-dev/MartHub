'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  adminMediaSignatureResponseSchema,
  adminPromotionCreateSchema,
  adminPromotionListResponseSchema,
  adminPromotionMediaCleanupResponseSchema,
  adminPromotionResponseSchema,
} from '@marthub/contracts';
import { useAuth } from '../auth/auth-provider';

const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
const maxBytes = 4 * 1024 * 1024;
function local(value) {
  if (!value) return '';
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}
const blank = {
  title: '',
  subtitle: '',
  internalHref: '/',
  placement: 'HERO_PRIMARY',
  sortOrder: 0,
  startsAt: local(new Date()),
  endsAt: '',
};
function listPath(filters) {
  const params = new URLSearchParams({ page: '1', perPage: '24' });
  if (filters.status) params.set('status', filters.status);
  if (filters.placement) params.set('placement', filters.placement);
  return '/admin/promotions?' + params;
}

export function PromotionManager() {
  const auth = useAuth();
  const [filters, setFilters] = useState({ status: '', placement: '' });
  const [editing, setEditing] = useState(null);
  const [values, setValues] = useState(blank);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const [confirmArchive, setConfirmArchive] = useState(false);
  const promotions = useQuery({
    queryKey: ['admin-promotions', auth.user.id, filters],
    queryFn: () =>
      auth.request(listPath(filters), {
        schema: adminPromotionListResponseSchema,
      }),
  });
  const choose = (row, clearMessage = true) => {
    setEditing(row);
    setConfirmArchive(false);
    if (clearMessage) setMessage('');
    setValues({
      title: row.title,
      subtitle: row.subtitle ?? '',
      internalHref: row.internalHref,
      placement: row.placement,
      sortOrder: row.sortOrder,
      startsAt: local(row.startsAt),
      endsAt: local(row.endsAt),
    });
  };
  const refresh = async (id = editing?.id) => {
    const result = await promotions.refetch();
    const row = result.data?.data.find((item) => item.id === id);
    if (row) choose(row, false);
  };
  const submit = async (event) => {
    event.preventDefault();
    setMessage('');
    const input = {
      title: values.title,
      subtitle: values.subtitle || null,
      internalHref: values.internalHref,
      placement: values.placement,
      sortOrder: Number(values.sortOrder),
      startsAt: new Date(values.startsAt).toISOString(),
      endsAt: values.endsAt ? new Date(values.endsAt).toISOString() : null,
    };
    const parsed = adminPromotionCreateSchema.safeParse(input);
    if (!parsed.success)
      return setMessage(
        parsed.error.issues[0]?.message || 'Check the promotion.',
      );
    setPending(true);
    try {
      const result = await auth.request(
        editing ? '/admin/promotions/' + editing.id : '/admin/promotions',
        {
          method: editing ? 'PATCH' : 'POST',
          body: parsed.data,
          schema: adminPromotionResponseSchema,
        },
      );
      setMessage(
        result.data.title +
          (editing ? ' was updated.' : ' was created as a draft.'),
      );
      setEditing(result.data);
      await refresh(result.data.id);
    } catch (error) {
      setMessage(error.message || 'The promotion could not be saved.');
    } finally {
      setPending(false);
    }
  };
  const action = async (name) => {
    setPending(true);
    setMessage('');
    try {
      const result = await auth.request(
        '/admin/promotions/' + editing.id + '/' + name,
        {
          method: 'POST',
          schema: adminPromotionResponseSchema,
        },
      );
      setConfirmArchive(false);
      setMessage(
        result.data.title +
          ' was ' +
          (name === 'publish' ? 'published.' : 'archived.'),
      );
      await refresh(result.data.id);
    } catch (error) {
      setMessage(error.message || 'The status could not be changed.');
    } finally {
      setPending(false);
    }
  };
  if (promotions.isPending)
    return <p role="status">Loading promotion management...</p>;
  if (promotions.isError)
    return (
      <div role="alert">
        <p>We could not load promotions.</p>
        <button
          className="button-secondary mt-3"
          onClick={() => promotions.refetch()}
        >
          Try again
        </button>
      </div>
    );
  return (
    <div className="mt-8 grid items-start gap-8 xl:grid-cols-[minmax(0,1.3fr)_minmax(21rem,0.8fr)]">
      <section className="min-w-0" aria-labelledby="promotion-list-title">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 id="promotion-list-title" className="text-xl font-semibold">
            Promotions
          </h2>
          <button
            className="button-secondary"
            onClick={() => {
              setEditing(null);
              setValues(blank);
              setMessage('');
            }}
          >
            New promotion
          </button>
        </div>
        <form
          className="mt-4 flex flex-wrap gap-3"
          aria-label="Filter promotions"
          onSubmit={(e) => e.preventDefault()}
        >
          <select
            aria-label="Status filter"
            className="form-input max-w-48"
            value={filters.status}
            onChange={(e) => setFilters({ ...filters, status: e.target.value })}
          >
            <option value="">All statuses</option>
            <option value="DRAFT">Draft</option>
            <option value="ACTIVE">Active</option>
            <option value="ARCHIVED">Archived</option>
          </select>
          <select
            aria-label="Placement filter"
            className="form-input max-w-56"
            value={filters.placement}
            onChange={(e) =>
              setFilters({ ...filters, placement: e.target.value })
            }
          >
            <option value="">All placements</option>
            <option value="HERO_PRIMARY">Hero primary</option>
            <option value="HERO_SECONDARY">Hero secondary</option>
            <option value="EDITORIAL">Editorial</option>
          </select>
        </form>
        {promotions.data.data.length === 0 ? (
          <p className="mt-4 rounded-md border border-dashed p-5">
            No promotions found.
          </p>
        ) : (
          <div
            className="mt-4 overflow-x-auto rounded-md border bg-white"
            tabIndex={0}
            aria-label="Promotion results table"
          >
            <table className="w-full min-w-[44rem] text-left text-sm">
              <thead className="bg-neutral-100">
                <tr>
                  {[
                    'Promotion',
                    'Placement',
                    'Schedule',
                    'Order',
                    'Status',
                    'Action',
                  ].map((x) => (
                    <th key={x} className="border-b px-3 py-2">
                      {x}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {promotions.data.data.map((row) => (
                  <tr key={row.id}>
                    <th className="border-b px-3 py-3">{row.title}</th>
                    <td className="border-b px-3 py-3">{row.placement}</td>
                    <td className="border-b px-3 py-3">
                      {new Date(row.startsAt).toLocaleDateString()} to{' '}
                      {row.endsAt
                        ? new Date(row.endsAt).toLocaleDateString()
                        : 'Open'}
                    </td>
                    <td className="border-b px-3 py-3">{row.sortOrder}</td>
                    <td className="border-b px-3 py-3">{row.status}</td>
                    <td className="border-b px-3 py-3">
                      <button
                        className="font-semibold text-emerald-800 underline"
                        onClick={() => choose(row)}
                      >
                        Manage {row.title}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section
        className="rounded-lg border bg-white p-5"
        aria-labelledby="promotion-form-title"
      >
        <h2 id="promotion-form-title" className="text-xl font-semibold">
          {editing ? 'Manage ' + editing.title : 'Create promotion'}
        </h2>
        <form className="mt-5 space-y-4" onSubmit={submit} noValidate>
          <Field
            label="Title"
            value={values.title}
            onChange={(v) => setValues({ ...values, title: v })}
          />
          <Field
            label="Subtitle"
            value={values.subtitle}
            onChange={(v) => setValues({ ...values, subtitle: v })}
          />
          <Field
            label="Internal destination"
            value={values.internalHref}
            onChange={(v) => setValues({ ...values, internalHref: v })}
          />
          <label className="block font-medium">
            Placement
            <select
              className="form-input mt-2"
              value={values.placement}
              onChange={(e) =>
                setValues({ ...values, placement: e.target.value })
              }
            >
              <option value="HERO_PRIMARY">Hero primary</option>
              <option value="HERO_SECONDARY">Hero secondary</option>
              <option value="EDITORIAL">Editorial</option>
            </select>
          </label>
          <Field
            label="Display order"
            type="number"
            value={values.sortOrder}
            onChange={(v) => setValues({ ...values, sortOrder: v })}
          />
          <Field
            label="Starts at"
            type="datetime-local"
            value={values.startsAt}
            onChange={(v) => setValues({ ...values, startsAt: v })}
          />
          <Field
            label="Ends at"
            type="datetime-local"
            value={values.endsAt}
            onChange={(v) => setValues({ ...values, endsAt: v })}
          />
          <button className="button-primary" disabled={pending}>
            {pending
              ? 'Saving...'
              : editing
                ? 'Save promotion'
                : 'Create draft'}
          </button>
        </form>
        {editing && (
          <div className="mt-4 flex flex-wrap gap-3">
            {editing.status === 'DRAFT' && (
              <button
                className="button-secondary"
                disabled={pending}
                onClick={() => action('publish')}
              >
                Publish promotion
              </button>
            )}
            {editing.status !== 'ARCHIVED' &&
              (confirmArchive ? (
                <>
                  <button
                    className="button-secondary"
                    disabled={pending}
                    onClick={() => action('archive')}
                  >
                    Confirm archive
                  </button>
                  <button
                    className="button-secondary"
                    onClick={() => setConfirmArchive(false)}
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <button
                  className="button-secondary"
                  onClick={() => setConfirmArchive(true)}
                >
                  Archive promotion
                </button>
              ))}
          </div>
        )}
        {editing && (
          <PromotionMedia
            promotion={editing}
            auth={auth}
            onChanged={async (msg) => {
              setMessage(msg);
              await refresh(editing.id);
            }}
          />
        )}
        <p
          className="mt-3 min-h-6 text-sm text-red-800"
          role={message ? 'alert' : undefined}
        >
          {message}
        </p>
      </section>
    </div>
  );
}
function Field({ label, onChange, ...props }) {
  const id = 'promotion-' + label.toLowerCase().replaceAll(' ', '-');
  return (
    <label className="block font-medium" htmlFor={id}>
      {label}
      <input
        id={id}
        className="form-input mt-2"
        disabled={props.disabled}
        {...props}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}
function PromotionMedia({ promotion, auth, onChanged }) {
  const [file, setFile] = useState(null);
  const [pending, setPending] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [message, setMessage] = useState('');
  const upload = async (e) => {
    e.preventDefault();
    setMessage('');
    if (!file) return setMessage('Choose an image to upload.');
    if (!allowedTypes.has(file.type))
      return setMessage('Use a JPEG, PNG, or WebP image.');
    if (file.size > maxBytes)
      return setMessage('Image size must not exceed 4 MB.');
    setPending(true);
    try {
      const signed = await auth.request(
        '/admin/promotions/' + promotion.id + '/media/signature',
        { method: 'POST', schema: adminMediaSignatureResponseSchema },
      );
      const form = new FormData();
      form.append('file', file);
      form.append('api_key', signed.data.apiKey);
      for (const [key, value] of Object.entries(signed.data.parameters))
        form.append(key, String(value));
      const response = await fetch(signed.data.uploadUrl, {
        method: 'POST',
        body: form,
      });
      const provider = await response.json();
      if (
        !response.ok ||
        provider.public_id !== signed.data.parameters.public_id
      )
        throw new Error('Cloudinary could not complete the upload.');
      await auth.request('/admin/promotions/' + promotion.id + '/media', {
        method: 'POST',
        body: {
          publicId: signed.data.parameters.public_id,
          uploadTimestamp: signed.data.parameters.timestamp,
          uploadSignature: signed.data.parameters.signature,
        },
        schema: adminPromotionResponseSchema,
      });
      setFile(null);
      await onChanged('Promotion image uploaded and verified.');
    } catch (error) {
      setMessage(error.message || 'The image could not be uploaded.');
    } finally {
      setPending(false);
    }
  };
  const remove = async () => {
    setPending(true);
    try {
      const result = await auth.request(
        '/admin/promotions/' + promotion.id + '/media',
        { method: 'DELETE', schema: adminPromotionMediaCleanupResponseSchema },
      );
      setConfirm(false);
      await onChanged(
        result.data.status === 'COMPLETED'
          ? 'Promotion image removed.'
          : 'Promotion image removed. Cloudinary cleanup is pending.',
      );
    } catch (error) {
      setMessage(error.message || 'The image could not be removed.');
    } finally {
      setPending(false);
    }
  };
  return (
    <div className="mt-8 border-t pt-6">
      <h3 className="text-lg font-semibold">Promotion image</h3>
      <p className="mt-2 text-sm text-neutral-600">
        JPEG, PNG, or WebP. Maximum 4 MB.
      </p>
      {promotion.image ? (
        <div className="mt-4">
          {/* Cloudinary already applies bounded responsive delivery transformations. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={promotion.image.url}
            alt={promotion.title}
            className="aspect-video w-full rounded-md object-cover"
          />
          <div className="mt-3">
            {confirm ? (
              <>
                <button
                  className="button-secondary"
                  disabled={pending}
                  onClick={remove}
                >
                  Confirm image removal
                </button>
                <button
                  className="button-secondary ml-2"
                  onClick={() => setConfirm(false)}
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                className="button-secondary"
                onClick={() => setConfirm(true)}
              >
                Remove image
              </button>
            )}
          </div>
        </div>
      ) : (
        <p className="mt-4">No image attached.</p>
      )}
      <form className="mt-4" onSubmit={upload}>
        <label className="block font-medium">
          Image file
          <input
            aria-label="Promotion image file"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="mt-2 block w-full"
            disabled={pending}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </label>
        <button className="button-secondary mt-3" disabled={pending}>
          {pending
            ? 'Uploading...'
            : promotion.image
              ? 'Replace image'
              : 'Upload image'}
        </button>
      </form>
      <p
        role={message ? 'alert' : undefined}
        className="mt-3 text-sm text-red-800"
      >
        {message}
      </p>
    </div>
  );
}
