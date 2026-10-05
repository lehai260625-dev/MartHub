'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  homepageResponseSchema,
  categoryResponseSchema,
  productResponseSchema,
} from '@marthub/contracts';
import { api } from '../../lib/api/client';
import { promotionDestination, selectPromotions } from './homepage-model';
import { ProductModules } from './product-modules';
import { selectEditorial } from './homepage-modules';

export function HomeMedia({ image, primary = false }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="home-media">
      {image && !failed ? (
        // Existing server-controlled promotion/category media; reserve the box before loading.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={image.url}
          alt=""
          onError={() => setFailed(true)}
          loading={primary ? 'eager' : 'lazy'}
        />
      ) : (
        <span className="home-media-fallback" aria-hidden="true">
          MH
        </span>
      )}
    </div>
  );
}

function PromotionAction({ promotion }) {
  const destination = promotionDestination(promotion.internalHref);
  const target = useQuery({
    queryKey: [
      'homepage-destination',
      destination?.resource,
      destination?.slug,
    ],
    enabled: Boolean(destination?.resource),
    queryFn: () =>
      api(`/${destination.resource}/${destination.slug}`, {
        schema:
          destination.resource === 'categories'
            ? categoryResponseSchema
            : productResponseSchema,
      }),
    staleTime: 0,
    retry: false,
  });
  // During verification/failure retain copy, never expose an unverified dynamic link.
  if (
    !destination ||
    (destination.resource && (!target.isSuccess || target.isFetching))
  )
    return null;
  return (
    <Link
      prefetch={false}
      className="home-action"
      href={destination.href}
      aria-label={`Xem ngay: ${promotion.title}`}
    >
      Xem ngay
    </Link>
  );
}

export function HomepageContent({ data, children }) {
  const tiles = selectPromotions(data.promotions);
  const editorial = selectEditorial(data.promotions, tiles);
  const categories = data.categories.slice(0, 8);
  return (
    <>
      {tiles.length ? (
        <section
          aria-label="Khám phá nổi bật"
          className={`home-mosaic home-mosaic-${tiles.length}`}
        >
          {tiles.map((promotion, index) => (
            <article
              className={`home-promo ${index === 0 ? 'home-primary' : 'home-secondary'}`}
              key={promotion.id}
            >
              <HomeMedia
                key={promotion.image?.url || 'missing'}
                image={promotion.image}
                primary={index === 0}
              />
              <div className="home-promo-copy">
                <h2 className="home-clamp">{promotion.title}</h2>
                {promotion.subtitle ? (
                  <p className="home-clamp">{promotion.subtitle}</p>
                ) : null}
                <div className="home-promo-actions">
                  <PromotionAction promotion={promotion} />
                </div>
              </div>
            </article>
          ))}
        </section>
      ) : (
        <Welcome />
      )}
      <section
        className="home-categories"
        aria-labelledby="home-category-title"
      >
        <div className="home-section-heading">
          <h2 id="home-category-title">Danh mục</h2>
          {categories.length ? (
            <Link prefetch={false} href="/categories">
              Xem tất cả danh mục
            </Link>
          ) : null}
        </div>
        {categories.length ? (
          <ul className="home-category-grid">
            {categories.map((category) => (
              <li key={category.id}>
                <Link
                  prefetch={false}
                  className="home-category"
                  href={`/category/${category.slug}`}
                >
                  <HomeMedia
                    key={category.image?.url || 'missing'}
                    image={category.image}
                  />
                  <span className="home-clamp">{category.name}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="home-category-empty">Danh mục đang được cập nhật.</p>
        )}
      </section>
      {children}
      {editorial.length ? (
        <div className="home-editorial">
          {editorial.map((promotion) => (
            <article className="home-promo" key={promotion.id}>
              <HomeMedia
                key={promotion.image?.url || 'missing'}
                image={promotion.image}
              />
              <div className="home-promo-copy">
                <h2 className="home-clamp">{promotion.title}</h2>
                {promotion.subtitle ? (
                  <p className="home-clamp">{promotion.subtitle}</p>
                ) : null}
                <div className="home-promo-actions">
                  <PromotionAction promotion={promotion} />
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : null}
    </>
  );
}

function Welcome() {
  return (
    <section className="home-welcome" aria-labelledby="home-welcome-title">
      <h2 id="home-welcome-title">Khám phá MartHub</h2>
      <p>Tìm sản phẩm phù hợp với bạn.</p>
      <Link prefetch={false} href="/search" className="home-action">
        Tìm sản phẩm
      </Link>
    </section>
  );
}

export function Homepage() {
  const query = useQuery({
    queryKey: ['public-homepage'],
    queryFn: () => api('/homepage', { schema: homepageResponseSchema }),
    staleTime: 0,
  });
  if (query.isPending)
    return (
      <div aria-busy="true" className="home-loading">
        <p role="status">Đang tải MartHub…</p>
        <div className="home-loading-media" aria-hidden="true" />
      </div>
    );
  if (query.isError)
    return (
      <>
        <div className="home-error" role="alert">
          <p>Không tải được nội dung MartHub.</p>
          <button
            className="home-action"
            disabled={query.isFetching}
            onClick={() => query.refetch()}
          >
            Thử lại
          </button>
        </div>
        <Welcome />
      </>
    );
  return (
    <HomepageContent data={query.data.data}>
      <ProductModules data={query.data.data} />
    </HomepageContent>
  );
}
