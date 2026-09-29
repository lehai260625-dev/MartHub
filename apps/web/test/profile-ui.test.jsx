import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProfileForm } from '../features/account/profile-form';

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  updateUser: vi.fn(),
  user: {
    id: 'b2ecb79a-b74a-4748-93dc-f2fc02b93b3d',
    email: 'customer@example.test',
    firstName: 'Minh',
    lastName: 'Nguyen',
    phone: null,
    role: 'CUSTOMER',
    status: 'ACTIVE',
  },
}));
vi.mock('../features/auth/auth-provider', () => ({ useAuth: () => mocks }));

function renderForm() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ProfileForm />
    </QueryClientProvider>,
  );
}

describe('profile form', () => {
  beforeEach(() => {
    mocks.request.mockReset();
    mocks.updateUser.mockReset();
  });

  it('loads, submits allowed fields, and updates authenticated identity', async () => {
    const updated = {
      ...mocks.user,
      firstName: 'Mai',
      lastName: 'Tran',
      phone: '+84 912345678',
    };
    mocks.request
      .mockResolvedValueOnce({ data: mocks.user })
      .mockResolvedValueOnce({ data: updated });
    renderForm();
    expect(screen.getByRole('status')).toHaveTextContent(
      'Loading your profile',
    );
    const firstName = await screen.findByLabelText('First name');
    fireEvent.change(firstName, { target: { value: 'Mai' } });
    fireEvent.change(screen.getByLabelText('Last name'), {
      target: { value: 'Tran' },
    });
    fireEvent.change(screen.getByLabelText('Phone number'), {
      target: { value: '+84 912345678' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }));
    await screen.findByText('Profile saved.');
    expect(mocks.request).toHaveBeenLastCalledWith(
      '/users/me',
      expect.objectContaining({
        method: 'PATCH',
        body: { firstName: 'Mai', lastName: 'Tran', phone: '+84 912345678' },
      }),
    );
    expect(mocks.updateUser).toHaveBeenCalledWith(updated);
  });

  it('offers a retry when the profile cannot be loaded', async () => {
    mocks.request
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ data: mocks.user });
    renderForm();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'could not load',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByLabelText('First name')).toHaveValue('Minh');
  });

  it('blocks invalid input and preserves edits after a failed update', async () => {
    mocks.request
      .mockResolvedValueOnce({ data: mocks.user })
      .mockRejectedValueOnce(new Error('Please try later.'));
    renderForm();
    const firstName = await screen.findByLabelText('First name');
    fireEvent.change(firstName, { target: { value: '<invalid>' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }));
    expect(
      await screen.findByText('Use plain text without control characters.'),
    ).toBeVisible();
    expect(mocks.request).toHaveBeenCalledTimes(1);
    fireEvent.change(firstName, { target: { value: 'Edited' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }));
    expect(await screen.findByText('Please try later.')).toBeVisible();
    expect(firstName).toHaveValue('Edited');
    await waitFor(() => expect(mocks.request).toHaveBeenCalledTimes(2));
  });
});
