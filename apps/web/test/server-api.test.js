import { afterEach, expect, test, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { serverApi } from '../lib/api/server';
import { api } from '../lib/api/client';
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

test('server helper uses internal origin while browser helper stays same-origin', async () => {
  vi.stubEnv('API_INTERNAL_ORIGIN', 'http://127.0.0.1:14000');
  const fetchMock = vi.fn(async () =>
    Response.json({ data: { status: 'ok' } }),
  );
  vi.stubGlobal('fetch', fetchMock);
  await serverApi('/health/live', { requestId: 'req_server' });
  await api('/health/live');
  expect(fetchMock.mock.calls[0][0]).toBe(
    'http://127.0.0.1:14000/api/v1/health/live',
  );
  expect(fetchMock.mock.calls[0][1].headers.get('X-Request-Id')).toBe(
    'req_server',
  );
  expect(fetchMock.mock.calls[1][0]).toBe('/api/v1/health/live');
  expect(fetchMock.mock.calls[1][1].headers.has('X-Request-Id')).toBe(false);
});
