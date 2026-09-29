'use client';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { profileFormSchema, profileResponseSchema } from '@marthub/contracts';
import { useAuth } from '../auth/auth-provider';

const valuesFrom = (user) => ({
  firstName: user?.firstName ?? '',
  lastName: user?.lastName ?? '',
  phone: user?.phone ?? '',
});

export function ProfileForm() {
  const auth = useAuth();
  const queryClient = useQueryClient();
  const queryKey = ['profile', auth.user.id];
  const [submitError, setSubmitError] = useState('');
  const [saved, setSaved] = useState(false);
  const profile = useQuery({
    queryKey,
    queryFn: () => auth.request('/users/me', { schema: profileResponseSchema }),
  });
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(profileFormSchema),
    defaultValues: valuesFrom(auth.user),
  });
  useEffect(() => {
    if (profile.data) reset(valuesFrom(profile.data.data));
  }, [profile.data, reset]);
  const update = useMutation({
    mutationFn: (body) =>
      auth.request('/users/me', {
        method: 'PATCH',
        body,
        schema: profileResponseSchema,
      }),
  });
  const submit = async (values) => {
    setSubmitError('');
    setSaved(false);
    try {
      const response = await update.mutateAsync({
        firstName: values.firstName,
        lastName: values.lastName,
        phone: values.phone || null,
      });
      queryClient.setQueryData(queryKey, response);
      auth.updateUser(response.data);
      reset(valuesFrom(response.data));
      setSaved(true);
    } catch (error) {
      setSubmitError(error.message || 'Your profile could not be updated.');
    }
  };

  if (profile.isPending) return <p role="status">Loading your profile…</p>;
  if (profile.isError)
    return (
      <div
        role="alert"
        className="rounded-2xl border border-red-200 bg-red-50 p-5"
      >
        <p>We could not load your profile.</p>
        <button
          className="button-secondary mt-4"
          onClick={() => profile.refetch()}
        >
          Try again
        </button>
      </div>
    );

  return (
    <form
      className="mt-8 max-w-2xl space-y-6"
      onSubmit={handleSubmit(submit)}
      noValidate
    >
      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          label="First name"
          name="firstName"
          error={errors.firstName}
          register={register}
        />
        <Field
          label="Last name"
          name="lastName"
          error={errors.lastName}
          register={register}
        />
      </div>
      <Field
        label="Phone number"
        name="phone"
        type="tel"
        autoComplete="tel"
        hint="Optional. Digits, spaces, parentheses, + and - are accepted."
        error={errors.phone}
        register={register}
      />
      <div aria-live="polite" className="min-h-6">
        {saved && <p className="text-emerald-800">Profile saved.</p>}
        {submitError && <p className="text-red-700">{submitError}</p>}
      </div>
      <button
        className="button-primary w-full sm:w-auto"
        disabled={update.isPending}
      >
        {update.isPending ? 'Saving…' : 'Save profile'}
      </button>
    </form>
  );
}

function Field({
  label,
  name,
  register,
  error,
  hint,
  type = 'text',
  autoComplete = name,
}) {
  const messageId = `${name}-message`;
  return (
    <div>
      <label className="block font-medium" htmlFor={name}>
        {label}
      </label>
      <input
        {...register(name)}
        id={name}
        type={type}
        autoComplete={autoComplete}
        aria-invalid={Boolean(error)}
        aria-describedby={error || hint ? messageId : undefined}
        className="mt-2 min-h-11 w-full rounded-xl border border-neutral-300 bg-white px-3 focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-700/30"
      />
      {(error || hint) && (
        <p
          id={messageId}
          className={`mt-2 text-sm ${error ? 'text-red-700' : 'text-neutral-600'}`}
        >
          {error?.message || hint}
        </p>
      )}
    </div>
  );
}
