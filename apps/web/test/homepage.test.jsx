import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  Homepage,
  HomepageContent,
  HomeMedia,
} from '../features/homepage/homepage';
import {
  selectPromotions,
  promotionDestination,
} from '../features/homepage/homepage-model';
import { homepageResponseSchema } from '@marthub/contracts';

vi.mock('../features/auth/auth-provider', () => ({
  useAuth: () => ({ status: 'guest', user: null }),
}));

const promo = (
  id,
  placement = 'HERO_PRIMARY',
  internalHref = '/search?q=mug',
) => ({
  id,
  placement,
  title: `Story ${id}`,
  subtitle: 'Original supporting copy',
  image: null,
  internalHref,
});
const category = (id) => ({
  id,
  name: `Category ${id}`,
  slug: `category-${id}`,
  description: null,
  image: null,
  children: [{ id: 'child', name: 'Child not rendered', slug: 'child' }],
});
const content = (promotions = [], categories = []) => ({
  promotions,
  categories,
  deals: [],
  newProducts: [],
  popularProducts: [],
});
function mount(child) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>{child}</QueryClientProvider>,
  );
}
afterEach(() => vi.unstubAllGlobals());

describe('authoritative homepage presentation selection', () => {
  it('uses exact primary/secondary order and ignores surplus without mutation', () => {
    const rows = [
      promo('p1'),
      promo('p2'),
      promo('s1', 'HERO_SECONDARY'),
      promo('s2', 'HERO_SECONDARY'),
      promo('s3', 'HERO_SECONDARY'),
      promo('e1', 'EDITORIAL'),
    ];
    const before = JSON.stringify(rows);
    expect(selectPromotions(rows).map((p) => p.id)).toEqual(['p1', 's1', 's2']);
    expect(JSON.stringify(rows)).toBe(before);
  });
  it('promotes secondary, then editorial and fills secondary slots deterministically', () => {
    expect(
      selectPromotions([
        promo('s1', 'HERO_SECONDARY'),
        promo('s2', 'HERO_SECONDARY'),
        promo('e1', 'EDITORIAL'),
        promo('e2', 'EDITORIAL'),
      ]).map((p) => p.id),
    ).toEqual(['s1', 's2', 'e1']);
    expect(
      selectPromotions([
        promo('e1', 'EDITORIAL'),
        promo('e2', 'EDITORIAL'),
      ]).map((p) => p.id),
    ).toEqual(['e1', 'e2']);
    expect(
      selectPromotions([promo('p'), promo('e1', 'EDITORIAL')]).map((p) => p.id),
    ).toEqual(['p', 'e1']);
    expect(selectPromotions([])).toEqual([]);
  });
  it.each([1, 2, 3])(
    'renders %i supplied stories with no decorative empty slot',
    (count) => {
      mount(
        <HomepageContent
          data={content(
            [
              promo('p'),
              promo('s1', 'HERO_SECONDARY'),
              promo('s2', 'HERO_SECONDARY'),
            ].slice(0, count),
          )}
        />,
      );
      expect(screen.getAllByRole('article')).toHaveLength(count);
      expect(screen.getAllByRole('link', { name: /Xem ngay:/ })).toHaveLength(
        count,
      );
    },
  );
  it('uses at most eight parent categories in response order and browse-all', () => {
    mount(
      <HomepageContent
        data={content(
          [],
          Array.from({ length: 10 }, (_, i) => category(i)),
        )}
      />,
    );
    const section = screen.getByRole('region', { name: 'Danh mục' });
    expect(within(section).getAllByRole('listitem')).toHaveLength(8);
    expect(
      within(section)
        .getAllByRole('link')
        .map((a) => a.getAttribute('href')),
    ).toEqual([
      '/categories',
      ...Array.from({ length: 8 }, (_, i) => `/category/category-${i}`),
    ]);
    expect(screen.queryByText('Child not rendered')).not.toBeInTheDocument();
  });
  it('recovers both-empty with approved welcome/search and category message', () => {
    mount(<HomepageContent data={content()} />);
    expect(screen.getByText('Khám phá MartHub')).toBeInTheDocument();
    expect(
      screen.getByText('Tìm sản phẩm phù hợp với bạn.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Tìm sản phẩm' })).toHaveAttribute(
      'href',
      '/search',
    );
    expect(
      screen.getByText('Danh mục đang được cập nhật.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
  });
  it('missing/broken media uses original decorative MH, not broken img', () => {
    const { container } = mount(
      <HomeMedia image={{ url: '/broken.png', altText: 'Story' }} />,
    );
    fireEvent.error(container.querySelector('img'));
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('MH')).toHaveAttribute('aria-hidden', 'true');
  });
  it.each([
    '/admin/orders',
    '/account/profile',
    '/cart',
    '/login',
    '/unknown',
    'https://example.com',
    '//example.com',
    '/category/../admin',
    '/products/%2e%2e',
    '/search?q=mug&q=pen',
    '/search?deals=true',
    '/search?__proto__=ignored',
    '/categories?q=mug',
    '/products/mug?featured=true',
    '/category/home?category=desk',
    '/search#x',
  ])('rejects unsafe/unsupported destination %s', (href) => {
    expect(promotionDestination(href)).toBeNull();
  });
  it.each([
    '/',
    '/categories',
    '/search',
    '/search?q=mug&featured=true',
    '/category/home?sort=price-asc',
    '/products/mug',
  ])('accepts real route contract %s', (href) => {
    expect(promotionDestination(href)?.href).toBe(href);
  });
  it('preserves content but hides invalid/unavailable dynamic CTA', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json(
          { error: { code: 'NOT_FOUND', message: 'Unavailable' } },
          { status: 404 },
        ),
      ),
    );
    mount(
      <HomepageContent
        data={content([
          promo('p', 'HERO_PRIMARY', '/admin'),
          promo('s', 'HERO_SECONDARY', '/products/missing'),
        ])}
      />,
    );
    await screen.findByText('Story s');
    expect(screen.getAllByRole('article')).toHaveLength(2);
    expect(
      screen.queryByRole('link', { name: /Xem ngay/ }),
    ).not.toBeInTheDocument();
  });
  it('verifies a public category before exposing the exact supported query CTA', async () => {
    const fetch = vi.fn(async () =>
      Response.json({
        data: {
          ...category(1),
          id: 'da7a0000-0000-4000-8000-010000000001',
          children: [],
          parent: null,
        },
      }),
    );
    vi.stubGlobal('fetch', fetch);
    mount(
      <HomepageContent
        data={content([
          promo('p', 'HERO_PRIMARY', '/category/home?featured=true'),
        ])}
      />,
    );
    expect(
      await screen.findByRole('link', { name: 'Xem ngay: Story p' }),
    ).toHaveAttribute('href', '/category/home?featured=true');
    expect(fetch.mock.calls[0][0]).toBe('/api/v1/categories/home');
  });
  it('verifies a public product with the existing strict detail schema', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          data: {
            id: 'da7a0000-0000-4000-8000-020000000001',
            slug: 'mug',
            sku: 'M93',
            name: 'Original mug',
            shortDescription: null,
            image: null,
            price: '149000',
            compareAtPrice: null,
            currency: 'VND',
            sellingUnit: 'each',
            badges: [],
            availability: { status: 'IN_STOCK', canAddToCart: true },
            description: null,
            brand: null,
            category: {
              id: 'da7a0000-0000-4000-8000-010000000001',
              name: 'Home',
              slug: 'home',
            },
            images: [],
          },
        }),
      ),
    );
    mount(
      <HomepageContent
        data={content([promo('p', 'HERO_PRIMARY', '/products/mug')])}
      />,
    );
    expect(
      await screen.findByRole('link', { name: 'Xem ngay: Story p' }),
    ).toHaveAttribute('href', '/products/mug');
  });
  it('loading, safe failure, retry and schema parsing use the existing public client', async () => {
    let release;
    const fetch = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = resolve;
          }),
      )
      .mockResolvedValueOnce(Response.json({ data: content() }));
    vi.stubGlobal('fetch', fetch);
    mount(<Homepage />);
    expect(screen.getByRole('status')).toHaveTextContent('Đang tải');
    release(Response.json({ private: 'secret' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Không tải');
    expect(screen.queryByText('secret')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    await screen.findByText('Danh mục đang được cập nhật.');
    expect(fetch.mock.calls[0][0]).toBe('/api/v1/homepage');
    expect(homepageResponseSchema.safeParse({ data: content() }).success).toBe(
      true,
    );
  });
});
