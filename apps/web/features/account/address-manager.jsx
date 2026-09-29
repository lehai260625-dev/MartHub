'use client';
import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  addressFormSchema,
  addressListResponseSchema,
  addressResponseSchema,
} from '@marthub/contracts';
import { useAuth } from '../auth/auth-provider';

const emptyAddress = {
  label: '',
  recipientName: '',
  phone: '',
  line1: '',
  line2: '',
  ward: '',
  district: '',
  province: '',
  postalCode: '',
  isDefault: false,
};
const formValues = (address) => ({
  label: address?.label ?? '',
  recipientName: address?.recipientName ?? '',
  phone: address?.phone ?? '',
  line1: address?.line1 ?? '',
  line2: address?.line2 ?? '',
  ward: address?.ward ?? '',
  district: address?.district ?? '',
  province: address?.province ?? '',
  postalCode: address?.postalCode ?? '',
  isDefault: address?.isDefault ?? false,
});

export function AddressManager() {
  const auth = useAuth();
  const [editing, setEditing] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [actionMessage, setActionMessage] = useState('');
  const addresses = useQuery({
    queryKey: ['addresses', auth.user.id],
    queryFn: () =>
      auth.request('/users/me/addresses', {
        schema: addressListResponseSchema,
      }),
  });
  const action = useMutation({
    mutationFn: ({ path, method }) =>
      auth.request(path, {
        method,
        ...(method === 'PUT' ? { schema: addressResponseSchema } : {}),
      }),
    onSuccess: () => addresses.refetch(),
  });
  const runAction = async (operation, address) => {
    setActionMessage('');
    try {
      await action.mutateAsync({
        method: operation === 'default' ? 'PUT' : 'DELETE',
        path: `/users/me/addresses/${address.id}${
          operation === 'default' ? '/default' : ''
        }`,
      });
      setConfirmDeleteId(null);
      setActionMessage(
        operation === 'default'
          ? `${address.label} is now your default address.`
          : `${address.label} was removed.`,
      );
    } catch (error) {
      setActionMessage(
        error.message || 'The address action could not be completed.',
      );
    }
  };

  if (addresses.isPending) return <p role="status">Loading your addresses…</p>;
  if (addresses.isError)
    return (
      <div
        role="alert"
        className="rounded-2xl border border-red-200 bg-red-50 p-5"
      >
        <p>We could not load your addresses.</p>
        <button
          className="button-secondary mt-4"
          onClick={() => addresses.refetch()}
        >
          Try again
        </button>
      </div>
    );

  return (
    <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.8fr)]">
      <section aria-labelledby="saved-addresses-title">
        <h2 id="saved-addresses-title" className="text-xl font-semibold">
          Saved addresses
        </h2>
        {addresses.data.data.length === 0 ? (
          <div className="mt-4 rounded-2xl border border-dashed border-neutral-300 bg-white p-6">
            <p className="font-medium">No delivery addresses yet.</p>
            <p className="mt-2 text-neutral-600">
              Add one now so it is ready for checkout later.
            </p>
          </div>
        ) : (
          <ul className="mt-4 space-y-4">
            {addresses.data.data.map((address) => (
              <li
                key={address.id}
                className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold">{address.label}</h3>
                    {address.isDefault && (
                      <span className="mt-2 inline-flex rounded-full bg-emerald-100 px-3 py-1 text-sm font-medium text-emerald-900">
                        Default
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      className="button-secondary"
                      disabled={action.isPending}
                      onClick={() => setEditing(address)}
                    >
                      Edit {address.label}
                    </button>
                    {!address.isDefault && (
                      <button
                        className="button-secondary"
                        disabled={action.isPending}
                        onClick={() => runAction('default', address)}
                      >
                        Make {address.label} default
                      </button>
                    )}
                  </div>
                </div>
                <address className="mt-4 not-italic text-neutral-700">
                  <p>{address.recipientName}</p>
                  <p>{address.phone}</p>
                  <p>{address.line1}</p>
                  {address.line2 && <p>{address.line2}</p>}
                  <p>
                    {address.ward}, {address.district}, {address.province}
                    {address.postalCode ? ` ${address.postalCode}` : ''}
                  </p>
                </address>
                <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-neutral-100 pt-4">
                  {confirmDeleteId === address.id ? (
                    <>
                      <span>Remove {address.label}?</span>
                      <button
                        className="button-secondary"
                        disabled={action.isPending}
                        onClick={() => runAction('remove', address)}
                      >
                        Confirm remove
                      </button>
                      <button
                        className="button-secondary"
                        disabled={action.isPending}
                        onClick={() => setConfirmDeleteId(null)}
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button
                      className="text-sm font-medium text-red-700 underline-offset-4 hover:underline"
                      disabled={action.isPending}
                      onClick={() => setConfirmDeleteId(address.id)}
                    >
                      Remove {address.label}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        <p aria-live="polite" className="mt-4 min-h-6 text-neutral-700">
          {actionMessage}
        </p>
      </section>
      <AddressForm
        key={editing?.id || 'new'}
        address={editing}
        auth={auth}
        onCancel={() => setEditing(null)}
        onSaved={async () => {
          setEditing(null);
          await addresses.refetch();
        }}
      />
    </div>
  );
}

function AddressForm({ address, auth, onCancel, onSaved }) {
  const [submitError, setSubmitError] = useState('');
  const [saved, setSaved] = useState(false);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(addressFormSchema),
    defaultValues: formValues(address),
  });
  const submit = async (values) => {
    setSaved(false);
    setSubmitError('');
    const fields = {
      label: values.label,
      recipientName: values.recipientName,
      phone: values.phone,
      line1: values.line1,
      line2: values.line2 || null,
      ward: values.ward,
      district: values.district,
      province: values.province,
      postalCode: values.postalCode || null,
      ...(address ? {} : { isDefault: values.isDefault }),
    };
    try {
      await auth.request(
        address ? `/users/me/addresses/${address.id}` : '/users/me/addresses',
        {
          method: address ? 'PATCH' : 'POST',
          body: fields,
          schema: addressResponseSchema,
        },
      );
      if (!address) reset(emptyAddress);
      setSaved(true);
      await onSaved();
    } catch (error) {
      setSubmitError(error.message || 'The address could not be saved.');
    }
  };
  return (
    <section
      className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm sm:p-6"
      aria-labelledby="address-form-title"
    >
      <h2 id="address-form-title" className="text-xl font-semibold">
        {address ? `Edit ${address.label}` : 'Add an address'}
      </h2>
      <form
        className="mt-5 space-y-4"
        onSubmit={handleSubmit(submit)}
        noValidate
      >
        <Field
          label="Address label"
          name="label"
          register={register}
          error={errors.label}
          autoComplete="off"
        />
        <Field
          label="Recipient name"
          name="recipientName"
          register={register}
          error={errors.recipientName}
          autoComplete="name"
        />
        <Field
          label="Phone number"
          name="phone"
          type="tel"
          register={register}
          error={errors.phone}
          autoComplete="tel"
        />
        <Field
          label="Address line 1"
          name="line1"
          register={register}
          error={errors.line1}
          autoComplete="address-line1"
        />
        <Field
          label="Address line 2 (optional)"
          name="line2"
          register={register}
          error={errors.line2}
          autoComplete="address-line2"
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Ward"
            name="ward"
            register={register}
            error={errors.ward}
            autoComplete="address-level3"
          />
          <Field
            label="District"
            name="district"
            register={register}
            error={errors.district}
            autoComplete="address-level2"
          />
        </div>
        <Field
          label="Province or city"
          name="province"
          register={register}
          error={errors.province}
          autoComplete="address-level1"
        />
        <Field
          label="Postal code (optional)"
          name="postalCode"
          register={register}
          error={errors.postalCode}
          autoComplete="postal-code"
        />
        {!address && (
          <label className="flex min-h-11 items-center gap-3">
            <input
              type="checkbox"
              className="size-5 accent-emerald-700"
              {...register('isDefault')}
            />
            Make this my default address
          </label>
        )}
        <div aria-live="polite" className="min-h-6">
          {saved && <p className="text-emerald-800">Address saved.</p>}
          {submitError && <p className="text-red-700">{submitError}</p>}
        </div>
        <div className="flex flex-col gap-3 sm:flex-row">
          <button className="button-primary" disabled={isSubmitting}>
            {isSubmitting
              ? 'Saving…'
              : address
                ? 'Save changes'
                : 'Add address'}
          </button>
          {address && (
            <button
              type="button"
              className="button-secondary"
              disabled={isSubmitting}
              onClick={onCancel}
            >
              Cancel editing
            </button>
          )}
        </div>
      </form>
    </section>
  );
}

function Field({ label, name, register, error, type = 'text', autoComplete }) {
  const errorId = `${name}-error`;
  return (
    <div>
      <label className="block font-medium" htmlFor={`address-${name}`}>
        {label}
      </label>
      <input
        {...register(name)}
        id={`address-${name}`}
        type={type}
        autoComplete={autoComplete}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? errorId : undefined}
        className="mt-2 min-h-11 w-full rounded-xl border border-neutral-300 px-3 focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-700/30"
      />
      {error && (
        <p id={errorId} className="mt-2 text-sm text-red-700">
          {error.message}
        </p>
      )}
    </div>
  );
}
