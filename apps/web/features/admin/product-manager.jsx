'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  adminCategoryListResponseSchema,
  adminProductCreateSchema,
  adminProductListResponseSchema,
  adminProductResponseSchema,
} from '@marthub/contracts';
import { useAuth } from '../auth/auth-provider';
import { formatVnd } from '../catalog/catalog-query';
import { ProductImageManager } from './product-image-manager';
import { ProductPriceManager } from './product-price-manager';
import { ProductInventoryManager } from './product-inventory-manager';

function productValues(product, categories) {
  return {
    categoryId: product?.categoryId ?? categories[0]?.id ?? '',
    sku: product?.sku ?? '',
    slug: product?.slug ?? '',
    name: product?.name ?? '',
    shortDescription: product?.shortDescription ?? '',
    description: product?.description ?? '',
    brand: product?.brand ?? '',
    sellingUnit: product?.sellingUnit ?? 'each',
    isFeatured: product?.isFeatured ?? false,
    isNew: product?.isNew ?? false,
    isPopular: product?.isPopular ?? false,
    price: product?.price ?? '',
    compareAtPrice: product?.compareAtPrice ?? null,
  };
}

function queryPath(filters, page) {
  const params = new URLSearchParams({ page: String(page), perPage: '24' });
  if (filters.q) params.set('q', filters.q);
  if (filters.status) params.set('status', filters.status);
  return '/admin/products?' + params.toString();
}

