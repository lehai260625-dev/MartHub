'use client';

import { createContext, useContext } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { cartResponseSchema, wishlistResponseSchema } from '@marthub/contracts';
import { useAuth } from '../auth/auth-provider';

const ShoppingContext = createContext(null);
const emptyCart = { id: null, items: [], itemCount: 0 };
const emptyWishlist = { id: null, items: [], itemCount: 0 };

const optimisticCart = (response, product, quantity) => {
  const cart = response?.data ?? emptyCart;
  const existing = cart.items.find((item) => item.productId === product.id);
  const items = existing
    ? cart.items.map((item) =>
        item.productId === product.id
          ? { ...item, quantity: item.quantity + quantity }
          : item,
      )
    : [
        ...cart.items,
        {
          id: `optimistic-${product.id}`,
          productId: product.id,
          quantity,
          availability: product.availability.status,
          product,
        },
      ];
  return {
    data: {
      ...cart,
      items,
      itemCount: cart.itemCount + quantity,
    },
  };
};

function useOptimisticMutation({ queryClient, queryKey, mutationFn, update }) {
  return useMutation({
    mutationFn,
    onMutate: async (variables) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData(queryKey);
      queryClient.setQueryData(queryKey, (current) =>
        update(current, variables),
      );
      return { previous };
    },
    onError: (_error, _variables, context) => {
      queryClient.setQueryData(queryKey, context?.previous);
    },
    onSuccess: (response) => {
      if (response) queryClient.setQueryData(queryKey, response);
    },
    onSettled: (_data, _error, _variables, context) => {
      if (!context?.previous) queryClient.invalidateQueries({ queryKey });
    },
  });
}

export function ShoppingProvider({ children }) {
  const auth = useAuth();
  const queryClient = useQueryClient();
  const userId = auth.user?.id ?? 'guest';
  const enabled =
    auth.status === 'authenticated' && auth.user.role === 'CUSTOMER';
  const cartKey = ['cart', userId];
  const wishlistKey = ['wishlist', userId];
  const cartQuery = useQuery({
    queryKey: cartKey,
    queryFn: () => auth.request('/cart', { schema: cartResponseSchema }),
    enabled,
  });
  const wishlistQuery = useQuery({
    queryKey: wishlistKey,
    queryFn: () =>
      auth.request('/wishlist', { schema: wishlistResponseSchema }),
    enabled,
  });

  const addCart = useOptimisticMutation({
    queryClient,
    queryKey: cartKey,
    mutationFn: ({ product, quantity }) =>
      auth.request('/cart/items', {
        method: 'POST',
        body: { productId: product.id, quantity },
        schema: cartResponseSchema,
      }),
    update: (current, { product, quantity }) =>
      optimisticCart(current, product, quantity),
  });
  const updateCart = useOptimisticMutation({
    queryClient,
    queryKey: cartKey,
    mutationFn: ({ itemId, quantity }) =>
      auth.request(`/cart/items/${itemId}`, {
        method: 'PATCH',
        body: { quantity },
        schema: cartResponseSchema,
      }),
    update: (current, { itemId, quantity }) => ({
      data: {
        ...(current?.data ?? emptyCart),
        items: (current?.data.items ?? []).map((item) =>
          item.id === itemId ? { ...item, quantity } : item,
        ),
        itemCount: (current?.data.items ?? []).reduce(
          (total, item) =>
            total + (item.id === itemId ? quantity : item.quantity),
          0,
        ),
      },
    }),
  });
  const removeCart = useOptimisticMutation({
    queryClient,
    queryKey: cartKey,
    mutationFn: ({ itemId }) =>
      auth.request(`/cart/items/${itemId}`, {
        method: 'DELETE',
        schema: cartResponseSchema,
      }),
    update: (current, { itemId }) => {
      const cart = current?.data ?? emptyCart;
      const items = cart.items.filter((item) => item.id !== itemId);
      return {
        data: {
          ...cart,
          items,
          itemCount: items.reduce((total, item) => total + item.quantity, 0),
        },
      };
    },
  });
  const clearCart = useOptimisticMutation({
    queryClient,
    queryKey: cartKey,
    mutationFn: () =>
      auth.request('/cart/items', {
        method: 'DELETE',
        schema: cartResponseSchema,
      }),
    update: (current) => ({
      data: { ...(current?.data ?? emptyCart), items: [], itemCount: 0 },
    }),
  });
  const addWishlist = useOptimisticMutation({
    queryClient,
    queryKey: wishlistKey,
    mutationFn: ({ product }) =>
      auth.request(`/wishlist/items/${product.id}`, {
        method: 'PUT',
        schema: wishlistResponseSchema,
      }),
    update: (current, { product }) => {
      const wishlist = current?.data ?? emptyWishlist;
      if (wishlist.items.some((item) => item.productId === product.id))
        return current;
      const items = [
        ...wishlist.items,
        {
          id: `optimistic-${product.id}`,
          productId: product.id,
          availability: product.availability.status,
          product,
        },
      ];
      return { data: { ...wishlist, items, itemCount: items.length } };
    },
  });
  const removeWishlist = useOptimisticMutation({
    queryClient,
    queryKey: wishlistKey,
    mutationFn: ({ productId }) =>
      auth.request(`/wishlist/items/${productId}`, { method: 'DELETE' }),
    update: (current, { productId }) => {
      const wishlist = current?.data ?? emptyWishlist;
      const items = wishlist.items.filter(
        (item) => item.productId !== productId,
      );
      return { data: { ...wishlist, items, itemCount: items.length } };
    },
  });

  const cartPending = [addCart, updateCart, removeCart, clearCart].some(
    ({ isPending }) => isPending,
  );
  const wishlistPending = [addWishlist, removeWishlist].some(
    ({ isPending }) => isPending,
  );
  const cart = cartQuery.data?.data ?? emptyCart;
  const wishlist = wishlistQuery.data?.data ?? emptyWishlist;
  return (
    <ShoppingContext.Provider
      value={{
        cart,
        wishlist,
        cartReady: enabled && !cartQuery.isPending,
        wishlistReady: enabled && !wishlistQuery.isPending,
        cartPending,
        wishlistPending,
        cartError: cartQuery.isError,
        wishlistError: wishlistQuery.isError,
        wishlistMutationError: addWishlist.error || removeWishlist.error,
        retryCart: cartQuery.refetch,
        retryWishlist: wishlistQuery.refetch,
        addToCart: (product, quantity = 1) =>
          addCart.mutateAsync({ product, quantity }),
        updateCartItem: (itemId, quantity) =>
          updateCart.mutateAsync({ itemId, quantity }),
        removeCartItem: (itemId) => removeCart.mutateAsync({ itemId }),
        clearCart: () => clearCart.mutateAsync(),
        addToWishlist: (product) => addWishlist.mutateAsync({ product }),
        removeFromWishlist: (productId) =>
          removeWishlist.mutateAsync({ productId }),
        wishlistContains: (productId) =>
          wishlist.items.some((item) => item.productId === productId),
      }}
    >
      {children}
    </ShoppingContext.Provider>
  );
}

export function useShopping() {
  const shopping = useContext(ShoppingContext);
  if (!shopping) throw new Error('useShopping requires ShoppingProvider.');
  return shopping;
}
