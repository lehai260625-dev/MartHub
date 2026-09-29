import { expect, test, vi } from 'vitest';
import { createApiClient } from '../lib/api/core';
import { healthSchema } from '@marthub/contracts';

test('API helper handles structured errors, invalid responses, and empty responses', async () => {
  const rejected = createApiClient({
    fetchImpl: async () =>
      Response.json(
        {
          error: {
            code: 'NOT_FOUND',
            message: 'Missing',
            requestId: 'req_test',
          },
        },
        { status: 404 },
      ),
  });
  await expect(rejected('/missing')).rejects.toMatchObject({
    status: 404,
    code: 'NOT_FOUND',
    requestId: 'req_test',
  });
  await expect(
    createApiClient({
      fetchImpl: async () => new Response(null, { status: 204 }),
    })('/item', { method: 'DELETE' }),
  ).resolves.toBeUndefined();
  await expect(
    createApiClient({ fetchImpl: async () => new Response('html') })('/item'),
  ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  await expect(
    createApiClient({ fetchImpl: async () => Response.json({ bad: true }) })(
      '/health/live',
      { schema: healthSchema },
    ),
  ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
});
test('API helper keeps credentials per request and prevents boundary escapes', async () => {
  const fetchImpl = vi.fn(async () => Response.json({ data: {} }));
  const api = createApiClient({ origin: 'http://localhost:4000', fetchImpl });
  await api('/item', {
    method: 'POST',
    body: { quantity: 1 },
    token: 'memory-token',
    requestId: 'req_test',
  });
  await api('/item');
  expect(fetchImpl.mock.calls[0][1].headers.get('Authorization')).toBe(
    'Bearer memory-token',
  );
  expect(fetchImpl.mock.calls[1][1].headers.has('Authorization')).toBe(false);
  for (const path of [
    'https://evil.example',
    '//evil.example',
    '/../private',
    '/%2e%2e/private',
    '/x/../../private',
    '/x#fragment',
  ])
    await expect(api(path)).rejects.toThrow();
  expect(fetchImpl).toHaveBeenCalledTimes(2);
});
test('network errors are safe and cancellation is preserved', async () => {
  await expect(
    createApiClient({
      fetchImpl: async () => {
        throw new Error('secret-host');
      },
    })('/item'),
  ).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
  await expect(
    createApiClient({
      fetchImpl: async () => {
        throw new DOMException('Cancelled', 'AbortError');
      },
    })('/item'),
  ).rejects.toMatchObject({ name: 'AbortError' });
});
