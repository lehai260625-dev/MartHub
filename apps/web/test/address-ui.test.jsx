import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AddressManager } from '../features/account/address-manager';

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  user: {
    id: 'b2ecb79a-b74a-4748-93dc-f2fc02b93b3d',
    email: 'customer@example.test',
    firstName: 'Minh',
    lastName: 'Nguyen',
    role: 'CUSTOMER',
    status: 'ACTIVE',
  },
}));
vi.mock('../features/auth/auth-provider', () => ({ useAuth: () => mocks }));

const home = {
  id: '37578ca4-f54b-4d06-9d46-09e0907e5751',
  label: 'Home',
  recipientName: 'Minh Nguyen',
  phone: '+84 912345678',
  line1: '12 Market Street',
  line2: null,
  ward: 'Ward 1',
  district: 'District 3',
  province: 'Ho Chi Minh City',
  postalCode: '700000',
  isDefault: true,
};
const office = {
  ...home,
  id: '0e7b73b7-9db0-4ae0-80b5-08e4049162cf',
  label: 'Office',
  line1: '20 Commerce Avenue',
  isDefault: false,
};

function renderManager() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <AddressManager />
    </QueryClientProvider>,
  );
}

function fillRequired() {
  for (const [label, value] of [
    ['Address label', 'Home'],
    ['Recipient name', 'Minh Nguyen'],
    ['Phone number', '+84 912345678'],
    ['Address line 1', '12 Market Street'],
    ['Ward', 'Ward 1'],
    ['District', 'District 3'],
    ['Province or city', 'Ho Chi Minh City'],
  ])
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

describe('address manager', () => {
  beforeEach(() => mocks.request.mockReset());

  it('shows an empty state, validates, and creates the first address', async () => {
    let rows = [];
    mocks.request.mockImplementation(async (path, options = {}) => {
      if (options.method === 'POST') {
        rows = [home];
        return { data: home };
      }
      return { data: rows };
    });
    renderManager();
    expect(await screen.findByText('No delivery addresses yet.')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Add address' }));
    expect(
      await screen.findAllByText(
        'Too small: expected string to have >=1 characters',
      ),
    ).not.toHaveLength(0);
    expect(mocks.request).toHaveBeenCalledTimes(1);
    fillRequired();
    fireEvent.click(screen.getByRole('button', { name: 'Add address' }));
    expect(await screen.findByRole('heading', { name: 'Home' })).toBeVisible();
    expect(screen.getByText('Default')).toBeVisible();
    expect(mocks.request).toHaveBeenCalledWith(
      '/users/me/addresses',
      expect.objectContaining({
        method: 'POST',
        body: expect.objectContaining({ label: 'Home' }),
      }),
    );
  });

  it('edits, changes the default, and confirms soft removal', async () => {
    let rows = [home, office];
    mocks.request.mockImplementation(async (path, options = {}) => {
      if (options.method === 'PUT') {
        rows = rows.map((row) => ({ ...row, isDefault: row.id === office.id }));
        return { data: rows[1] };
      }
      if (options.method === 'PATCH') {
        rows = rows.map((row) =>
          row.id === office.id ? { ...row, label: options.body.label } : row,
        );
        return { data: rows[1] };
      }
      if (options.method === 'DELETE') {
        rows = rows.filter((row) => row.id !== office.id);
        return undefined;
      }
      return { data: rows };
    });
    renderManager();
    await screen.findByRole('heading', { name: 'Office' });
    fireEvent.click(
      screen.getByRole('button', { name: 'Make Office default' }),
    );
    await screen.findByText('Office is now your default address.');
    fireEvent.click(screen.getByRole('button', { name: 'Edit Office' }));
    const label = screen.getByLabelText('Address label');
    fireEvent.change(label, { target: { value: 'Work' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByRole('heading', { name: 'Work' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Remove Work' }));
    expect(screen.getByText('Remove Work?')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm remove' }));
    await waitFor(() =>
      expect(
        screen.queryByRole('heading', { name: 'Work' }),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByText('Work was removed.')).toBeVisible();
  });

  it('offers retry after a recoverable list error', async () => {
    mocks.request
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ data: [home] });
    renderManager();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'could not load',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { name: 'Home' })).toBeVisible();
  });
});
