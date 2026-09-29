import {
  cartAddSchema,
  cartQuantityUpdateSchema,
  cartSchema,
  MAX_CART_ITEM_QUANTITY,
} from '@marthub/contracts';
import { ApiError } from '../../middleware/platform.js';
import {
  ownedResourceId,
  requireOwnedResource,
} from '../auth/authorization.js';
import { createCatalogService } from '../catalog/service.js';

function parse(schema, input) {
  const result = schema.safeParse(input);
  if (!result.success)
    throw new ApiError(
      422,
      'VALIDATION_ERROR',
      'Check the submitted fields.',
      result.error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
      })),
    );
  return result.data;
}

async function lockUser(tx, userId) {
  await tx.$queryRaw`SELECT "id" FROM "users" WHERE "id" = ${userId}::uuid FOR UPDATE`;
}

async function readCart(db, userId) {
  const cart = await db.cart.findFirst({
    where: { userId, checkedOutAt: null, archivedAt: null },
    select: {
      id: true,
      items: {
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: { id: true, productId: true, quantity: true },
      },
    },
  });
  if (!cart) return cartSchema.parse({ id: null, items: [], itemCount: 0 });

  const cards = await createCatalogService({ prisma: db }).getProductCardsByIds(
    cart.items.map(({ productId }) => productId),
  );
  const byId = new Map(cards.map((product) => [product.id, product]));
  const items = cart.items.map((item) => {
    const product = byId.get(item.productId) ?? null;
    return {
      ...item,
      product,
      availability: product?.availability.status ?? 'UNAVAILABLE',
    };
  });
  return cartSchema.parse({
    id: cart.id,
    items,
    itemCount: items.reduce((total, item) => total + item.quantity, 0),
  });
}

function quantityLimitExceeded(productId, resultingQuantity) {
  return new ApiError(422, 'VALIDATION_ERROR', 'Check the submitted fields.', [
    {
      field: 'quantity',
      message: `Resulting cart item quantity must not exceed ${MAX_CART_ITEM_QUANTITY}.`,
      productId,
      maximum: MAX_CART_ITEM_QUANTITY,
      resultingQuantity,
    },
  ]);
}

async function findOwnedActiveItem(tx, auth, itemId, select) {
  return requireOwnedResource(
    await tx.cartItem.findFirst({
      where: {
        id: ownedResourceId(itemId),
        cart: {
          userId: auth.user.id,
          checkedOutAt: null,
          archivedAt: null,
        },
      },
      select,
    }),
  );
}

export function createCartService({ prisma }) {
  return {
    async get(auth) {
      return readCart(prisma, auth.user.id);
    },

    async add(auth, input) {
      const data = parse(cartAddSchema, input);
      return prisma.$transaction(async (tx) => {
        await lockUser(tx, auth.user.id);
        const [product] = await createCatalogService({
          prisma: tx,
        }).getProductCardsByIds([data.productId]);
        if (!product)
          throw new ApiError(404, 'NOT_FOUND', 'Resource not found.');
        if (!product.availability.canAddToCart)
          throw new ApiError(
            409,
            'PRODUCT_UNAVAILABLE',
            'Product is currently unavailable.',
            [{ field: 'productId', productId: data.productId }],
          );

        let cart = await tx.cart.findFirst({
          where: {
            userId: auth.user.id,
            checkedOutAt: null,
            archivedAt: null,
          },
          select: { id: true },
        });
        cart ??= await tx.cart.create({
          data: { userId: auth.user.id },
          select: { id: true },
        });

        const existing = await tx.cartItem.findUnique({
          where: {
            cartId_productId: {
              cartId: cart.id,
              productId: data.productId,
            },
          },
          select: { id: true, quantity: true },
        });
        const resultingQuantity = (existing?.quantity ?? 0) + data.quantity;
        if (resultingQuantity > MAX_CART_ITEM_QUANTITY)
          throw quantityLimitExceeded(data.productId, resultingQuantity);

        if (existing)
          await tx.cartItem.update({
            where: { id: existing.id },
            data: { quantity: resultingQuantity },
          });
        else
          await tx.cartItem.create({
            data: {
              cartId: cart.id,
              productId: data.productId,
              quantity: data.quantity,
            },
          });

        return readCart(tx, auth.user.id);
      });
    },

    async update(auth, itemId, input) {
      const data = parse(cartQuantityUpdateSchema, input);
      return prisma.$transaction(async (tx) => {
        await lockUser(tx, auth.user.id);
        const item = await findOwnedActiveItem(tx, auth, itemId, {
          id: true,
          productId: true,
          quantity: true,
        });
        const [product] = await createCatalogService({
          prisma: tx,
        }).getProductCardsByIds([item.productId]);
        if (!product?.availability.canAddToCart)
          throw new ApiError(
            409,
            'PRODUCT_UNAVAILABLE',
            'Product is currently unavailable.',
            [
              {
                field: 'itemId',
                itemId: item.id,
                productId: item.productId,
                availability: product?.availability.status ?? 'UNAVAILABLE',
              },
            ],
          );
        if (item.quantity !== data.quantity)
          await tx.cartItem.update({
            where: { id: item.id },
            data: { quantity: data.quantity },
          });
        return readCart(tx, auth.user.id);
      });
    },

    async remove(auth, itemId) {
      return prisma.$transaction(async (tx) => {
        await lockUser(tx, auth.user.id);
        const item = await findOwnedActiveItem(tx, auth, itemId, { id: true });
        await tx.cartItem.delete({ where: { id: item.id } });
        return readCart(tx, auth.user.id);
      });
    },

    async clear(auth) {
      return prisma.$transaction(async (tx) => {
        await lockUser(tx, auth.user.id);
        const cart = await tx.cart.findFirst({
          where: {
            userId: auth.user.id,
            checkedOutAt: null,
            archivedAt: null,
          },
          select: { id: true },
        });
        if (cart) await tx.cartItem.deleteMany({ where: { cartId: cart.id } });
        return readCart(tx, auth.user.id);
      });
    },
  };
}
