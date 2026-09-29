'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  adminCategoryCreateSchema,
  adminCategoryListResponseSchema,
  adminCategoryResponseSchema,
} from '@marthub/contracts';
import { useAuth } from '../auth/auth-provider';

function formValues(category) {
  return {
    name: category?.name ?? '',
    slug: category?.slug ?? '',
    description: category?.description ?? '',
    parentId: category?.parentId ?? null,
    sortOrder: category?.sortOrder ?? 0,
  };
}

export function CategoryManager() {
  const auth = useAuth();
  const [editing, setEditing] = useState(null);
  const [confirmArchiveId, setConfirmArchiveId] = useState(null);
  const [actionId, setActionId] = useState(null);
  const [actionMessage, setActionMessage] = useState('');
  const categories = useQuery({
    queryKey: ['admin-categories', auth.user.id],
    queryFn: () =>
      auth.request('/admin/categories', {
        schema: adminCategoryListResponseSchema,
      }),
  });

  const archive = async (category) => {
    setActionMessage('');
    setActionId(category.id);
    try {
      await auth.request('/admin/categories/' + category.id + '/archive', {
        method: 'POST',
        schema: adminCategoryResponseSchema,
      });
      setConfirmArchiveId(null);
      if (editing?.id === category.id) setEditing(null);
      setActionMessage(category.name + ' was archived.');
      await categories.refetch();
    } catch (error) {
      setActionMessage(error.message || 'The category could not be archived.');
    } finally {
      setActionId(null);
    }
  };

  if (categories.isPending)
    return <p role="status">Loading category management…</p>;

  if (categories.isError)
    return (
      <div
        role="alert"
        className="rounded-lg border border-red-200 bg-red-50 p-5"
      >
        <p>We could not load categories.</p>
        <button
          className="button-secondary mt-4"
          onClick={() => categories.refetch()}
        >
          Try again
        </button>
      </div>
    );

  const rows = categories.data.data;
  const roots = rows.filter(
    (category) =>
      category.parentId === null &&
      category.status === 'ACTIVE' &&
      category.id !== editing?.id,
  );

  return (
    <div className="mt-8 grid items-start gap-8 xl:grid-cols-[minmax(0,1.5fr)_minmax(20rem,0.8fr)]">
      <section aria-labelledby="category-list-title" className="min-w-0">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="category-list-title" className="text-xl font-semibold">
              Category tree
            </h2>
            <p className="mt-2 text-sm text-neutral-600">
              Lower order values appear first. Categories support two levels.
            </p>
          </div>
          <button
            className="button-secondary"
            disabled={Boolean(actionId)}
            onClick={() => setEditing(null)}
          >
            New category
          </button>
        </div>

        {rows.length === 0 ? (
          <div className="mt-4 rounded-lg border border-dashed border-neutral-300 bg-white p-6">
            <p className="font-medium">No categories yet.</p>
            <p className="mt-2 text-neutral-600">
              Create a top-level category to begin the catalog tree.
            </p>
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto rounded-lg border border-neutral-300 bg-white">
            <table className="w-full min-w-[52rem] border-collapse text-left text-sm">
              <caption className="sr-only">
                Categories, hierarchy, order, status, and actions
              </caption>
              <thead className="bg-neutral-100">
                <tr>
                  {[
                    'Category',
                    'Parent',
                    'Status',
                    'Order',
                    'Usage',
                    'Actions',
                  ].map((heading) => (
                    <th
                      key={heading}
                      scope="col"
                      className="border-b border-neutral-300 px-4 py-3 font-semibold"
                    >
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((category) => (
                  <tr key={category.id} className="align-top">
                    <th
                      scope="row"
                      className="border-b border-neutral-200 px-4 py-4 font-semibold"
                    >
                      <span className="block">{category.name}</span>
                      <span className="mt-1 block font-normal text-neutral-600">
                        /{category.slug}
                      </span>
                    </th>
                    <td className="border-b border-neutral-200 px-4 py-4">
                      {category.parent?.name ?? 'Top level'}
                    </td>
                    <td className="border-b border-neutral-200 px-4 py-4">
                      <span
                        className={
                          category.status === 'ACTIVE'
                            ? 'font-semibold text-emerald-800'
                            : 'font-semibold text-neutral-600'
                        }
                      >
                        {category.status === 'ACTIVE' ? 'Active' : 'Archived'}
                      </span>
                    </td>
                    <td className="border-b border-neutral-200 px-4 py-4 tabular-nums">
                      {category.sortOrder}
                    </td>
                    <td className="border-b border-neutral-200 px-4 py-4">
                      {category.childCount} children, {category.productCount}{' '}
                      products
                    </td>
                    <td className="border-b border-neutral-200 px-4 py-4">
                      <div className="flex flex-wrap items-center gap-3">
                        <button
                          className="inline-flex min-h-11 items-center font-semibold text-emerald-800 underline-offset-4 hover:underline"
                          disabled={Boolean(actionId)}
                          onClick={() => {
                            setEditing(category);
                            setConfirmArchiveId(null);
                            setActionMessage('');
                          }}
                        >
                          Edit {category.name}
                        </button>
                        {category.status === 'ACTIVE' &&
                          (confirmArchiveId === category.id ? (
                            <>
                              <span>Archive {category.name}?</span>
                              <button
                                className="inline-flex min-h-11 items-center font-semibold text-red-800 underline-offset-4 hover:underline"
                                disabled={Boolean(actionId)}
                                onClick={() => archive(category)}
                              >
                                Confirm archive
                              </button>
                              <button
                                className="inline-flex min-h-11 items-center font-semibold text-neutral-700 underline-offset-4 hover:underline"
                                disabled={Boolean(actionId)}
                                onClick={() => setConfirmArchiveId(null)}
                              >
                                Cancel
                              </button>
                            </>
                          ) : (
                            <button
                              className="inline-flex min-h-11 items-center font-semibold text-red-800 underline-offset-4 hover:underline"
                              disabled={Boolean(actionId)}
                              onClick={() => setConfirmArchiveId(category.id)}
                            >
                              Archive {category.name}
                            </button>
                          ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p aria-live="polite" className="mt-4 min-h-6 text-neutral-700">
          {actionMessage}
        </p>
      </section>

      <CategoryForm
        key={editing?.id ?? 'new'}
        category={editing}
        roots={roots}
        auth={auth}
        onCancel={() => setEditing(null)}
        onSaved={async (message) => {
          setEditing(null);
          setActionMessage(message);
          await categories.refetch();
        }}
      />
    </div>
  );
}

function CategoryForm({ category, roots, auth, onCancel, onSaved }) {
  const [submitError, setSubmitError] = useState('');
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(adminCategoryCreateSchema),
    defaultValues: formValues(category),
  });

  const submit = async (values) => {
    setSubmitError('');
    const fields = {
      name: values.name,
      description: values.description || null,
      parentId: values.parentId,
      sortOrder: values.sortOrder,
      ...(category ? {} : { slug: values.slug }),
    };
    try {
      await auth.request(
        category ? '/admin/categories/' + category.id : '/admin/categories',
        {
          method: category ? 'PATCH' : 'POST',
          body: fields,
          schema: adminCategoryResponseSchema,
        },
      );
      await onSaved(
        category
          ? values.name + ' was updated.'
          : values.name + ' was created.',
      );
    } catch (error) {
      setSubmitError(error.message || 'The category could not be saved.');
    }
  };

  return (
    <section
      className="rounded-lg border border-neutral-300 bg-white p-5 sm:p-6"
      aria-labelledby="category-form-title"
    >
      <h2 id="category-form-title" className="text-xl font-semibold">
        {category ? 'Edit ' + category.name : 'Create category'}
      </h2>
      <form
        className="mt-5 space-y-4"
        onSubmit={handleSubmit(submit)}
        noValidate
      >
        <Field
          label="Category name"
          name="name"
          register={register}
          error={errors.name}
          maxLength={120}
        />
        <Field
          label="URL slug"
          name="slug"
          register={register}
          error={errors.slug}
          maxLength={160}
          readOnly={Boolean(category)}
          help={
            category
              ? 'Public slugs stay fixed after creation.'
              : 'Use lowercase letters, numbers, and hyphens.'
          }
        />
        <div>
          <label className="block font-medium" htmlFor="category-description">
            Description
          </label>
          <textarea
            {...register('description')}
            id="category-description"
            rows={4}
            maxLength={1000}
            className="mt-2 w-full rounded-md border border-neutral-400 px-3 py-2"
          />
          {errors.description && (
            <p role="alert" className="mt-2 text-sm text-red-800">
              {errors.description.message}
            </p>
          )}
        </div>
        <div>
          <label className="block font-medium" htmlFor="category-parent">
            Parent category
          </label>
          <select
            {...register('parentId', {
              setValueAs: (value) => value || null,
            })}
            id="category-parent"
            className="form-input mt-2"
          >
            <option value="">Top level</option>
            {roots.map((root) => (
              <option key={root.id} value={root.id}>
                {root.name}
              </option>
            ))}
          </select>
          {errors.parentId && (
            <p role="alert" className="mt-2 text-sm text-red-800">
              {errors.parentId.message}
            </p>
          )}
        </div>
        <Field
          label="Display order"
          name="sortOrder"
          type="number"
          min={0}
          max={1000000}
          register={register}
          registerOptions={{ valueAsNumber: true }}
          error={errors.sortOrder}
        />

        <div aria-live="polite" className="min-h-6">
          {submitError && (
            <p role="alert" className="text-red-800">
              {submitError}
            </p>
          )}
        </div>
        <div className="flex flex-col gap-3 sm:flex-row">
          <button className="button-primary" disabled={isSubmitting}>
            {isSubmitting
              ? 'Saving…'
              : category
                ? 'Save category'
                : 'Create category'}
          </button>
          {category && (
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

function Field({
  label,
  name,
  register,
  registerOptions,
  error,
  help,
  ...input
}) {
  const errorId = 'category-' + name + '-error';
  const helpId = 'category-' + name + '-help';
  return (
    <div>
      <label className="block font-medium" htmlFor={'category-' + name}>
        {label}
      </label>
      <input
        {...input}
        {...register(name, registerOptions)}
        id={'category-' + name}
        className="form-input mt-2"
        aria-invalid={Boolean(error)}
        aria-describedby={
          [error ? errorId : null, help ? helpId : null]
            .filter(Boolean)
            .join(' ') || undefined
        }
      />
      {help && (
        <p id={helpId} className="mt-2 text-sm text-neutral-600">
          {help}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="mt-2 text-sm text-red-800">
          {error.message}
        </p>
      )}
    </div>
  );
}
