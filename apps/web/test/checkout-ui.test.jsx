import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import {
  CheckoutManager,
  CheckoutSuccess,
} from '../features/checkout/checkout-manager';

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  replace: vi.fn(),
  user: { id: 'b2ecb79a-b74a-4748-93dc-f2fc02b93b3d', role: 'CUSTOMER' },
  shopping: {},
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mocks.replace }),
}));
vi.mock('../features/auth/auth-provider', () => ({ useAuth: () => mocks }));
vi.mock('../features/shopping/shopping-provider', () => ({
  useShopping: () => mocks.shopping,
}));
const cartId = '8ae0b1ba-2414-4d55-a0ad-7cc6ab8a4f96';
const address = {
  id: '37578ca4-f54b-4d06-9d46-09e0907e5751',
  label: 'Home',
  recipientName: 'Minh Nguyen',
  phone: '+84 912345678',
  line1: '12 Market Street',
  ward: 'Ward 1',
  district: 'District 3',
  province: 'Ho Chi Minh City',
};
const quote = {
  cartId,
  address,
  currency: 'VND',
  subtotal: '9007199254740993',
  shippingFee: '0',
  discountTotal: '0',
  total: '9007199254740993',
  expiresAt: '2099-01-01T00:00:00.000Z',
  items: [
    {
      productId: 'da7a0000-0000-4000-8000-020000000001',
      name: 'Cove Mug',
      quantity: 1,
      unitPrice: '9007199254740993',
      lineTotal: '9007199254740993',
    },
  ],
};
const order = { ...quote, orderNumber: 'MH-test', status: 'PENDING' };
function mount(
  component = <CheckoutManager />,
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  }),
) {
  render(
    <QueryClientProvider client={client}>{component}</QueryClientProvider>,
  );
  return client;
}
async function selectAddress() {
  fireEvent.click(await screen.findByRole('radio'));
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Place COD order' }),
    ).toBeEnabled(),
  );
}
beforeEach(() => {
  mocks.replace.mockReset();
  mocks.shopping = {
    cartReady: true,
    cartError: false,
    cartPending: false,
    cart: { id: cartId, items: [{ id: 'line' }] },
    retryCart: vi.fn(async () => ({})),
  };
  mocks.request.mockReset();
  mocks.request.mockImplementation(async (path) => {
    if (path === '/users/me/addresses') return { data: [address] };
    if (path === '/checkout/quote') return { data: quote };
    if (path === '/checkout/orders') return { data: order };
    throw new Error(path);
  });
});
test('renders loading then the empty cart without requesting a quote', async () => {
  mocks.shopping.cartReady = false;
  const client = mount();
  expect(screen.getByRole('status')).toHaveTextContent('Loading checkout');
  mocks.shopping.cartReady = true;
  mocks.shopping.cart.items = [];
  client.setQueryData(['addresses', mocks.user.id], { data: [address] });
  await screen.findByText('Your cart is empty.');
  expect(
    mocks.request.mock.calls.some(([path]) => path === '/checkout/quote'),
  ).toBe(false);
});
test('missing address and load failure have actionable recovery', async () => {
  mocks.request.mockRejectedValue(new Error('Offline'));
  mount();
  await screen.findByRole('button', { name: 'Retry checkout' });
  mocks.request.mockResolvedValue({ data: [] });
  fireEvent.click(
    await screen.findByRole('button', { name: 'Retry checkout' }),
  );
  await screen.findByText(/No saved addresses/);
  expect(screen.getByRole('link', { name: 'Add an address' })).toHaveAttribute(
    'href',
    '/account/addresses',
  );
});
test('uses exact server money, strict intent and one locked submission; reconciles cart then navigates', async () => {
  let finish;
  mocks.request.mockImplementation(async (path) =>
    path === '/users/me/addresses'
      ? { data: [address] }
      : path === '/checkout/quote'
        ? { data: quote }
        : new Promise((resolve) => {
            finish = resolve;
          }),
  );
  mount();
  await selectAddress();
  expect(screen.getAllByText('9.007.199.254.740.993 ₫').length).toBeGreaterThan(
    0,
  );
  fireEvent.change(screen.getByLabelText('Customer note (optional)'), {
    target: { value: '  Please call  ' },
  });
  const button = screen.getByRole('button', { name: 'Place COD order' });
  fireEvent.click(button);
  fireEvent.click(button);
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Placing order…' }),
    ).toBeDisabled(),
  );
  expect(screen.getByRole('radio')).toBeDisabled();
  const calls = mocks.request.mock.calls.filter(
    ([path]) => path === '/checkout/orders',
  );
  expect(calls).toHaveLength(1);
  expect(calls[0][1].body).toEqual({
    cartId,
    addressId: address.id,
    customerNote: 'Please call',
  });
  expect(calls[0][1].idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
  finish({ data: order });
  await waitFor(() =>
    expect(mocks.replace).toHaveBeenCalledWith('/checkout/success/MH-test'),
  );
  expect(mocks.shopping.retryCart).toHaveBeenCalledOnce();
});
test('uncertain result retains the identical key and intent even when cart becomes empty', async () => {
  let calls = 0;
  mocks.request.mockImplementation(async (path) => {
    if (path === '/users/me/addresses') return { data: [address] };
    if (path === '/checkout/quote') return { data: quote };
    if (++calls === 1) throw new Error('Connection lost');
    return { data: order };
  });
  mount();
  await selectAddress();
  fireEvent.click(screen.getByRole('button', { name: 'Place COD order' }));
  const retry = await screen.findByRole('button', {
    name: 'Retry same submission',
  });
  expect(screen.getByLabelText('Customer note (optional)')).toBeDisabled();
  mocks.shopping.cart.items = [];
  fireEvent.click(retry);
  await waitFor(() => expect(mocks.replace).toHaveBeenCalled());
  const requests = mocks.request.mock.calls.filter(
    ([path]) => path === '/checkout/orders',
  );
  expect(requests[1][1].idempotencyKey).toBe(requests[0][1].idempotencyKey);
  expect(requests[1][1].body).toEqual(requests[0][1].body);
});
test('stock conflict explains the affected item and permits review without changing the cart', async () => {
  mocks.request.mockImplementation(async (path) => {
    if (path === '/users/me/addresses') return { data: [address] };
    if (path === '/checkout/quote') return { data: quote };
    throw Object.assign(new Error('Stock changed.'), {
      status: 409,
      code: 'INSUFFICIENT_STOCK',
      details: [
        { productId: quote.items[0].productId, requested: 1, available: 0 },
      ],
    });
  });
  mount();
  await selectAddress();
  fireEvent.click(screen.getByRole('button', { name: 'Place COD order' }));
  await screen.findByText(/Cove Mug: requested 1, available 0/);
  expect(screen.getByRole('radio')).toBeEnabled();
  expect(mocks.shopping.retryCart).not.toHaveBeenCalled();
  expect(mocks.replace).not.toHaveBeenCalled();
});
test('unavailable quote never enables submission; summary can be retried', async () => {
  mocks.request.mockImplementation(async (path) => {
    if (path === '/users/me/addresses') return { data: [address] };
    throw new Error('A cart product is unavailable.');
  });
  mount();
  fireEvent.click(await screen.findByRole('radio'));
  await screen.findByText('A cart product is unavailable.');
  expect(
    screen.getByRole('button', { name: 'Place COD order' }),
  ).toBeDisabled();
  expect(
    screen.getByRole('link', { name: 'Review affected cart items' }),
  ).toHaveAttribute('href', '/cart');
  mocks.request.mockResolvedValue({ data: quote });
  fireEvent.click(
    screen.getByRole('button', { name: 'Refresh server summary' }),
  );
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Place COD order' }),
    ).toBeEnabled(),
  );
});
test('overlong note cannot create an order', async () => {
  mount();
  await selectAddress();
  fireEvent.change(screen.getByLabelText('Customer note (optional)'), {
    target: { value: 'x'.repeat(501) },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Place COD order' }));
  await screen.findByText(/Notes must be at most 500/);
  expect(
    mocks.request.mock.calls.some(([path]) => path === '/checkout/orders'),
  ).toBe(false);
});
test('expired server summary refreshes for review without submitting', async () => {
  mocks.request.mockImplementation(async (path) =>
    path === '/users/me/addresses'
      ? { data: [address] }
      : { data: { ...quote, expiresAt: '2020-01-01T00:00:00.000Z' } },
  );
  mount();
  await selectAddress();
  fireEvent.click(screen.getByRole('button', { name: 'Place COD order' }));
  await screen.findByText(/The summary expired/);
  expect(
    mocks.request.mock.calls.filter(([path]) => path === '/checkout/quote'),
  ).toHaveLength(2);
  expect(
    mocks.request.mock.calls.some(([path]) => path === '/checkout/orders'),
  ).toBe(false);
});
test('a server failure or unreadable committed response keeps the original intent for replay', async () => {
  let calls = 0;
  mocks.request.mockImplementation(async (path) => {
    if (path === '/users/me/addresses') return { data: [address] };
    if (path === '/checkout/quote') return { data: quote };
    calls++;
    throw Object.assign(
      new Error('Result not confirmed'),
      calls === 1 ? { status: 500 } : { status: 201, code: 'INVALID_RESPONSE' },
    );
  });
  mount();
  await selectAddress();
  fireEvent.click(screen.getByRole('button', { name: 'Place COD order' }));
  fireEvent.click(
    await screen.findByRole('button', { name: 'Retry same submission' }),
  );
  await waitFor(() => expect(calls).toBe(2));
  const requests = mocks.request.mock.calls.filter(
    ([path]) => path === '/checkout/orders',
  );
  expect(requests[1][1].idempotencyKey).toBe(requests[0][1].idempotencyKey);
  expect(mocks.replace).not.toHaveBeenCalled();
});
test('success uses only auth-scoped confirmed server results, never an arbitrary URL identifier', () => {
  const client = new QueryClient();
  client.setQueryData(['checkout-success', mocks.user.id, 'MH-test'], order);
  mount(<CheckoutSuccess orderNumber="MH-test" />, client);
  expect(screen.getByRole('status')).toHaveTextContent('placed successfully');
  expect(screen.getByText('Status: PENDING')).toBeVisible();
});
test('unconfirmed success URL does not fabricate an order', () => {
  mount(<CheckoutSuccess orderNumber="unknown" />);
  expect(screen.getByText(/no confirmed submission/)).toBeVisible();
  expect(screen.queryByText(/placed successfully/)).not.toBeInTheDocument();
});
test('in-session recovery restores the original intent and can replay despite failed current address/cart reads', async () => {
  mocks.shopping.cartError = true;
  mocks.shopping.cartReady = false;
  mocks.request.mockImplementation(async (path) => {
    if (path === '/users/me/addresses')
      throw new Error('Address service unavailable');
    if (path === '/checkout/orders') return { data: order };
    throw new Error(path);
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const saved = {
    key: '37578ca4-f54b-4d06-9d46-09e0907e5751',
    intent: { cartId, addressId: address.id, customerNote: 'Original note' },
  };
  client.setQueryData(['checkout-attempt', mocks.user.id], saved);
  mount(<CheckoutManager />, client);
  expect(screen.getByLabelText('Customer note (optional)')).toHaveValue(
    'Original note',
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Retry same submission' }),
  );
  await waitFor(() => expect(mocks.replace).toHaveBeenCalled());
  expect(
    mocks.request.mock.calls.find(([path]) => path === '/checkout/orders')[1]
      .body,
  ).toEqual(saved.intent);
});
