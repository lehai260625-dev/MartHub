import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { validateDatabaseUrl } from '../../src/config/env.js';
import { createDatabase } from '../../src/db/client.js';

async function fixture(t) {
  const database = createDatabase(
    validateDatabaseUrl(process.env.DATABASE_URL),
  );
  const { prisma } = database;
  const suffix = randomUUID();
  const [firstUser, secondUser, category] = await Promise.all([
    prisma.user.create({
      data: {
        email: `cart-${suffix}@example.test`,
        passwordHash: 'test-hash',
        firstName: 'Cart',
        lastName: 'Owner',
      },
    }),
    prisma.user.create({
      data: {
        email: `wishlist-${suffix}@example.test`,
        passwordHash: 'test-hash',
        firstName: 'Wishlist',
        lastName: 'Owner',
      },
    }),
    prisma.category.create({
      data: { name: 'Collection test', slug: `collection-${suffix}` },
    }),
  ]);
  const products = await Promise.all(
    ['first', 'second'].map((label) =>
      prisma.product.create({
        data: {
          categoryId: category.id,
          sku: `COLLECTION-${label}-${suffix}`,
          name: `${label} collection product`,
          slug: `${label}-collection-${suffix}`,
          sellingUnit: 'each',
        },
      }),
    ),
  );

  t.after(async () => {
    await prisma.user.deleteMany({
      where: { id: { in: [firstUser.id, secondUser.id] } },
    });
    await prisma.product.deleteMany({
      where: { id: { in: products.map((product) => product.id) } },
    });
    await prisma.category.delete({ where: { id: category.id } });
    await database.close();
  });

  return { prisma, firstUser, secondUser, products };
}

async function checkViolation(prisma, sql, expectedCode = '23514') {
  await assert.rejects(prisma.$executeRawUnsafe(sql), (error) => {
    assert.equal(error.code, 'P2010');
    assert.match(error.message, new RegExp('Code: `' + expectedCode + '`'));
    return true;
  });
}

test('cart schema permits history while enforcing one active cart and one product row per cart', async (t) => {
  const { prisma, firstUser, products } = await fixture(t);
  const active = await prisma.cart.create({ data: { userId: firstUser.id } });

  await assert.rejects(prisma.cart.create({ data: { userId: firstUser.id } }), {
    code: 'P2002',
  });

  await Promise.all([
    prisma.cart.create({
      data: { userId: firstUser.id, checkedOutAt: new Date() },
    }),
    prisma.cart.create({
      data: { userId: firstUser.id, archivedAt: new Date() },
    }),
  ]);

  await prisma.cartItem.create({
    data: { cartId: active.id, productId: products[0].id, quantity: 1 },
  });
  await assert.rejects(
    prisma.cartItem.create({
      data: { cartId: active.id, productId: products[0].id, quantity: 2 },
    }),
    { code: 'P2002' },
  );
  await checkViolation(
    prisma,
    `INSERT INTO cart_items (id, cart_id, product_id, quantity, updated_at) VALUES ('${randomUUID()}', '${active.id}', '${products[1].id}', 0, CURRENT_TIMESTAMP)`,
  );

  assert.equal(await prisma.cart.count({ where: { userId: firstUser.id } }), 3);
  assert.equal(
    await prisma.cartItem.count({ where: { cartId: active.id } }),
    1,
  );
});

test('wishlist schema enforces one wishlist per user and one product row per wishlist', async (t) => {
  const { prisma, firstUser, secondUser, products } = await fixture(t);
  const firstWishlist = await prisma.wishlist.create({
    data: { userId: firstUser.id },
  });

  await assert.rejects(
    prisma.wishlist.create({ data: { userId: firstUser.id } }),
    { code: 'P2002' },
  );

  await prisma.wishlistItem.create({
    data: { wishlistId: firstWishlist.id, productId: products[0].id },
  });
  await assert.rejects(
    prisma.wishlistItem.create({
      data: { wishlistId: firstWishlist.id, productId: products[0].id },
    }),
    { code: 'P2002' },
  );

  const secondWishlist = await prisma.wishlist.create({
    data: { userId: secondUser.id },
  });
  await prisma.wishlistItem.create({
    data: { wishlistId: secondWishlist.id, productId: products[0].id },
  });

  assert.equal(
    await prisma.wishlistItem.count({
      where: { productId: products[0].id },
    }),
    2,
  );
});
