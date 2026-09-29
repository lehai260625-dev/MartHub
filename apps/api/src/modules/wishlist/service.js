import { wishlistSchema } from '@marthub/contracts';
import { ApiError } from '../../middleware/platform.js';
import { ownedResourceId } from '../auth/authorization.js';
import { createCatalogService } from '../catalog/service.js';

async function lockUser(tx, userId) {
  await tx.$queryRaw`SELECT "id" FROM "users" WHERE "id" = ${userId}::uuid FOR UPDATE`;
}

async function readWishlist(db, userId) {
  const wishlist = await db.wishlist.findUnique({
    where: { userId },
    select: {
      id: true,
      items: {
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: { id: true, productId: true },
      },
    },
  });
  if (!wishlist)
    return wishlistSchema.parse({ id: null, items: [], itemCount: 0 });

  const cards = await createCatalogService({ prisma: db }).getProductCardsByIds(
    wishlist.items.map(({ productId }) => productId),
  );
  const byId = new Map(cards.map((product) => [product.id, product]));
  const items = wishlist.items.map((item) => {
    const product = byId.get(item.productId) ?? null;
    return {
      ...item,
      product,
      availability: product?.availability.status ?? 'UNAVAILABLE',
    };
  });
  return wishlistSchema.parse({
    id: wishlist.id,
    items,
    itemCount: items.length,
  });
}

export function createWishlistService({ prisma }) {
  return {
    async get(auth) {
      return readWishlist(prisma, auth.user.id);
    },

    async add(auth, productIdInput) {
      const productId = ownedResourceId(productIdInput);
      return prisma.$transaction(async (tx) => {
        await lockUser(tx, auth.user.id);
        let wishlist = await tx.wishlist.findUnique({
          where: { userId: auth.user.id },
          select: { id: true },
        });
        if (wishlist) {
          const existing = await tx.wishlistItem.findUnique({
            where: {
              wishlistId_productId: { wishlistId: wishlist.id, productId },
            },
            select: { id: true },
          });
          if (existing) return readWishlist(tx, auth.user.id);
        }

        const [product] = await createCatalogService({
          prisma: tx,
        }).getProductCardsByIds([productId]);
        if (!product)
          throw new ApiError(404, 'NOT_FOUND', 'Resource not found.');

        wishlist ??= await tx.wishlist.create({
          data: { userId: auth.user.id },
          select: { id: true },
        });
        await tx.wishlistItem.create({
          data: { wishlistId: wishlist.id, productId },
        });
        return readWishlist(tx, auth.user.id);
      });
    },

    async remove(auth, productIdInput) {
      const productId = ownedResourceId(productIdInput);
      return prisma.$transaction(async (tx) => {
        await lockUser(tx, auth.user.id);
        const wishlist = await tx.wishlist.findUnique({
          where: { userId: auth.user.id },
          select: { id: true },
        });
        if (wishlist)
          await tx.wishlistItem.deleteMany({
            where: { wishlistId: wishlist.id, productId },
          });
      });
    },
  };
}
