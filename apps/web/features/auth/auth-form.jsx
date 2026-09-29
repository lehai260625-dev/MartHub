'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { loginSchema, registerSchema } from '@marthub/contracts';
import { useAuth } from './auth-provider';
import { AuthState } from './auth-state';
import { safeReturnTo } from '../../lib/auth/return-to';

export function AuthForm({ mode = 'login' }) {
  const creating = mode === 'register';
  const auth = useAuth();
  const router = useRouter();
  const returnTo = safeReturnTo(useSearchParams().get('returnTo'));
  const [submitError, setSubmitError] = useState('');
  const {
    register,
    handleSubmit,
    resetField,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(creating ? registerSchema : loginSchema),
    defaultValues: creating
      ? { firstName: '', lastName: '', email: '', password: '' }
      : { email: '', password: '' },
  });
  useEffect(() => {
    if (auth.status === 'authenticated') router.replace(returnTo);
  }, [auth.status, returnTo, router]);
  const submit = handleSubmit(async (values) => {
    setSubmitError('');
    try {
      await (creating ? auth.register(values) : auth.signIn(values));
    } catch (error) {
      if (error.name !== 'AbortError')
        setSubmitError(
          error.code === 'INVALID_CREDENTIALS'
            ? 'Email or password is incorrect.'
            : error.code === 'EMAIL_IN_USE'
              ? 'An account already uses this email. Sign in instead.'
              : error.code === 'RATE_LIMITED'
                ? 'Too many attempts. Please wait before trying again.'
                : 'We could not complete your request. Please try again.',
        );
      resetField('password');
    }
  });
  const fields = [
    ...(creating
      ? [
          {
            name: 'firstName',
            label: 'First name',
            autoComplete: 'given-name',
            maxLength: 80,
          },
          {
            name: 'lastName',
            label: 'Last name',
            autoComplete: 'family-name',
            maxLength: 80,
          },
        ]
      : []),
    {
      name: 'email',
      label: 'Email',
      type: 'email',
      autoComplete: 'email',
      maxLength: 254,
    },
    {
      name: 'password',
      label: 'Password',
      type: 'password',
      autoComplete: creating ? 'new-password' : 'current-password',
      maxLength: 128,
    },
  ];
  return (
    <>
      <h1 className="text-3xl font-semibold">
        {creating ? 'Create your account' : 'Sign in'}
      </h1>
      <p className="mt-3 text-neutral-600">
        {creating
          ? 'Your everyday shopping starts with a MartHub account.'
          : 'Welcome back to MartHub.'}
      </p>
      {(auth.status === 'loading' || auth.status === 'error') && (
        <div className="mt-6">
          <AuthState />
        </div>
      )}
      <form
        className="mt-8 space-y-5"
        onSubmit={submit}
        noValidate
        aria-busy={isSubmitting}
      >
        {submitError && (
          <p role="alert" className="text-red-800">
            {submitError}
          </p>
        )}
        {fields.map(({ name, label, ...input }) => (
          <div key={name}>
            <label className="mb-2 block font-medium" htmlFor={name}>
              {label}
            </label>
            <input
              {...input}
              {...register(name)}
              id={name}
              required
              className="form-input"
              aria-invalid={Boolean(errors[name])}
              aria-describedby={
                [
                  errors[name] ? name + '-error' : null,
                  name === 'password' && creating ? 'password-help' : null,
                ]
                  .filter(Boolean)
                  .join(' ') || undefined
              }
              disabled={isSubmitting}
            />
            {name === 'password' && creating && (
              <p id="password-help" className="mt-2 text-sm text-neutral-600">
                Use 15–128 characters. Spaces are allowed.
              </p>
            )}
            {errors[name] && (
              <p
                id={name + '-error'}
                role="alert"
                className="mt-2 text-sm text-red-800"
              >
                {errors[name].message}
              </p>
            )}
          </div>
        ))}
        <button
          type="submit"
          className="button-primary w-full"
          disabled={
            isSubmitting ||
            auth.status === 'loading' ||
            auth.status === 'authenticated'
          }
        >
          {isSubmitting
            ? 'Please wait…'
            : creating
              ? 'Create account'
              : 'Sign in'}
        </button>
      </form>
      <p className="mt-6 text-center">
        <Link
          className="inline-flex min-h-11 items-center text-emerald-800 underline underline-offset-4"
          href={
            (creating ? '/login' : '/register') +
            '?returnTo=' +
            encodeURIComponent(returnTo)
          }
        >
          {creating ? 'Sign in instead' : 'Create an account'}
        </Link>
      </p>
    </>
  );
}
