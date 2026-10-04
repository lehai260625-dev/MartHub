import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminOrderQueue } from '../features/admin/order-queue';
import { AdminOrderDetail } from '../features/admin/order-detail';
import { ApiClientError } from '../lib/api/core';

const navigation = vi.hoisted(() => ({
  search: '',
  push: vi.fn(),
  back: vi.fn(),
}));
const auth = vi.hoisted(() => ({
  request: vi.fn(),
  user: { id: 'b2ecb79a-b74a-4748-93dc-f2fc02b93b3d' },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: navigation.push, back: navigation.back }),
  useSearchParams: () => new URLSearchParams(navigation.search),
}));
vi.mock('../features/auth/auth-provider', () => ({ useAuth: () => auth }));

const orderId = '0e7b73b7-9db0-4ae0-80b5-08e4049162cf';
const actorId = '37578ca4-f54b-4d06-9d46-09e0907e5751';
const row = {
  id: orderId,
  orderNumber: 'MH-queue-order',
  status: 'PACKING',
  createdAt: '2026-10-01T01:00:00.000Z',
  subtotal: '18014398509481986',
  shippingFee: '30000',
  discountTotal: '0',
  total: '18014398509511986',
  currency: 'VND',
  paymentMethod: 'COD',
  itemCount: 2,
  customer: { userId: actorId, email: 'buyer@example.test' },
};
const list = (data = [row], meta = {}) => ({
  data,
  meta: {
    page: 1,
    perPage: 20,
    totalItems: data.length,
    totalPages: data.length ? 1 : 0,
    ...meta,
  },
});
const detail = {
  ...row,
  placedAt: '2026-10-01T01:00:00.000Z',
  address: {
    recipientName: 'Snapshot Recipient',
    phone: '0900000000',
    line1: 'Immutable address',
    line2: null,
    ward: 'Ward',
    district: 'District',
    province: 'Province',
    postalCode: null,
  },
  customerNote: 'Leave at reception',
  customer: {
    userId: actorId,
    email: 'buyer@example.test',
    firstName: 'Current',
    lastName: 'Customer',
    phone: null,
    status: 'ACTIVE',
  },
  items: [
    {
      id: 'dc8f3df4-3b6c-48fe-96c1-782b3c368dc0',
      productId: '7a2a0be5-dd10-4b22-bf87-fb3d47ea0eaa',
      sku: 'SNAPSHOT-SKU',
      productName: 'Immutable product name',
      imageUrl: null,
      sellingUnit: 'box',
      unitPrice: '9007199254740993',
      compareAtPrice: null,
      quantity: 2,
      lineTotal: '18014398509481986',
    },
  ],
  statusHistory: [
    {
      id: 'cb9ac56d-608c-439d-a6cf-d98a5a2831a5',
      status: 'PENDING',
      reason: null,
      createdAt: '2026-10-01T01:00:00.000Z',
      actorUserId: actorId,
    },
    {
      id: 'd850e160-7c8e-4378-a825-4e63f1592422',
      status: 'PACKING',
      reason: 'Preparing parcel',
      createdAt: '2026-10-02T01:00:00.000Z',
      actorUserId: null,
    },
  ],
};

function mount(component) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>{component}</QueryClientProvider>,
  );
}

beforeEach(() => {
  navigation.search = '';
  navigation.push.mockReset();
  navigation.back.mockReset();
  auth.request.mockReset();
});

