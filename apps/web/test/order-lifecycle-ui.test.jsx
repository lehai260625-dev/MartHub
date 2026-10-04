import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import { CustomerOrderHistory } from '../features/orders/order-history';
import { CustomerOrderDetail } from '../features/orders/order-detail';
import { OrderCancellation } from '../features/orders/order-cancellation';

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  push: vi.fn(),
  search: '',
}));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(mocks.search),
  useRouter: () => ({ push: mocks.push }),
}));
vi.mock('../features/auth/auth-provider', () => ({
  useAuth: () => ({ user: { id: 'customer' }, request: mocks.request }),
}));
vi.mock('../features/shopping/shopping-provider', () => ({
  useShopping: () => ({ retryCart: vi.fn(), cartPending: false }),
}));
const order = {
  id: 'order-id',
  orderNumber: 'MH-test',
  status: 'PENDING',
  createdAt: '2026-01-01T00:00:00.000Z',
  placedAt: '2026-01-01T00:00:00.000Z',
  total: '9007199254740993',
  subtotal: '9007199254740993',
  shippingFee: '0',
  discountTotal: '0',
  currency: 'VND',
  paymentMethod: 'COD',
  itemCount: 1,
  address: {
    recipientName: 'Historical recipient',
    phone: '0900000000',
    line1: 'Stored address',
    ward: 'Ward',
    district: 'District',
    province: 'Province',
  },
  items: [],
  customerNote: null,
  statusHistory: [
    {
      toStatus: 'PENDING',
      createdAt: '2026-01-01T00:00:00.000Z',
      reason: null,
    },
  ],
};
const list = (data = [order]) => ({
  data,
  meta: {
    page: 1,
    perPage: 20,
    totalItems: data.length,
    totalPages: data.length ? 2 : 0,
  },
});
function mount(element) {
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
  mocks.push.mockReset();
});

test('history loading, safe summary, exact money and default URL pagination', async () => {
  let resolve;
  mocks.request.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  mount(<CustomerOrderHistory />);
  expect(screen.getByRole('status')).toHaveTextContent('Loading your orders');
  resolve(list());
  expect(
    await screen.findByRole('link', { name: order.orderNumber }),
  ).toHaveAttribute('href', '/account/orders/MH-test');
  expect(mocks.request.mock.calls[0][0]).toBe(
    '/orders?page=1&perPage=20&sort=newest',
  );
  expect(
    screen.getByText(/9[.,]007[.,]199[.,]254[.,]740[.,]993/),
  ).toBeVisible();
  expect(screen.queryByText('Stored address')).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Next page' })).toHaveAttribute(
    'href',
    '/account/orders?page=2&perPage=20&sort=newest',
  );
});
test('URL restores filter/sort/page/size and changing filters resets page', async () => {
  mocks.search = 'page=2&perPage=50&status=CONFIRMED&sort=oldest';
  mocks.request.mockResolvedValue({
    ...list(),
    meta: { page: 2, perPage: 50, totalItems: 101, totalPages: 3 },
  });
  mount(<CustomerOrderHistory />);
  await screen.findByText(/Page 2 of 3/);
  expect(screen.getByLabelText('Order status')).toHaveValue('CONFIRMED');
  expect(screen.getByLabelText('Order sort')).toHaveValue('oldest');
  expect(screen.getByRole('link', { name: 'Previous page' })).toHaveAttribute(
    'href',
    '/account/orders?page=1&perPage=50&status=CONFIRMED&sort=oldest',
  );
  fireEvent.change(screen.getByLabelText('Order status'), {
    target: { value: 'DELIVERED' },
  });
  expect(mocks.push).toHaveBeenLastCalledWith(
    '/account/orders?page=1&perPage=50&status=DELIVERED&sort=oldest',
  );
  fireEvent.change(screen.getByLabelText('Order sort'), {
    target: { value: 'newest' },
  });
  expect(mocks.push).toHaveBeenLastCalledWith(
    '/account/orders?page=1&perPage=50&status=CONFIRMED&sort=newest',
  );
  fireEvent.change(screen.getByLabelText('Orders per page'), {
    target: { value: '20' },
  });
  expect(mocks.push).toHaveBeenLastCalledWith(
    '/account/orders?page=1&perPage=20&status=CONFIRMED&sort=oldest',
  );
});
test('history error retries to empty state', async () => {
  mocks.request
    .mockRejectedValueOnce(new Error('network'))
    .mockResolvedValueOnce(list([]));
  mount(<CustomerOrderHistory />);
  await screen.findByText('We could not load your orders.');
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(
    await screen.findByText('No orders match these filters.'),
  ).toBeVisible();
});
test('invalid query never requests an unsupported limit', () => {
  mocks.search = 'perPage=51';
  mount(<CustomerOrderHistory />);
  expect(screen.getByRole('alert')).toHaveTextContent('Invalid order filters');
  expect(mocks.request).not.toHaveBeenCalled();
});
test('repeated query parameters are rejected without requesting', () => {
  mocks.search = 'page=1&page=2';
  mount(<CustomerOrderHistory />);
  expect(screen.getByRole('alert')).toHaveTextContent('Invalid order filters');
  expect(mocks.request).not.toHaveBeenCalled();
});
for (const status of [
  'PENDING',
  'CONFIRMED',
  'PACKING',
  'SHIPPING',
  'DELIVERED',
  'CANCELLED',
])
  test(`cancellation visibility for ${status}`, () => {
    mount(<OrderCancellation order={{ ...order, status }} refresh={vi.fn()} />);
    expect(
      screen.queryByRole('button', { name: 'Cancel order' }) !== null,
    ).toBe(['PENDING', 'CONFIRMED'].includes(status));
  });
