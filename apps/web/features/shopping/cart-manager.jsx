'use client';

import { useState } from 'react';
import Link from 'next/link';
import { MAX_CART_ITEM_QUANTITY } from '@marthub/contracts';
import { formatVnd } from '../catalog/catalog-query';
import { useShopping } from './shopping-provider';

function CartLine({ item }) {
  const shopping = useShopping();
  const [quantity, setQuantity] = useState(item.quantity);
  const [message, setMessage] = useState('');
  const available = item.availability === 'IN_STOCK' && item.product;
  const update = async (event) => {
    event.preventDefault();
    setMessage('');
    const next = Number(quantity);
    if (!Number.isInteger(next) || next < 1 || next > MAX_CART_ITEM_QUANTITY) {
      setQuantity(item.quantity);
      setMessage('Choose a whole quantity from 1 through 99.');
      return;
    }
    try {
      await shopping.updateCartItem(item.id, next);
      setMessage('Quantity updated.');
    } catch (error) {
      setQuantity(item.quantity);
      setMessage(
        error?.code === 'PRODUCT_UNAVAILABLE'
          ? 'This product became unavailable. Remove it from your cart.'
          : 'Quantity could not be updated. Your previous quantity was restored.',
      );
    }
  };
  const remove = async () => {
    setMessage('');
    try {
      await shopping.removeCartItem(item.id);
    } catch {
      setMessage('This item could not be removed. Please try again.');
    }
  };
  return (
    <li className="cart-line">
      <div className="cart-line-product">
        {item.product?.image ? (
          // Catalog media origins are controlled by the API.
          // eslint-disable-next-line @next/next/no-img-element
          <img alt={item.product.image.altText} src={item.product.image.url} />
        ) : (
          <span aria-hidden="true" className="cart-image-placeholder">
            MH
          </span>
        )}
        <div>
          {item.product ? (
            <Link href={`/products/${item.product.slug}`}>
              {item.product.name}
            </Link>
          ) : (
            <strong>Saved cart product unavailable</strong>
          )}
          <p className={available ? 'text-emerald-800' : 'text-red-800'}>
            {item.availability === 'IN_STOCK'
              ? 'In stock'
              : item.availability === 'OUT_OF_STOCK'
                ? 'Out of stock'
                : 'No longer available'}
          </p>
          {item.product ? <p>{formatVnd(item.product.price)}</p> : null}
        </div>
      </div>
      <form className="cart-line-actions" onSubmit={update}>
        <label htmlFor={`quantity-${item.id}`}>Quantity</label>
        <input
          aria-describedby={`cart-message-${item.id}`}
          className="form-input"
          disabled={!available || shopping.cartPending}
          id={`quantity-${item.id}`}
          inputMode="numeric"
          max={MAX_CART_ITEM_QUANTITY}
          min="1"
          onChange={(event) => setQuantity(event.target.value)}
          step="1"
          type="number"
          value={quantity}
        />
        <button
          className="button-secondary"
          disabled={!available || shopping.cartPending}
          type="submit"
        >
          Update
        </button>
        <button
          className="cart-remove"
          disabled={shopping.cartPending}
          onClick={remove}
          type="button"
        >
          Remove
        </button>
      </form>
      <p
        className="cart-line-message"
        id={`cart-message-${item.id}`}
        role={
          message.includes('could not') || message.includes('unavailable')
            ? 'alert'
            : 'status'
        }
        aria-live="polite"
      >
        {message}
      </p>
    </li>
  );
}

export function CartManager() {
  const shopping = useShopping();
  const [message, setMessage] = useState('');
  if (!shopping.cartReady && !shopping.cartError)
    return <p role="status">Loading your cart…</p>;
  if (shopping.cartError)
    return (
      <div className="shopping-error" role="alert">
        <p>We could not load your cart.</p>
        <button
          className="button-secondary"
          onClick={() => shopping.retryCart()}
        >
          Try again
        </button>
      </div>
    );
  if (!shopping.cart.items.length)
    return (
      <div className="shopping-empty">
        <h2>Your cart is empty</h2>
        <p>Browse the catalog to find something useful for your day.</p>
        <Link
          className="button-primary inline-flex items-center"
          href="/categories"
        >
          Browse categories
        </Link>
      </div>
    );
  const availableTotal = shopping.cart.items.reduce(
    (total, item) =>
      total +
      (item.product ? BigInt(item.product.price) * BigInt(item.quantity) : 0n),
    0n,
  );
  const clear = async () => {
    setMessage('');
    try {
      await shopping.clearCart();
      setMessage('Cart cleared.');
    } catch {
      setMessage('Your cart could not be cleared. Please try again.');
    }
  };
  return (
    <div className="cart-layout">
      <section aria-labelledby="cart-items-title">
        <h2 className="sr-only" id="cart-items-title">
          Cart items
        </h2>
        <ul className="cart-lines">
          {shopping.cart.items.map((item) => (
            <CartLine item={item} key={item.id} />
          ))}
        </ul>
        <button
          className="button-secondary mt-5"
          disabled={shopping.cartPending}
          onClick={clear}
          type="button"
        >
          {shopping.cartPending ? 'Updating…' : 'Clear cart'}
        </button>
        <p className="action-feedback" role="status" aria-live="polite">
          {message}
        </p>
      </section>
      <aside className="cart-summary" aria-labelledby="cart-summary-title">
        <h2 id="cart-summary-title">Current summary</h2>
        <dl>
          <div>
            <dt>Items</dt>
            <dd>{shopping.cart.itemCount}</dd>
          </div>
          <div>
            <dt>Available items total</dt>
            <dd>{formatVnd(availableTotal.toString())}</dd>
          </div>
        </dl>
        <p>Prices and stock are checked again during checkout.</p>
      </aside>
    </div>
  );
}