describe('Admin order queue', () => {
  it('renders loading, empty, and error/retry states', async () => {
    let resolve;
    auth.request.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const view = mount(<AdminOrderQueue />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading orders');
    resolve(list([]));
    expect(
      await screen.findByText('No orders match these filters.'),
    ).toBeVisible();
    view.unmount();

    auth.request
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(list([]));
    mount(<AdminOrderQueue />);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'could not load',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(
      await screen.findByText('No orders match these filters.'),
    ).toBeVisible();
  });

  it('renders safe populated rows and canonical detail links', async () => {
    auth.request.mockResolvedValue(list());
    mount(<AdminOrderQueue />);
    expect(await screen.findAllByText('MH-queue-order')).not.toHaveLength(0);
    expect(screen.getAllByText('buyer@example.test')).not.toHaveLength(0);
    for (const link of screen.getAllByRole('link', { name: 'MH-queue-order' }))
      expect(link).toHaveAttribute('href', `/admin/orders/${orderId}`);
    expect(screen.queryByText('Immutable address')).not.toBeInTheDocument();
    expect(auth.request).toHaveBeenCalledWith(
      '/admin/orders',
      expect.objectContaining({ schema: expect.anything() }),
    );
  });

  it('restores URL state and resets page for search/filter/sort/page-size changes', async () => {
    navigation.search = 'q=buyer&status=PACKING&sort=oldest&page=2&perPage=50';
    auth.request.mockResolvedValue(
      list([row], { page: 2, perPage: 50, totalItems: 51, totalPages: 2 }),
    );
    mount(<AdminOrderQueue />);
    expect(await screen.findByDisplayValue('buyer')).toBeVisible();
    expect(screen.getByLabelText('Status')).toHaveValue('PACKING');
    expect(screen.getByLabelText('Sort')).toHaveValue('oldest');
    expect(screen.getByLabelText('Orders per page')).toHaveValue('50');
    await screen.findAllByText('MH-queue-order');
    expect(auth.request.mock.calls[0][0]).toBe(
      '/admin/orders?q=buyer&status=PACKING&sort=oldest&page=2&perPage=50',
    );
    expect(screen.getByRole('link', { name: 'Previous page' })).toHaveAttribute(
      'href',
      '/admin/orders?q=buyer&status=PACKING&sort=oldest&perPage=50',
    );

    fireEvent.change(screen.getByLabelText('Status'), {
      target: { value: 'DELIVERED' },
    });
    expect(navigation.push).toHaveBeenLastCalledWith(
      '/admin/orders?q=buyer&status=DELIVERED&sort=oldest&perPage=50',
    );
    fireEvent.change(screen.getByLabelText('Sort'), {
      target: { value: 'newest' },
    });
    expect(navigation.push).toHaveBeenLastCalledWith(
      '/admin/orders?q=buyer&status=PACKING&perPage=50',
    );
    fireEvent.change(screen.getByLabelText('Orders per page'), {
      target: { value: '20' },
    });
    expect(navigation.push).toHaveBeenLastCalledWith(
      '/admin/orders?q=buyer&status=PACKING&sort=oldest',
    );
    fireEvent.change(screen.getByLabelText('Search orders'), {
      target: { value: '  new query  ' },
    });
    fireEvent.submit(screen.getByRole('search'));
    expect(navigation.push).toHaveBeenLastCalledWith(
      '/admin/orders?q=new+query&status=PACKING&sort=oldest&perPage=50',
    );
  });

  it('shows a reset recovery for invalid or repeated URL options', () => {
    navigation.search = 'status=PENDING&status=DELIVERED';
    mount(<AdminOrderQueue />);
    expect(screen.getByRole('alert')).toHaveTextContent('filters are invalid');
    expect(screen.getByRole('link', { name: 'Reset filters' })).toHaveAttribute(
      'href',
      '/admin/orders',
    );
    expect(auth.request).not.toHaveBeenCalled();
  });
});

describe('Admin order detail', () => {
  it('renders immutable snapshots, exact totals, customer identity, and complete actor history', async () => {
    auth.request.mockResolvedValue({ data: detail });
    mount(<AdminOrderDetail orderId={orderId} />);
    expect(
      await screen.findByRole('heading', { name: 'Order detail' }),
    ).toBeVisible();
    expect(screen.getByText('Immutable product name')).toBeVisible();
    expect(
      screen.getByText('Immutable address, Ward, District, Province'),
    ).toBeVisible();
    expect(screen.getByText(/Preparing parcel/u)).toBeVisible();
    expect(
      screen.getByText(new RegExp(`Actor user ID: ${actorId}`, 'u')),
    ).toBeVisible();
    expect(screen.getByText(/Actor user ID: System/u)).toBeVisible();
    expect(screen.getAllByText(/₫/u).length).toBeGreaterThan(0);
    expect(auth.request).toHaveBeenCalledWith(
      `/admin/orders/${orderId}`,
      expect.objectContaining({ schema: expect.anything() }),
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Back to order queue' }),
    );
    expect(navigation.back).toHaveBeenCalledOnce();
    expect(
      screen.queryByRole('button', { name: /transition|cancel/i }),
    ).not.toBeInTheDocument();
  });

  it('covers loading, recoverable error, retry, and not-found states', async () => {
    let resolve;
    auth.request.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const view = mount(<AdminOrderDetail orderId={orderId} />);
    expect(screen.getByRole('status')).toHaveTextContent(
      'Loading order detail',
    );
    resolve({ data: detail });
    await screen.findByText('Immutable product name');
    view.unmount();

    auth.request
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ data: detail });
    const retryView = mount(<AdminOrderDetail orderId={orderId} />);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'could not load',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByText('Immutable product name');
    retryView.unmount();

    auth.request.mockRejectedValue(
      new ApiClientError('Missing', { status: 404 }),
    );
    mount(<AdminOrderDetail orderId={orderId} />);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Order not found',
    );
    expect(
      screen.queryByRole('button', { name: 'Try again' }),
    ).not.toBeInTheDocument();
  });
});
