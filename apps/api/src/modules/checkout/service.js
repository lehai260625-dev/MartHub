import {
  checkoutQuoteInputSchema,
  checkoutQuoteSchema,
  MAX_CART_ITEM_QUANTITY,
} from '@marthub/contracts';
import { ApiError } from '../../middleware/platform.js';
import { requireOwnedResource } from '../auth/authorization.js';
import { createAddressService } from '../addresses/service.js';
import { createCatalogService } from '../catalog/service.js';
import { calculateQuoteTotals, quoteMoney } from './pricing.js';

export function createCheckoutService({ prisma, shippingPolicy }) {
  return {
    async quote(auth, input) {
      const parsed = checkoutQuoteInputSchema.safeParse(input);
      if (!parsed.success)
        throw new ApiError(
          422,
          'VALIDATION_ERROR',
          'Check the submitted fields.',
          parsed.error.issues.map((issue) => ({
            field: issue.path.join('.'),
            message: issue.message,
          })),
        );
      return prisma.$transaction(
        async (tx) => {
          const [{ now }] = await tx.$queryRaw`SELECT CURRENT_TIMESTAMP AS now`;
          const address = requireOwnedResource(
            (await createAddressService({ prisma: tx }).list(auth)).find(
              ({ id }) => id === parsed.data.addressId,
            ),
          );
          const cart = await tx.cart.findFirst({
            where: {
              userId: auth.user.id,
              checkedOutAt: null,
              archivedAt: null,
            },
            select: {
              id: true,
              items: {
                orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
                select: { id: true, productId: true, quantity: true },
              },
            },
          });
          if (!cart?.items.length)
            throw new ApiError(
              409,
              'CART_EMPTY',
              'Add items to your cart before checkout.',
            );
          const ids = cart.items.map(({ productId }) => productId);
          const cards = await createCatalogService({
            prisma: tx,
          }).getProductCardsByIds(ids);
          const byId = new Map(cards.map((card) => [card.id, card]));
          const inventories = await tx.inventory.findMany({
            where: { productId: { in: ids } },
            select: { productId: true, quantityOnHand: true },
          });
          const stockById = new Map(
            inventories.map((row) => [row.productId, row.quantityOnHand]),
          );
          const items = cart.items.map((item) => {
            if (
              !Number.isInteger(item.quantity) ||
              item.quantity < 1 ||
              item.quantity > MAX_CART_ITEM_QUANTITY
            )
              throw new ApiError(
                422,
                'VALIDATION_ERROR',
                'Cart quantity is invalid.',
              );
            const product = byId.get(item.productId);
            const stock = stockById.get(item.productId) ?? 0;
            if (!product || stock < item.quantity)
              throw new ApiError(
                409,
                'PRODUCT_UNAVAILABLE',
                'A cart product is currently unavailable.',
                [{ itemId: item.id, productId: item.productId }],
              );
            return {
              itemId: item.id,
              productId: product.id,
              sku: product.sku,
              name: product.name,
              quantity: item.quantity,
              stock,
              unitPrice: product.price,
              compareAtPrice: product.compareAtPrice,
              lineTotal: quoteMoney(
                BigInt(product.price) * BigInt(item.quantity),
              ),
            };
          });
          return checkoutQuoteSchema.parse({
            cartId: cart.id,
            address,
            currency: 'VND',
            items,
            ...calculateQuoteTotals(items, shippingPolicy),
            quotedAt: now.toISOString(),
            expiresAt: new Date(now.getTime() + 5 * 60_000).toISOString(),
          });
        },
        { isolationLevel: 'RepeatableRead' },
      );
    },
  };
}