test('reason validation, normalization, confirmation and duplicate-submit guard', async () => {
  let resolve;
  mocks.request.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const refresh = vi.fn(async () => ({}));
  mount(<OrderCancellation order={order} refresh={refresh} />);
  fireEvent.click(screen.getByRole('button', { name: 'Cancel order' }));
  fireEvent.change(screen.getByLabelText('Cancellation reason (optional)'), {
    target: { value: 'x'.repeat(241) },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Confirm cancellation' }));
  expect(screen.getByRole('alert')).toHaveTextContent('240');
  expect(mocks.request).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Cancellation reason (optional)'), {
    target: { value: '  ' + 'x'.repeat(240) + '  ' },
  });
  const form = screen
    .getByRole('button', { name: 'Confirm cancellation' })
    .closest('form');
  fireEvent.submit(form);
  fireEvent.submit(form);
  expect(mocks.request).toHaveBeenCalledTimes(1);
  expect(mocks.request.mock.calls[0][1].body).toEqual({
    reason: 'x'.repeat(240),
  });
  expect(screen.getByRole('button', { name: 'Cancelling…' })).toBeDisabled();
  resolve({ data: { ...order, status: 'CANCELLED' } });
  await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  expect(await screen.findByRole('status')).toHaveTextContent(
    'Cancellation succeeded',
  );
});
test('blank reason canonicalizes to null; failure preserves retry and refresh', async () => {
  mocks.request.mockRejectedValue(
    Object.assign(new Error('conflict'), { status: 409 }),
  );
  const refresh = vi.fn();
  mount(<OrderCancellation order={order} refresh={refresh} />);
  fireEvent.click(screen.getByRole('button', { name: 'Cancel order' }));
  fireEvent.change(screen.getByLabelText('Cancellation reason (optional)'), {
    target: { value: '   ' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Confirm cancellation' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'can no longer be cancelled',
  );
  expect(mocks.request.mock.calls[0][1].body).toEqual({ reason: null });
  fireEvent.click(screen.getByRole('button', { name: 'Refresh order' }));
  expect(refresh).toHaveBeenCalled();
});
test('successful cancellation refetches authoritative detail/history instead of constructing it locally', async () => {
  let cancelled = false;
  mocks.request.mockImplementation(async (path) => {
    if (path.endsWith('/cancel')) {
      cancelled = true;
      return { data: { ...order, status: 'CANCELLED' } };
    }
    return {
      data: cancelled
        ? {
            ...order,
            status: 'CANCELLED',
            statusHistory: [
              ...order.statusHistory,
              {
                toStatus: 'CANCELLED',
                reason: 'Server reason',
                createdAt: '2026-01-02T00:00:00.000Z',
              },
            ],
          }
        : order,
    };
  });
  mount(<CustomerOrderDetail orderNumber={order.orderNumber} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Cancel order' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm cancellation' }));
  expect(await screen.findByText('Status: CANCELLED')).toBeVisible();
  expect(screen.getByText('Server reason')).toBeVisible();
  expect(
    screen.queryByRole('button', { name: 'Cancel order' }),
  ).not.toBeInTheDocument();
  expect(
    mocks.request.mock.calls.filter(([path]) =>
      path.startsWith('/orders/by-number/'),
    ),
  ).toHaveLength(2);
});
test('lost cancellation response retries safely and accepts already-cancelled success/no-op', async () => {
  mocks.request
    .mockRejectedValueOnce(new Error('lost response'))
    .mockResolvedValueOnce({ data: { ...order, status: 'CANCELLED' } });
  const refresh = vi.fn(async () => ({}));
  mount(<OrderCancellation order={order} refresh={refresh} />);
  fireEvent.click(screen.getByRole('button', { name: 'Cancel order' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm cancellation' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Cancellation could not be confirmed',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Confirm cancellation' }));
  expect(await screen.findByRole('status')).toHaveTextContent(
    'Cancellation succeeded',
  );
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(mocks.request).toHaveBeenCalledTimes(2);
});
test('failed post-cancel detail refresh offers retry and eventually shows backend history', async () => {
  mocks.request
    .mockResolvedValueOnce({ data: order })
    .mockResolvedValueOnce({ data: { ...order, status: 'CANCELLED' } })
    .mockRejectedValueOnce(new Error('refresh failed'))
    .mockResolvedValueOnce({
      data: {
        ...order,
        status: 'CANCELLED',
        statusHistory: [
          {
            toStatus: 'CANCELLED',
            reason: 'Persisted reason',
            createdAt: order.createdAt,
          },
        ],
      },
    });
  mount(<CustomerOrderDetail orderNumber={order.orderNumber} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Cancel order' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm cancellation' }));
  await screen.findByText('We could not load your order.');
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByText('Status: CANCELLED')).toBeVisible();
  expect(screen.getByText('Persisted reason')).toBeVisible();
  expect(
    mocks.request.mock.calls.filter(([path]) => path.endsWith('/cancel')),
  ).toHaveLength(1);
});
