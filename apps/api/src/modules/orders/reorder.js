import {
  MAX_CART_ITEM_QUANTITY,
  reorderInputSchema,
  reorderResponseSchema,
} from '@marthub/contracts';
import { ApiError } from '../../middleware/platform.js';
import {
  ownedResourceId,
  ownedWhere,
  requireOwnedResource,
} from '../auth/authorization.js';
import { createCatalogService } from '../catalog/service.js';

export function createReorderService({ prisma }) {
  return {
    async reorder(auth, id, input) {
      const orderId = ownedResourceId(id);
      if (!reorderInputSchema.safeParse(input).success)
        throw new ApiError(
          422,
          'VALIDATION_ERROR',
          'This endpoint accepts no request fields.',
        );
      return prisma.$transaction(
        async (tx) => {
          // Same serialization point as cart writes, checkout and cancellation.
          await tx.$queryRaw`SELECT "id" FROM "users" WHERE "id" = ${auth.user.id}::uuid FOR UPDATE`;
          const order = requireOwnedResource(
            await tx.order.findFirst({
              where: ownedWhere(auth, { id: orderId }),
              select: {
                items: {
                  orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
                  select: { productId: true, quantity: true },
                },
              },
            }),
          );
          const cards = await createCatalogService({
            prisma: tx,
          }).getProductCardsByIds(order.items.map((item) => item.productId));
          const byId = new Map(cards.map((card) => [card.id, card]));
          let cart = await tx.cart.findFirst({
            where: {
              userId: auth.user.id,
              checkedOutAt: null,
              archivedAt: null,
            },
            select: { id: true },
          });
          const added = [],
            skipped = [];
          for (const item of order.items) {
            const product = byId.get(item.productId);
            if (!product) {
              skipped.push({
                productId: item.productId,
                reason: 'UNAVAILABLE',
              });
              continue;
            }
            if (!product.availability.canAddToCart) {
              skipped.push({
                productId: item.productId,
                reason: 'OUT_OF_STOCK',
              });
              continue;
            }
            const existing = cart
              ? await tx.cartItem.findUnique({
                  where: {
                    cartId_productId: {
                      cartId: cart.id,
                      productId: item.productId,
                    },
                  },
                  select: { id: true, quantity: true },
                })
              : null;
            const quantity = (existing?.quantity ?? 0) + item.quantity;
            if (quantity > MAX_CART_ITEM_QUANTITY) {
              skipped.push({
                productId: item.productId,
                reason: 'QUANTITY_LIMITED',
              });
              continue;
            }
            cart ??= await tx.cart.create({
              data: { userId: auth.user.id },
              select: { id: true },
            });
            if (existing)
              await tx.cartItem.update({
                where: { id: existing.id },
                data: { quantity },
              });
            else
              await tx.cartItem.create({
                data: {
                  cartId: cart.id,
                  productId: item.productId,
                  quantity: item.quantity,
                },
              });
            added.push({
              productId: item.productId,
              quantity: item.quantity,
              currentUnitPrice: product.price,
            });
          }
          return reorderResponseSchema.parse({
            data: { cartId: cart?.id ?? null, added, skipped },
          });
        },
        { isolationLevel: 'ReadCommitted' },
      );
    },
  };
}