export function ProductManager() {
  const auth = useAuth();
  const [editing, setEditing] = useState(null);
  const [confirmArchiveId, setConfirmArchiveId] = useState(null);
  const [actionId, setActionId] = useState(null);
  const [actionMessage, setActionMessage] = useState('');
  const [draftQuery, setDraftQuery] = useState('');
  const [draftStatus, setDraftStatus] = useState('');
  const [filters, setFilters] = useState({ q: '', status: '' });
  const [page, setPage] = useState(1);

  const categories = useQuery({
    queryKey: ['admin-categories', auth.user.id],
    queryFn: () =>
      auth.request('/admin/categories', {
        schema: adminCategoryListResponseSchema,
      }),
  });
  const products = useQuery({
    queryKey: ['admin-products', auth.user.id, filters, page],
    queryFn: () =>
      auth.request(queryPath(filters, page), {
        schema: adminProductListResponseSchema,
      }),
  });

  const runAction = async (product, command) => {
    setActionMessage('');
    setActionId(product.id);
    try {
      const result = await auth.request(
        '/admin/products/' + product.id + '/' + command,
        {
          method: 'POST',
          schema: adminProductResponseSchema,
        },
      );
      setConfirmArchiveId(null);
      if (command === 'archive' && editing?.id === product.id) setEditing(null);
      setActionMessage(
        result.data.name +
          (command === 'publish' ? ' was published.' : ' was archived.'),
      );
      await products.refetch();
    } catch (error) {
      setActionMessage(
        error.message || 'The product status could not be changed.',
      );
    } finally {
      setActionId(null);
    }
  };

  if (categories.isPending || products.isPending)
    return <p role="status">Loading product management...</p>;
  if (categories.isError || products.isError)
    return (
      <div
        role="alert"
        className="rounded-lg border border-red-200 bg-red-50 p-5"
      >
        <p>We could not load product management.</p>
        <button
          className="button-secondary mt-4"
          onClick={() => {
            categories.refetch();
            products.refetch();
          }}
        >
          Try again
        </button>
      </div>
    );

  const activeCategories = categories.data.data.filter(
    (category) => category.status === 'ACTIVE',
  );
  const rows = products.data.data;
  const meta = products.data.meta;

  return (
    <div className="mt-8 grid items-start gap-8 xl:grid-cols-[minmax(0,1.55fr)_minmax(21rem,0.85fr)]">
      <section aria-labelledby="product-list-title" className="min-w-0">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="product-list-title" className="text-xl font-semibold">
              Products
            </h2>
            <p className="mt-2 text-sm text-neutral-600">
              Draft products stay private until explicitly published.
            </p>
          </div>
          <button
            className="button-secondary"
            disabled={Boolean(actionId)}
            onClick={() => setEditing(null)}
          >
            New product
          </button>
        </div>
        <form
          aria-label="Filter products"
          className="mt-4 grid gap-3 rounded-lg border border-neutral-300 bg-white p-4 sm:grid-cols-[minmax(0,1fr)_12rem_auto]"
          onSubmit={(event) => {
            event.preventDefault();
            setPage(1);
            setFilters({ q: draftQuery.trim(), status: draftStatus });
          }}
        >
          <div>
            <label
              className="block text-sm font-medium"
              htmlFor="product-search"
            >
              Search
            </label>
            <input
              id="product-search"
              className="form-input mt-2"
              value={draftQuery}
              onChange={(event) => setDraftQuery(event.target.value)}
              maxLength={80}
              placeholder="Name, SKU, or slug"
            />
          </div>
          <div>
            <label
              className="block text-sm font-medium"
              htmlFor="product-status-filter"
            >
              Status
            </label>
            <select
              id="product-status-filter"
              className="form-input mt-2"
              value={draftStatus}
              onChange={(event) => setDraftStatus(event.target.value)}
            >
              <option value="">All statuses</option>
              <option value="DRAFT">Draft</option>
              <option value="ACTIVE">Active</option>
              <option value="ARCHIVED">Archived</option>
            </select>
          </div>
          <button className="button-secondary self-end">Apply filters</button>
        </form>

        {rows.length === 0 ? (
          <div className="mt-4 rounded-lg border border-dashed border-neutral-300 bg-white p-6">
            <p className="font-medium">No products found.</p>
            <p className="mt-2 text-neutral-600">
              Create a product or change the current filters.
            </p>
          </div>
        ) : (
          <div
            aria-label="Product results table"
            className="mt-4 overflow-x-auto rounded-lg border border-neutral-300 bg-white"
            tabIndex={0}
          >
            <table className="w-full min-w-[58rem] border-collapse text-left text-sm">
              <caption className="sr-only">
                Products, categories, prices, stock, status, and actions
              </caption>
              <thead className="bg-neutral-100">
                <tr>
                  {[
                    'Product',
                    'Category',
                    'Price',
                    'Stock',
                    'Status',
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
                {rows.map((product) => (
                  <tr key={product.id} className="align-top">
                    <th
                      scope="row"
                      className="border-b border-neutral-200 px-4 py-4 font-semibold"
                    >
                      <span className="block">{product.name}</span>
                      <span className="mt-1 block font-normal text-neutral-600">
                        {product.sku}
                      </span>
                    </th>
                    <td className="border-b border-neutral-200 px-4 py-4">
                      {product.category.name}
                    </td>
                    <td className="border-b border-neutral-200 px-4 py-4 tabular-nums">
                      {formatVnd(product.price)}
                    </td>
                    <td className="border-b border-neutral-200 px-4 py-4 tabular-nums">
                      {product.quantityOnHand}
                    </td>
                    <td className="border-b border-neutral-200 px-4 py-4 font-semibold">
                      {product.status === 'ACTIVE'
                        ? 'Active'
                        : product.status === 'DRAFT'
                          ? 'Draft'
                          : 'Archived'}
                    </td>
                    <td className="border-b border-neutral-200 px-4 py-4">
                      <div className="flex flex-wrap items-center gap-3">
                        {product.status !== 'ARCHIVED' && (
                          <button
                            className="inline-flex min-h-11 items-center font-semibold text-emerald-800 underline-offset-4 hover:underline"
                            disabled={Boolean(actionId)}
                            onClick={() => {
                              setEditing(product);
                              setConfirmArchiveId(null);
                              setActionMessage('');
                            }}
                          >
                            Edit {product.name}
                          </button>
                        )}
                        {product.status === 'DRAFT' && (
                          <button
                            className="inline-flex min-h-11 items-center font-semibold text-emerald-800 underline-offset-4 hover:underline"
                            disabled={Boolean(actionId)}
                            onClick={() => runAction(product, 'publish')}
                          >
                            {actionId === product.id
                              ? 'Working...'
                              : 'Publish ' + product.name}
                          </button>
                        )}
                        {product.status !== 'ARCHIVED' &&
                          (confirmArchiveId === product.id ? (
                            <>
                              <span>Archive {product.name}?</span>
                              <button
                                className="inline-flex min-h-11 items-center font-semibold text-red-800 underline-offset-4 hover:underline"
                                disabled={Boolean(actionId)}
                                onClick={() => runAction(product, 'archive')}
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
                              onClick={() => setConfirmArchiveId(product.id)}
                            >
                              Archive {product.name}
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
        {meta.totalPages > 1 && (
          <nav
            aria-label="Product pages"
            className="mt-4 flex items-center gap-4"
          >
            <button
              className="button-secondary"
              disabled={page <= 1}
              onClick={() => setPage((value) => value - 1)}
            >
              Previous
            </button>
            <span>
              Page {page} of {meta.totalPages}
            </span>
            <button
              className="button-secondary"
              disabled={page >= meta.totalPages}
              onClick={() => setPage((value) => value + 1)}
            >
              Next
            </button>
          </nav>
        )}
        <p aria-live="polite" className="mt-4 min-h-6 text-neutral-700">
          {actionMessage}
        </p>
      </section>
      {activeCategories.length === 0 ? (
        <section
          role="alert"
          className="rounded-lg border border-amber-300 bg-amber-50 p-5"
        >
          <h2 className="text-xl font-semibold">
            An active category is required
          </h2>
          <p className="mt-2">
            Create or activate a category before creating products.
          </p>
        </section>
      ) : (
        <ProductForm
          key={editing?.id ?? 'new'}
          product={editing}
          categories={activeCategories}
          auth={auth}
          onCancel={() => setEditing(null)}
          onImagesChanged={async (message) => {
            const refreshed = await products.refetch();
            const updated = refreshed.data?.data.find(
              ({ id }) => id === editing?.id,
            );
            if (updated) setEditing(updated);
            setActionMessage(message);
          }}
          onSaved={async (message) => {
            setEditing(null);
            setActionMessage(message);
            await products.refetch();
          }}
        />
      )}
    </div>
  );
}

function ProductForm({
  product,
  categories,
  auth,
  onCancel,
  onImagesChanged,
  onSaved,
}) {
  const [submitError, setSubmitError] = useState('');
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(adminProductCreateSchema),
    defaultValues: productValues(product, categories),
  });
  const submit = async (values) => {
    setSubmitError('');
    const common = {
      categoryId: values.categoryId,
      name: values.name,
      shortDescription: values.shortDescription || null,
      description: values.description || null,
      brand: values.brand || null,
      sellingUnit: values.sellingUnit,
      isFeatured: values.isFeatured,
      isNew: values.isNew,
      isPopular: values.isPopular,
    };
    const body = product
      ? common
      : {
          ...common,
          sku: values.sku,
          slug: values.slug,
          price: values.price,
          compareAtPrice: values.compareAtPrice || null,
        };
    try {
      await auth.request(
        product ? '/admin/products/' + product.id : '/admin/products',
        {
          method: product ? 'PATCH' : 'POST',
          body,
          schema: adminProductResponseSchema,
        },
      );
      await onSaved(
        values.name + (product ? ' was updated.' : ' was created as a draft.'),
      );
    } catch (error) {
      setSubmitError(error.message || 'The product could not be saved.');
    }
  };

  return (
    <section
      className="min-w-0 rounded-lg border border-neutral-300 bg-white p-5 sm:p-6"
      aria-labelledby="product-form-title"
    >
      <h2 id="product-form-title" className="text-xl font-semibold">
        {product ? 'Edit ' + product.name : 'Create product'}
      </h2>
      <form
        className="mt-5 space-y-4"
        onSubmit={handleSubmit(submit)}
        noValidate
      >
        <Field
          label="Product name"
          name="name"
          register={register}
          error={errors.name}
          maxLength={180}
        />
        <Field
          label="SKU"
          name="sku"
          register={register}
          error={errors.sku}
          maxLength={80}
          readOnly={Boolean(product)}
          help="Use a stable uppercase business identifier."
        />
        <Field
          label="URL slug"
          name="slug"
          register={register}
          error={errors.slug}
          maxLength={160}
          readOnly={Boolean(product)}
          help="Use lowercase letters, numbers, and hyphens."
        />
        <div>
          <label className="block font-medium" htmlFor="product-category">
            Category
          </label>
          <select
            {...register('categoryId')}
            id="product-category"
            className="form-input mt-2"
          >
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
          {errors.categoryId && (
            <p role="alert" className="mt-2 text-sm text-red-800">
              {errors.categoryId.message}
            </p>
          )}
        </div>
        <Field
          label="Selling unit"
          name="sellingUnit"
          register={register}
          error={errors.sellingUnit}
          maxLength={80}
        />
        <Field
          label="Price (VND)"
          name="price"
          register={register}
          error={errors.price}
          inputMode="numeric"
          readOnly={Boolean(product)}
          help={
            product
              ? 'Price changes are managed separately and keep history.'
              : 'Enter a whole VND amount greater than zero.'
          }
        />
        <Field
          label="Compare price (VND)"
          name="compareAtPrice"
          register={register}
          registerOptions={{ setValueAs: (value) => value || null }}
          error={errors.compareAtPrice}
          inputMode="numeric"
          readOnly={Boolean(product)}
        />
        <Field
          label="Brand"
          name="brand"
          register={register}
          error={errors.brand}
          maxLength={120}
        />
        <Field
          label="Short description"
          name="shortDescription"
          register={register}
          error={errors.shortDescription}
          maxLength={300}
        />
        <div>
          <label className="block font-medium" htmlFor="product-description">
            Description
          </label>
          <textarea
            {...register('description')}
            id="product-description"
            rows={5}
            maxLength={5000}
            className="mt-2 w-full rounded-md border border-neutral-400 px-3 py-2"
          />
          {errors.description && (
            <p role="alert" className="mt-2 text-sm text-red-800">
              {errors.description.message}
            </p>
          )}
        </div>
        <fieldset>
          <legend className="font-medium">Merchandising</legend>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            {[
              ['isFeatured', 'Featured'],
              ['isNew', 'New'],
              ['isPopular', 'Popular'],
            ].map(([name, label]) => (
              <label key={name} className="flex min-h-11 items-center gap-3">
                <input type="checkbox" {...register(name)} /> {label}
              </label>
            ))}
          </div>
        </fieldset>
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
              ? 'Saving...'
              : product
                ? 'Save product'
                : 'Create draft'}
          </button>
          {product && (
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
      {product && (
        <ProductPriceManager
          product={product}
          auth={auth}
          onChanged={onImagesChanged}
        />
      )}
      {product && (
        <ProductInventoryManager
          product={product}
          auth={auth}
          onChanged={onImagesChanged}
        />
      )}
      {product && (
        <ProductImageManager
          product={product}
          auth={auth}
          onChanged={onImagesChanged}
        />
      )}
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
  const errorId = 'product-' + name + '-error';
  const helpId = 'product-' + name + '-help';
  return (
    <div>
      <label className="block font-medium" htmlFor={'product-' + name}>
        {label}
      </label>
      <input
        {...input}
        {...register(name, registerOptions)}
        id={'product-' + name}
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
