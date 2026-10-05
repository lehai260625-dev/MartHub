import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  render,
  screen,
  within,
  fireEvent,
  waitFor,
} from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  myItemsResponseSchema,
  recommendationsResponseSchema,
} from '@marthub/contracts';
import {
  selectProductModules,
  selectEditorial,
} from '../features/homepage/homepage-modules';
import { ProductModules } from '../features/homepage/product-modules';
import { HomepageContent } from '../features/homepage/homepage';
import { api } from '../lib/api/client';
import { selectPromotions } from '../features/homepage/homepage-model';

const state = vi.hoisted(() => ({ auth: { status: 'guest', user: null } }));
vi.mock('../features/auth/auth-provider', () => ({
  useAuth: () => state.auth,
}));
vi.mock('../features/shopping/shopping-actions', () => ({
  WishlistButton: () => <button aria-label="Save product">Save</button>,
  AddToCartButton: ({ product }) => (
    <button disabled={!product.availability.canAddToCart}>Add to cart</button>
  ),
}));
const id = (n) => `da7a0000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const product = (n, available = true) => ({
  id: id(n),
  name: `Product ${n}`,
  slug: `product-${n}`,
  sku: `SKU-${n}`,
  shortDescription: null,
  image: null,
  price: '9007199254740993',
  compareAtPrice: null,
  currency: 'VND',
  sellingUnit: 'each',
  badges: [],
  availability: {
    status: available ? 'IN_STOCK' : 'OUT_OF_STOCK',
    canAddToCart: available,
  },
});
const data = (overrides = {}) => ({
  deals: [],
  newProducts: [],
  popularProducts: [],
  promotions: [],
  categories: [],
  ...overrides,
});
const item = (n, availability = 'IN_STOCK') => ({
  productId: id(n),
  currentProduct:
    availability === 'UNAVAILABLE'
      ? null
      : product(n, availability === 'IN_STOCK'),
  currentPrice: availability === 'UNAVAILABLE' ? null : '9007199254740993',
  availability,
  purchaseCount: 2,
  lastPurchasedAt: '2026-10-05T00:00:00.000Z',
  orderId: id(900),
  snapshot: {
    sku: 'OLD',
    productName: 'Historical identity',
    imageUrl: null,
    sellingUnit: 'each',
  },
});
const itemsResponse = (items) => ({
  data: items,
  meta: {
    page: 1,
    perPage: 20,
    totalItems: items.length,
    totalPages: items.length ? 1 : 0,
  },
});
function mount(publicData) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const view = render(
    <QueryClientProvider client={client}>
      <ProductModules data={publicData} />
    </QueryClientProvider>,
  );
  return { ...view, client };
}
afterEach(() => {
  state.auth = { status: 'guest', user: null };
  vi.unstubAllGlobals();
});

describe('bounded authoritative homepage modules', () => {
  it('caps every product module at eight without fetching to fill or altering source order', () => {
    const products = (start) =>
      Array.from({ length: 12 }, (_, i) => product(start + i));
    const modules = selectProductModules(
      data({
        deals: products(1),
        newProducts: products(101),
        popularProducts: products(201),
      }),
      Array.from({ length: 20 }, (_, i) => item(301 + i)),
      { label: 'PERSONALIZED', products: products(401) },
    );
    expect(modules.map((section) => section.products.length)).toEqual([
      8, 8, 8, 8, 8,
    ]);
    expect(modules[1].products.map((p) => p.id)).toEqual(
      Array.from({ length: 8 }, (_, i) => id(301 + i)),
    );
  });
  it('a failed purchases read keeps successful recommendations and public modules available', async () => {
    state.auth = {
      status: 'authenticated',
      user: { id: id(99), role: 'CUSTOMER' },
      request: vi.fn(async (url) => {
        if (url.includes('/items?'))
          throw new Error('private failure must not render');
        return { data: { label: 'PERSONALIZED', products: [product(77)] } };
      }),
    };
    mount(data({ deals: [product(1)] }));
    await screen.findByRole('button', { name: 'Thử lại: Mua lại' });
    await screen.findByRole('heading', { name: 'Gợi ý cho bạn' });
    expect(screen.getByRole('heading', { name: 'Deals' })).toBeVisible();
    expect(
      screen.queryByText('private failure must not render'),
    ).not.toBeInTheDocument();
  });
  it('deduplicates with exact priority/order, caps visible cards and never mutates inputs', () => {
    const source = data({
      deals: Array.from({ length: 12 }, (_, i) => product(i + 1)),
      newProducts: [product(3), product(20), product(30)],
      popularProducts: [product(1), product(40)],
    });
    const before = JSON.stringify(source);
    const modules = selectProductModules(source, [item(2), item(20)], {
      label: 'PERSONALIZED',
      products: [product(20), product(25)],
    });
    expect(modules.map((m) => m.id)).toEqual([
      'deals',
      'repurchase',
      'recommendations',
      'new',
      'popular',
    ]);
    expect(modules.map((m) => m.products.map((p) => p.id))).toEqual([
      Array.from({ length: 8 }, (_, i) => id(i + 1)),
      [id(20)],
      [id(25)],
      [id(30)],
      [id(40)],
    ]);
    expect(JSON.stringify(source)).toBe(before);
    expect(modules[0].href).toBeUndefined();
    expect(modules[1].href).toBe('/account/my-items?tab=reorder');
    expect(modules[2].href).toBeUndefined();
    expect(modules[3].href).toBe('/search?sort=newest');
    expect(modules[4].href).toBe('/search?sort=popular');
  });
  it('filters unavailable historical purchases and uses current cards, not snapshots', () => {
    const repurchase = selectProductModules(data(), [
      item(1, 'UNAVAILABLE'),
      item(2, 'OUT_OF_STOCK'),
      item(3),
    ])[1];
    expect(repurchase.products).toEqual([product(3)]);
    expect(repurchase.products[0].name).not.toBe('Historical identity');
  });
  it.each([0, 1, 2])(
    'excludes mosaic promotions and caps remaining editorial at two (%i)',
    (count) => {
      const promo = (n, placement) => ({
        id: id(n),
        placement,
        title: `Story ${n}`,
        subtitle: null,
        image: null,
        internalHref: '/categories',
      });
      const rows = [
        promo(1, 'HERO_PRIMARY'),
        promo(2, 'HERO_SECONDARY'),
        promo(3, 'EDITORIAL'),
        ...Array.from({ length: count }, (_, i) => promo(4 + i, 'EDITORIAL')),
      ];
      const mosaic = selectPromotions(rows);
      expect(selectEditorial(rows, mosaic).map((p) => p.id)).toEqual(
        Array.from({ length: count }, (_, i) => id(4 + i)),
      );
      if (count === 2)
        expect(
          selectEditorial([...rows, promo(9, 'EDITORIAL')], mosaic),
        ).toHaveLength(2);
    },
  );
  it.each(['guest', 'loading', 'error', 'ADMIN'])(
    'keeps public modules usable without private reads for %s',
    async (status) => {
      const request = vi.fn();
      state.auth = {
        status: status === 'ADMIN' ? 'authenticated' : status,
        user: status === 'ADMIN' ? { id: id(999), role: 'ADMIN' } : null,
        request,
      };
      mount(
        data({
          deals: [product(1)],
          popularProducts: [product(2)],
          newProducts: [product(3)],
        }),
      );
      expect(
        screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent),
      ).toEqual(['Deals', 'Sản phẩm phổ biến', 'Sản phẩm mới']);
      expect(screen.queryByText('Mua lại')).not.toBeInTheDocument();
      expect(screen.queryByText('Gợi ý cho bạn')).not.toBeInTheDocument();
      expect(request).not.toHaveBeenCalled();
    },
  );
  it('omits all empty and dedup-emptied sections; preserves current out-of-stock public cards and exact VND', () => {
    const view = mount(data());
    expect(view.container.querySelector('section')).toBeNull();
    view.unmount();
    mount(
      data({ deals: [product(1, false)], newProducts: [product(1, false)] }),
    );
    expect(screen.getAllByRole('article')).toHaveLength(1);
    expect(screen.getByText('Out of stock')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Add to cart' })).toBeDisabled();
    expect(screen.getByText(/9\.007\.199\.254\.740\.993/)).toBeVisible();
  });
  it.each(['PERSONALIZED', 'POPULAR'])(
    'renders Customer sections separately and honors %s label, strict clients and bounded reads',
    async (label) => {
      const responses = {
        items: itemsResponse([
          item(1, 'UNAVAILABLE'),
          item(2, 'OUT_OF_STOCK'),
          item(3),
        ]),
        recommendations: { data: { label, products: [product(4)] } },
      };
      expect(myItemsResponseSchema.safeParse(responses.items).success).toBe(
        true,
      );
      expect(
        recommendationsResponseSchema.safeParse(responses.recommendations)
          .success,
      ).toBe(true);
      const fetch = vi.fn(async (url) =>
        Response.json(
          url.includes('/items?') ? responses.items : responses.recommendations,
        ),
      );
      vi.stubGlobal('fetch', fetch);
      state.auth = {
        status: 'authenticated',
        user: { id: id(99), role: 'CUSTOMER' },
        request: api,
      };
      mount(
        data({
          deals: [product(10)],
          newProducts: [product(3), product(20)],
          popularProducts: [product(4), product(30)],
        }),
      );
      await screen.findByRole('heading', { name: 'Mua lại' });
      await screen.findByRole('heading', {
        name: label === 'PERSONALIZED' ? 'Gợi ý cho bạn' : 'Sản phẩm phổ biến',
      });
      await waitFor(() =>
        expect(screen.getAllByRole('article')).toHaveLength(5),
      );
      expect(fetch.mock.calls.map(([url]) => url)).toEqual([
        '/api/v1/users/me/items?page=1&sort=recent',
        '/api/v1/users/me/recommendations',
      ]);
      expect(screen.queryByText('Historical identity')).not.toBeInTheDocument();
      expect(
        screen.getByRole('link', { name: 'Xem tất cả: Mua lại' }),
      ).toHaveAttribute('href', '/account/my-items?tab=reorder');
      expect(
        within(screen.getByRole('region', { name: 'Deals' })).queryByText(
          'Xem tất cả',
        ),
      ).not.toBeInTheDocument();
    },
  );
  it('private loading/errors stay isolated, schema failure is safe, retry does not invent a popular fallback', async () => {
    let release;
    let fail = true;
    const fetch = vi.fn(async (url) => {
      if (url.includes('/items?')) return Response.json(itemsResponse([]));
      if (fail)
        return new Promise((resolve) => {
          release = () => resolve(Response.json({ secret: 'not exposed' }));
        });
      return Response.json({
        data: { label: 'POPULAR', products: [product(4)] },
      });
    });
    vi.stubGlobal('fetch', fetch);
    state.auth = {
      status: 'authenticated',
      user: { id: id(99), role: 'CUSTOMER' },
      request: api,
    };
    mount(data({ deals: [product(1)], newProducts: [product(2)] }));
    expect(screen.getByRole('heading', { name: 'Deals' })).toBeVisible();
    expect(screen.getAllByRole('status').length).toBeGreaterThan(0);
    await waitFor(() => expect(release).toBeTypeOf('function'));
    release();
    await screen.findByRole('alert');
    expect(screen.queryByText('not exposed')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Sản phẩm phổ biến' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Mua lại' }),
    ).not.toBeInTheDocument();
    fail = false;
    fireEvent.click(
      screen.getByRole('button', { name: 'Thử lại: Gợi ý sản phẩm' }),
    );
    await screen.findByRole('heading', { name: 'Sản phẩm phổ biến' });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
  it('private cache never leaks into non-Customer public state', async () => {
    state.auth = {
      status: 'authenticated',
      user: { id: id(99), role: 'CUSTOMER' },
      request: vi.fn(async (url) =>
        url.includes('/items?')
          ? itemsResponse([item(77)])
          : { data: { label: 'PERSONALIZED', products: [product(78)] } },
      ),
    };
    const view = mount(data());
    await screen.findByText('Product 77');
    state.auth = { status: 'guest', user: null };
    view.rerender(
      <QueryClientProvider client={view.client}>
        <ProductModules data={data()} />
      </QueryClientProvider>,
    );
    expect(screen.queryByText('Product 77')).not.toBeInTheDocument();
    expect(screen.queryByText('Product 78')).not.toBeInTheDocument();
  });
  it('editorial renders after product content with safe individual CTAs and no seasonal fabrication', () => {
    const promotions = Array.from({ length: 6 }, (_, i) => ({
      id: id(i),
      placement:
        i === 0 ? 'HERO_PRIMARY' : i < 3 ? 'HERO_SECONDARY' : 'EDITORIAL',
      title: `Story ${i}`,
      subtitle: null,
      image: null,
      internalHref: i === 4 ? '/admin' : '/categories',
    }));
    const client = new QueryClient();
    const view = render(
      <QueryClientProvider client={client}>
        <HomepageContent data={data({ promotions })}>
          <div>Product modules marker</div>
        </HomepageContent>
      </QueryClientProvider>,
    );
    expect(
      view.container.querySelectorAll('.home-editorial article'),
    ).toHaveLength(2);
    expect(screen.queryByText('Story 5')).not.toBeInTheDocument();
    expect(screen.queryByText('Seasonal')).not.toBeInTheDocument();
    expect(
      within(view.container.querySelector('.home-editorial')).getAllByRole(
        'link',
      ),
    ).toHaveLength(1);
    expect(
      view.container.querySelector('.home-editorial').previousSibling,
    ).toHaveTextContent('Product modules marker');
  });
});
