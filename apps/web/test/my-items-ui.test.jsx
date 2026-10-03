import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import { MyItems } from '../features/shopping/my-items';
import { CustomerOrderDetail } from '../features/orders/order-detail';

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  api: vi.fn(),
  search: '',
  user: { id: 'b2ecb79a-b74a-4748-93dc-f2fc02b93b3d' },
  shopping: {},
}));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(mocks.search),
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('../features/auth/auth-provider', () => ({
  useAuth: () => ({ ...mocks, status: 'authenticated' }),
}));
vi.mock('../lib/api/client', () => ({ api: (...args) => mocks.api(...args) }));
vi.mock('../features/shopping/shopping-provider', () => ({
  useShopping: () => mocks.shopping,
}));
const id = 'da7a0000-0000-4000-8000-020000000001';
const orderId = '8ae0b1ba-2414-4d55-a0ad-7cc6ab8a4f96';
const number = 'MH-' + orderId;
const product = {
  id,
  slug: 'current-mug',
  name: 'Current mug',
  sku: 'CURRENT',
  price: '9007199254740993',
  compareAtPrice: null,
  currency: 'VND',
  sellingUnit: 'each',
  image: null,
  badges: [],
  availability: { status: 'IN_STOCK', canAddToCart: true },
};
const item = {
  productId: id,
  orderId,
  snapshot: {
    sku: 'OLD',
    productName: 'Historical mug',
    imageUrl: null,
    sellingUnit: 'box',
  },
  purchaseCount: 7,
  lastPurchasedAt: '2026-01-01T00:00:00.000Z',
  currentProduct: product,
  currentPrice: product.price,
  availability: 'IN_STOCK',
};
const order = {
  id: orderId,
  orderNumber: number,
  status: 'DELIVERED',
  placedAt: '2025-01-01T00:00:00.000Z',
  subtotal: product.price,
  shippingFee: '0',
  discountTotal: '0',
  total: product.price,
  paymentMethod: 'COD',
  address: {
    recipientName: 'Snapshot customer',
    phone: '0900000000',
    line1: 'Snapshot address',
    ward: 'Ward',
    district: 'District',
    province: 'Province',
  },
  customerNote: 'Stored note',
  items: [
    {
      productId: id,
      productName: 'Historical mug',
      quantity: 1,
      unitPrice: product.price,
      lineTotal: product.price,
    },
  ],
  statusHistory: [
    {
      toStatus: 'PENDING',
      reason: null,
      createdAt: '2025-01-01T00:00:00.000Z',
    },
    {
      toStatus: 'DELIVERED',
      reason: 'Delivered safely',
      createdAt: item.lastPurchasedAt,
    },
  ],
};
const response = (data, page = 1, totalPages = 1) => ({
  data,
  meta: { page, perPage: 20, totalItems: data.length ? 21 : 0, totalPages },
});
function mount(element = <MyItems />) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      {element}
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  mocks.search = '';
  mocks.request.mockReset();
  mocks.api.mockReset();
  mocks.api.mockResolvedValue({ data: { popularProducts: [] } });
  mocks.shopping = {
    wishlistReady: true,
    wishlist: { items: [] },
    wishlistContains: () => false,
    cartReady: true,
    cartPending: false,
    wishlistPending: false,
    addToCart: vi.fn(async () => {}),
    retryCart: vi.fn(async () => {}),
    retryWishlist: vi.fn(),
    removeFromWishlist: vi.fn(),
    addToWishlist: vi.fn(),
  };
  mocks.request.mockImplementation(async (path) =>
    path.startsWith('/users/me/items') ? response([item]) : { data: order },
  );
});

