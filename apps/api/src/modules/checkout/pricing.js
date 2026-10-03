import { moneySchema } from '@marthub/contracts';
import { ApiError } from '../../middleware/platform.js';

export function quoteMoney(value) {
  const text = value.toString();
  if (!moneySchema.safeParse(text).success)
    throw new ApiError(
      422,
      'VALIDATION_ERROR',
      'Checkout amount exceeds the supported money range.',
    );
  return text;
}

export function calculateQuoteTotals(items, policy) {
  const subtotal = items.reduce(
    (sum, item) => sum + BigInt(item.unitPrice) * BigInt(item.quantity),
    0n,
  );
  const shippingFee = subtotal >= policy.freeThreshold ? 0n : policy.fixedFee;
  return {
    subtotal: quoteMoney(subtotal),
    shippingFee: quoteMoney(shippingFee),
    discountTotal: '0',
    total: quoteMoney(subtotal + shippingFee),
  };
}
