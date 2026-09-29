'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { MAX_CART_ITEM_QUANTITY } from '@marthub/contracts';
import { useAuth } from '../auth/auth-provider';
import { safeReturnTo } from '../../lib/auth/return-to';
import { useShopping } from './shopping-provider';

function currentReturnTo() {
  if (typeof window === 'undefined') return '/';
  return safeReturnTo(window.location.pathname + window.location.search);
}

function useProtectedAction() {
  const auth = useAuth();
  const router = useRouter();
  return {
    auth,
    requireCustomer() {
      if (auth.status === 'authenticated') return true;
      if (auth.status === 'guest')
        router.push(`/login?returnTo=${encodeURIComponent(currentReturnTo())}`);
      return false;
    },
  };
}

function safeMessage(error, fallback) {
  if (error?.code === 'PRODUCT_UNAVAILABLE')
    return 'This product is no longer available for this action.';
  if (error?.code === 'VALIDATION_ERROR')
    return 'Choose a quantity from 1 through 99.';
  return fallback;
}

export function WishlistButton({ product, className = '' }) {
  const shopping = useShopping();
  const { auth, requireCustomer } = useProtectedAction();
  const [message, setMessage] = useState('');
  const saved = shopping.wishlistContains(product.id);
  const pending = shopping.wishlistPending;
  const disabled =
    auth.status === 'loading' ||
    auth.status === 'error' ||
    (auth.status === 'authenticated' && !shopping.wishlistReady) ||
    pending;
  const toggle = async () => {
    setMessage('');
    if (!requireCustomer()) return;
    try {
      if (saved) await shopping.removeFromWishlist(product.id);
      else await shopping.addToWishlist(product);
      if (!saved) setMessage('Saved to wishlist.');
    } catch (error) {
      setMessage(
        safeMessage(error, 'Wishlist could not be updated. Please try again.'),
      );
    }
  };
  return (
    <div className={className || 'relative'}>
      <button
        aria-label={
          saved
            ? `Remove ${product.name} from wishlist`
            : `Save ${product.name} to wishlist`
        }
        aria-pressed={saved}
        className="wishlist-button"
        disabled={disabled}
        onClick={toggle}
        title={saved ? 'Remove from wishlist' : 'Save to wishlist'}
        type="button"
      >
        <span aria-hidden="true">{saved ? '♥' : '♡'}</span>
      </button>
      <span className="wishlist-feedback" role="status" aria-live="polite">
        {message}
      </span>
    </div>
  );
}

export function AddToCartButton({ product, quantity = 1, className = '' }) {
  const shopping = useShopping();
  const { auth, requireCustomer } = useProtectedAction();
  const [message, setMessage] = useState('');
  const available = product.availability.canAddToCart;
  const validQuantity =
    Number.isInteger(quantity) &&
    quantity >= 1 &&
    quantity <= MAX_CART_ITEM_QUANTITY;
  const disabled =
    !available ||
    !validQuantity ||
    auth.status === 'loading' ||
    auth.status === 'error' ||
    (auth.status === 'authenticated' && !shopping.cartReady) ||
    shopping.cartPending;
  const add = async () => {
    setMessage('');
    if (!requireCustomer()) return;
    try {
      await shopping.addToCart(product, quantity);
      setMessage(`${quantity} added to cart.`);
    } catch (error) {
      setMessage(
        safeMessage(error, 'Could not add to cart. Please try again.'),
      );
    }
  };
  return (
    <div className={className}>
      <button
        aria-label={
          available
            ? `Add ${product.name} to cart`
            : `${product.name} is out of stock`
        }
        className="button-primary w-full"
        disabled={disabled}
        onClick={add}
        type="button"
      >
        {shopping.cartPending
          ? 'Adding…'
          : available
            ? 'Add to cart'
            : 'Out of stock'}
      </button>
      <p className="action-feedback" role="status" aria-live="polite">
        {message}
      </p>
    </div>
  );
}

export function ProductPurchaseActions({ product }) {
  const [quantity, setQuantity] = useState(1);
  const [quantityError, setQuantityError] = useState('');
  const available = product.availability.canAddToCart;
  const changeQuantity = (event) => {
    const value = Number(event.target.value);
    setQuantity(value);
    setQuantityError(
      Number.isInteger(value) && value >= 1 && value <= MAX_CART_ITEM_QUANTITY
        ? ''
        : 'Choose a whole number from 1 through 99.',
    );
  };
  return (
    <div className="product-purchase-panel">
      <div className="flex items-end gap-3">
        <label className="font-semibold" htmlFor="product-quantity">
          Quantity
          <input
            aria-describedby="product-availability product-quantity-error"
            aria-invalid={Boolean(quantityError)}
            className="form-input mt-1 w-24"
            disabled={!available}
            id="product-quantity"
            inputMode="numeric"
            max={MAX_CART_ITEM_QUANTITY}
            min="1"
            name="quantity"
            onChange={changeQuantity}
            step="1"
            type="number"
            value={quantity}
          />
        </label>
        <WishlistButton product={product} />
      </div>
      <p
        className="mt-2 min-h-5 text-sm text-red-800"
        id="product-quantity-error"
      >
        {quantityError}
      </p>
      <AddToCartButton
        className="mt-2"
        product={product}
        quantity={quantityError ? 0 : quantity}
      />
    </div>
  );
}