test('URL defaults, sort/page links, authoritative current card and historical provenance remain distinct', async () => {
  mocks.search = 'tab=unknown&sort=frequent&page=2';
  mocks.request.mockImplementation(async (path) =>
    path.startsWith('/users/me/items')
      ? response([item], 2, 3)
      : { data: order },
  );
  mount();
  expect(await screen.findByText('7 purchased')).toBeVisible();
  expect(screen.getByText('Purchased as: Historical mug')).toBeVisible();
  expect(screen.getByRole('link', { name: 'Current mug' })).toHaveAttribute(
    'href',
    '/products/current-mug',
  );
  expect(
    await screen.findByRole('link', { name: 'View purchase order' }),
  ).toHaveAttribute('href', '/account/orders/' + number);
  expect(screen.getByRole('link', { name: 'Reorder' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  expect(screen.getByRole('link', { name: 'Most recent' })).toHaveAttribute(
    'href',
    '/account/my-items?tab=reorder&sort=recent&page=1',
  );
  expect(screen.getByRole('link', { name: 'Next page' })).toHaveAttribute(
    'href',
    '/account/my-items?tab=reorder&sort=frequent&page=3',
  );
  expect(mocks.request).toHaveBeenCalledWith(
    '/users/me/items?page=2&sort=frequent',
    expect.anything(),
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Add Current mug to cart' }),
  );
  await waitFor(() =>
    expect(mocks.shopping.addToCart).toHaveBeenCalledWith(product, 1),
  );
});

test('loading, safe load error and explicit retry recover without leaking raw errors', async () => {
  mocks.request.mockReturnValueOnce(new Promise(() => {}));
  const first = mount();
  expect(screen.getByRole('status')).toHaveTextContent(
    'Loading your delivered purchases',
  );
  first.unmount();
  mocks.request.mockRejectedValueOnce(new Error('private provider detail'));
  mount();
  await screen.findByText('We could not load your delivered purchases.');
  expect(screen.queryByText('private provider detail')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByText('7 purchased')).toBeVisible();
});

test('empty purchases show honest popular fallback or browse when fallback fails', async () => {
  mocks.request.mockResolvedValue(response([]));
  mocks.api.mockResolvedValue({ data: { popularProducts: [product] } });
  const first = mount();
  expect(await screen.findByText('No delivered purchases yet')).toBeVisible();
  expect(
    await screen.findByRole('heading', { name: 'Popular products' }),
  ).toBeVisible();
  first.unmount();
  mocks.api.mockRejectedValue(new Error('offline'));
  mount();
  expect(
    await screen.findByRole('link', { name: 'Browse categories' }),
  ).toHaveAttribute('href', '/categories');
});

test('unavailable retains historical identity with no current link/price, out-of-stock is visible and disabled', async () => {
  mocks.request.mockImplementation(async (path) =>
    path.startsWith('/users/me/items')
      ? response([
          {
            ...item,
            currentProduct: null,
            currentPrice: null,
            availability: 'UNAVAILABLE',
          },
          {
            ...item,
            productId: 'da7a0000-0000-4000-8000-020000000002',
            snapshot: { ...item.snapshot, productName: 'Old plate' },
            currentProduct: {
              ...product,
              name: 'Current plate',
              availability: { status: 'OUT_OF_STOCK', canAddToCart: false },
            },
            availability: 'OUT_OF_STOCK',
          },
        ])
      : { data: order },
  );
  mount();
  expect(
    await screen.findByRole('heading', { name: 'Historical mug' }),
  ).toBeVisible();
  expect(screen.getByRole('button', { name: 'Add to cart' })).toBeDisabled();
  expect(
    screen.queryByRole('link', { name: 'Current mug' }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole('button', { name: 'Current plate is out of stock' }),
  ).toBeDisabled();
  expect(screen.getByText('Purchased as: Old plate')).toBeVisible();
});

test('wishlist tab does not fetch purchase history and maintains canonical links', async () => {
  mocks.search = 'tab=wishlist';
  mount();
  expect(
    screen.getByRole('heading', { name: 'Your wishlist is empty' }),
  ).toBeVisible();
  expect(mocks.request).not.toHaveBeenCalled();
  expect(screen.getByRole('link', { name: 'Wishlist' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  expect(screen.getByRole('link', { name: 'Reorder' })).toHaveAttribute(
    'href',
    '/account/my-items?tab=reorder',
  );
});

test('provenance read failure has retry and never creates a broken order link', async () => {
  mocks.request
    .mockImplementationOnce(async () => response([item]))
    .mockRejectedValueOnce(new Error('offline'));
  mount();
  await screen.findByText('Purchase link could not be loaded.');
  expect(
    screen.queryByRole('link', { name: 'View purchase order' }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Retry purchase link' }));
  expect(
    await screen.findByRole('link', { name: 'View purchase order' }),
  ).toHaveAttribute('href', '/account/orders/' + number);
});

test('detail renders owned snapshots/timeline and one pending whole-order command with partial outcomes', async () => {
  let complete;
  mocks.request.mockImplementation(async (path, options) =>
    options?.method === 'POST'
      ? new Promise((resolve) => {
          complete = resolve;
        })
      : { data: order },
  );
  mount(<CustomerOrderDetail orderNumber={number} />);
  expect(
    await screen.findByText('Snapshot address, Ward, District, Province'),
  ).toBeVisible();
  expect(screen.getByText('Historical mug')).toBeVisible();
  expect(screen.queryByText('Current mug')).not.toBeInTheDocument();
  expect(screen.getByText('Delivered safely')).toBeVisible();
  const submit = screen.getByRole('button', { name: 'Reorder this order' });
  fireEvent.click(submit);
  fireEvent.click(submit);
  expect(submit).toBeDisabled();
  await waitFor(() => expect(complete).toBeTypeOf('function'));
  complete({
    data: {
      added: [],
      skipped: [{ productId: id, reason: 'QUANTITY_LIMITED' }],
      cartId: null,
    },
  });
  expect(await screen.findByText(/Cart quantity limit reached/)).toBeVisible();
  expect(
    mocks.request.mock.calls.filter(
      ([, options]) => options?.method === 'POST',
    ),
  ).toHaveLength(1);
  expect(mocks.shopping.retryCart).toHaveBeenCalledOnce();
});

test('detail distinguishes concealed not-found from retryable load errors', async () => {
  mocks.request.mockRejectedValueOnce({ status: 404 });
  const first = mount(<CustomerOrderDetail orderNumber={number} />);
  expect(await screen.findByText('Order not found.')).toBeVisible();
  expect(
    screen.queryByRole('button', { name: 'Try again' }),
  ).not.toBeInTheDocument();
  first.unmount();
  mocks.request.mockRejectedValueOnce(new Error('offline'));
  mount(<CustomerOrderDetail orderNumber={number} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));
  expect(await screen.findByText('Status: DELIVERED')).toBeVisible();
});
