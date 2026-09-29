import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClientError } from '../lib/api/core';
import { ProductCard } from '../features/catalog/product-card';
import { ShoppingHeader } from '../features/shopping/shopping-header';
import { CartManager } from '../features/shopping/cart-manager';
import { MyItems } from '../features/shopping/my-items';
import { ShoppingTestShell } from './shopping-test-shell';

const navigation = vi.hoisted(() => ({
  pathname: '/search',
  search: '',
  push: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: navigation.push }),
  usePathname: () => navigation.pathname,
  useSearchParams: () => new URLSearchParams(navigation.search),
}));

const user = {
  id: 'b2ecb79a-b74a-4748-93dc-f2fc02b93b3d',
  email: 'customer@example.test',
  firstName: 'Minh',
  lastName: 'Nguyen',
  role: 'CUSTOMER',
};
const authenticated = { status: 'authenticated', user, error: null };
const product = {
  id: 'da7a0000-0000-4000-8000-020000000001',
  slug: 'cove-stoneware-mug',
  sku: 'MHB-DEMO-001',
  name: 'Cove Stoneware Mug',
  shortDescription: 'A rounded mug.',
  image: null,
  price: '9007199254740993',
  compareAtPrice: null,
  currency: 'VND',
  sellingUnit: 'each',
  badges: [],
  availability: { status: 'IN_STOCK', canAddToCart: true },
};
const emptyCart = { data: { id: null, items: [], itemCount: 0 } };
const emptyWishlist = { data: { id: null, items: [], itemCount: 0 } };
const cartWithItem = {
  data: {
    id: '8ae0b1ba-2414-4d55-a0ad-7cc6ab8a4f96',
    itemCount: 1,
    items: [
      {
        id: 'bca61ed7-dc50-4aa0-bbf7-b4561e572d3a',
        productId: product.id,
        quantity: 1,
        availability: 'IN_STOCK',
        product,
      },
    ],
  },
};

function mount(children, request, state = authenticated) {
  return render(
    <ShoppingTestShell request={request} state={state}>
      {children}
    </ShoppingTestShell>,
  );
}

beforeEach(() => {
  navigation.pathname = '/search';
  navigation.search = '';
  navigation.push.mockReset();
  window.history.replaceState({}, '', '/search?q=mug');
});

