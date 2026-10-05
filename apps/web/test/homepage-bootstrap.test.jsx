import { describe, expect, it, vi } from 'vitest';
import { homepageResponseSchema } from '@marthub/contracts';
import HomePage from '../app/page';

const mocks = vi.hoisted(() => ({ connection: vi.fn(), serverApi: vi.fn() }));
vi.mock('next/server', () => ({ connection: mocks.connection }));
vi.mock('../lib/api/server', () => ({ serverApi: mocks.serverApi }));

describe('public request-time homepage bootstrap', () => {
  it('passes only the authoritative public API response to existing client presentation', async () => {
    const response = {
      data: {
        promotions: [],
        categories: [],
        deals: [],
        newProducts: [],
        popularProducts: [],
      },
    };
    mocks.serverApi.mockResolvedValueOnce(response);
    const page = await HomePage();
    expect(mocks.connection).toHaveBeenCalled();
    expect(mocks.serverApi).toHaveBeenLastCalledWith('/homepage', {
      schema: homepageResponseSchema,
    });
    expect(page.props.children[1].props.initialData).toBe(response);
  });
  it('preserves client recovery when public bootstrap fails, without fabricating data', async () => {
    mocks.serverApi.mockRejectedValueOnce(new Error('Upstream unavailable'));
    const page = await HomePage();
    expect(page.props.children[1].props.initialData).toBeUndefined();
  });
});
