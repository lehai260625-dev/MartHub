'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  myItemsResponseSchema,
  recommendationsResponseSchema,
} from '@marthub/contracts';
import { useAuth } from '../auth/auth-provider';
import { ProductCard } from '../catalog/product-card';
import { selectProductModules } from './homepage-modules';

function PrivateState({ query, title, id }) {
  return (
    <section
      className="home-products home-private-state"
      aria-labelledby={`home-${id}`}
      aria-busy={query.isFetching}
    >
      <h2 id={`home-${id}`}>{title}</h2>
      {query.isPending ? (
        <p role="status">Đang tải…</p>
      ) : (
        <div role="alert">
          <p>Không tải được nội dung này.</p>
          <button
            className="home-action"
            disabled={query.isFetching}
            onClick={() => query.refetch()}
          >
            Thử lại: {title}
          </button>
        </div>
      )}
    </section>
  );
}

export function ProductModules({ data }) {
  const auth = useAuth();
  const customer =
    auth.status === 'authenticated' && auth.user.role === 'CUSTOMER';
  const purchases = useQuery({
    queryKey: ['homepage-purchases', auth.user?.id],
    enabled: customer,
    queryFn: ({ signal }) =>
      auth.request('/users/me/items?page=1&sort=recent', {
        signal,
        schema: myItemsResponseSchema,
      }),
    retry: false,
  });
  const recommendations = useQuery({
    queryKey: ['homepage-recommendations', auth.user?.id],
    enabled: customer,
    queryFn: ({ signal }) =>
      auth.request('/users/me/recommendations', {
        signal,
        schema: recommendationsResponseSchema,
      }),
    retry: false,
  });
  const modules = selectProductModules(
    data,
    customer && purchases.isSuccess ? purchases.data.data : [],
    customer
      ? recommendations.isSuccess
        ? recommendations.data.data
        : null
      : { label: 'POPULAR', products: data.popularProducts },
  );
  return modules.map((module) => {
    const query =
      module.id === 'repurchase'
        ? purchases
        : module.id === 'recommendations'
          ? recommendations
          : null;
    if (customer && query && !query.isSuccess)
      return (
        <PrivateState
          key={module.id}
          id={module.id}
          query={query}
          title={module.id === 'repurchase' ? 'Mua lại' : 'Gợi ý sản phẩm'}
        />
      );
    if (!module.products.length) return null;
    return (
      <section
        key={module.id}
        className={`home-products home-products-${module.id}`}
        aria-labelledby={`home-${module.id}`}
      >
        <div className="home-section-heading">
          <h2 id={`home-${module.id}`}>{module.title}</h2>
          {module.href ? (
            <Link
              prefetch={false}
              href={module.href}
              aria-label={`Xem tất cả: ${module.title}`}
            >
              Xem tất cả
            </Link>
          ) : null}
        </div>
        <ul className="home-product-grid">
          {module.products.map((product) => (
            <li key={product.id}>
              <ProductCard
                product={product}
                headingLevel={3}
                prefetch={false}
              />
            </li>
          ))}
        </ul>
      </section>
    );
  });
}