describe('M5.5 shopping interactions', () => {
  it('routes guest cart and wishlist intent through login with the safe current URL', () => {
    mount(<ProductCard product={product} />, vi.fn(), {
      status: 'guest',
      user: null,
      error: null,
    });
    fireEvent.click(screen.getByRole('button', { name: /add .* to cart/i }));
    expect(navigation.push).toHaveBeenCalledWith(
      '/login?returnTo=%2Fsearch%3Fq%3Dmug',
    );
    fireEvent.click(
      screen.getByRole('button', { name: /save .* to wishlist/i }),
    );
    expect(navigation.push).toHaveBeenLastCalledWith(
      '/login?returnTo=%2Fsearch%3Fq%3Dmug',
    );
  });

  it('synchronizes header count on success and rolls optimistic cart add back on failure', async () => {
    let rejectAdd;
    const request = vi.fn((path, options = {}) => {
      if (path === '/cart' && !options.method)
        return Promise.resolve(emptyCart);
      if (path === '/wishlist') return Promise.resolve(emptyWishlist);
      if (path === '/cart/items')
        return new Promise((_, reject) => {
          rejectAdd = reject;
        });
      throw new Error(`Unexpected ${path}`);
    });
    mount(
      <>
        <ShoppingHeader />
        <ProductCard product={product} />
      </>,
      request,
    );
    const add = await screen.findByRole('button', {
      name: /add .* to cart/i,
    });
    await waitFor(() => expect(add).toBeEnabled());
    fireEvent.click(add);
    await waitFor(() =>
      expect(screen.getByLabelText('1 items in cart')).toBeVisible(),
    );
    rejectAdd(
      new ApiClientError('Private server detail', {
        status: 503,
        code: 'SERVICE_UNAVAILABLE',
      }),
    );
    expect(
      await screen.findByText('Could not add to cart. Please try again.'),
    ).toBeVisible();
    expect(screen.getByLabelText('0 items in cart')).toBeVisible();
  });

  it('restores the last valid quantity after a failed optimistic update', async () => {
    let rejectUpdate;
    const request = vi.fn((path, options = {}) => {
      if (path === '/cart' && !options.method)
        return Promise.resolve(cartWithItem);
      if (path === '/wishlist') return Promise.resolve(emptyWishlist);
      if (path.includes('/cart/items/'))
        return new Promise((_, reject) => {
          rejectUpdate = reject;
        });
      throw new Error(`Unexpected ${path}`);
    });
    mount(<CartManager />, request);
    const input = await screen.findByLabelText('Quantity');
    fireEvent.change(input, { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update' }));
    expect(input).toHaveValue(2);
    await waitFor(() => expect(rejectUpdate).toBeTypeOf('function'));
    rejectUpdate(new ApiClientError('Offline'));
    expect(
      await screen.findByText(/previous quantity was restored/i),
    ).toBeVisible();
    expect(input).toHaveValue(1);
  });

  it('covers wishlist empty, retry, tabs, and populated current availability', async () => {
    navigation.pathname = '/account/my-items';
    navigation.search = 'tab=wishlist';
    const emptyRequest = vi.fn((path) =>
      path === '/cart'
        ? Promise.resolve(emptyCart)
        : Promise.resolve(emptyWishlist),
    );
    const first = mount(<MyItems />, emptyRequest);
    expect(await screen.findByText('Your wishlist is empty')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Wishlist' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    first.unmount();

    const failing = vi.fn((path) =>
      path === '/wishlist'
        ? Promise.reject(new ApiClientError('Offline'))
        : Promise.resolve(emptyCart),
    );
    const second = mount(<MyItems />, failing);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'could not load your wishlist',
    );
    expect(screen.getByRole('button', { name: 'Try again' })).toBeVisible();
    second.unmount();

    const populated = vi.fn((path) =>
      path === '/cart'
        ? Promise.resolve(emptyCart)
        : Promise.resolve({
            data: {
              id: '8ae0b1ba-2414-4d55-a0ad-7cc6ab8a4f96',
              itemCount: 1,
              items: [
                {
                  id: 'bca61ed7-dc50-4aa0-bbf7-b4561e572d3a',
                  productId: product.id,
                  availability: 'OUT_OF_STOCK',
                  product: {
                    ...product,
                    availability: {
                      status: 'OUT_OF_STOCK',
                      canAddToCart: false,
                    },
                  },
                },
              ],
            },
          }),
    );
    mount(<MyItems />, populated);
    expect((await screen.findAllByText('Out of stock'))[0]).toBeVisible();
    expect(
      screen.getByRole('button', { name: /out of stock/i }),
    ).toBeDisabled();
  });

  it('rolls a failed optimistic wishlist removal back with retry feedback', async () => {
    navigation.pathname = '/account/my-items';
    navigation.search = 'tab=wishlist';
    let rejectRemove;
    const request = vi.fn((path, options = {}) => {
      if (path === '/cart') return Promise.resolve(emptyCart);
      if (path === '/wishlist')
        return Promise.resolve({
          data: {
            id: '8ae0b1ba-2414-4d55-a0ad-7cc6ab8a4f96',
            itemCount: 1,
            items: [
              {
                id: 'bca61ed7-dc50-4aa0-bbf7-b4561e572d3a',
                productId: product.id,
                availability: 'IN_STOCK',
                product,
              },
            ],
          },
        });
      if (path.includes('/wishlist/items/') && options.method === 'DELETE')
        return new Promise((_, reject) => {
          rejectRemove = reject;
        });
      throw new Error(`Unexpected ${path}`);
    });
    mount(<MyItems />, request);
    const remove = await screen.findByRole('button', {
      name: /remove .* from wishlist/i,
    });
    fireEvent.click(remove);
    await waitFor(() =>
      expect(screen.queryByText(product.name)).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(rejectRemove).toBeTypeOf('function'));
    rejectRemove(new ApiClientError('Offline'));
    expect(await screen.findByText(product.name)).toBeVisible();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'saved items were restored',
    );
  });
});
