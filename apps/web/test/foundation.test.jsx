import { expect, test, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useQuery } from '@tanstack/react-query';
import Providers from '../app/providers';
import Loading from '../app/loading';
import NotFound from '../app/not-found';
import ErrorPage from '../app/error';
import { createApiClient } from '../lib/api/core';
import { healthSchema } from '@marthub/contracts';

test('route states expose loading, home recovery, and working retry without internal errors', () => {
  const first = render(<Loading />);
  expect(screen.getByRole('status')).toHaveTextContent('Loading');
  first.unmount();
  const second = render(<NotFound />);
  expect(screen.getByRole('link')).toHaveAttribute('href', '/');
  second.unmount();
  const retry = vi.fn();
  render(<ErrorPage retry={retry} error={new Error('private-secret')} />);
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(retry).toHaveBeenCalledOnce();
  expect(screen.queryByText('private-secret')).not.toBeInTheDocument();
});

test('query provider renders a mocked API response', async () => {
  const fetchImpl = vi.fn(async () =>
    Response.json({ data: { status: 'ok', version: 'v1' } }),
  );
  const api = createApiClient({ fetchImpl });
  function Probe() {
    const query = useQuery({
      queryKey: ['health'],
      queryFn: () => api('/health/live', { schema: healthSchema }),
    });
    return <p>{query.data?.data.status || 'Loading'}</p>;
  }
  render(
    <Providers>
      <Probe />
    </Providers>,
  );
  expect(await screen.findByText('ok')).toBeInTheDocument();
  expect(fetchImpl.mock.calls[0][0]).toBe('/api/v1/health/live');
  expect(fetchImpl.mock.calls[0][1].cache).toBe('no-store');
});
