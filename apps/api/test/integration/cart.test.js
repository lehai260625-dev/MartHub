import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import test from 'node:test';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { readAuthConfig } from '../../src/config/auth.js';
import { validateDatabaseUrl } from '../../src/config/env.js';
import { createDatabase } from '../../src/db/client.js';
import { createSessionService } from '../../src/modules/auth/sessions.js';

const config = readAuthConfig({
  AUTH_JWT_SECRET: randomBytes(32).toString('hex'),
  WEB_ORIGIN: 'https://shop.example.test',
  NODE_ENV: 'production',
});
const bearer = (token) => `Bearer ${token}`;

async function setup(t) {
  const database = createDatabase(
    validateDatabaseUrl(process.env.DATABASE_URL),
  );
  const { prisma } = database;
  const suffix = randomUUID();
  const users = await Promise.all(
    ['CUSTOMER', 'CUSTOMER', 'ADMIN'].map((role, index) =>
      prisma.user.create({
        data: {
          email: `cart-${index}-${suffix}@example.test`,
          passwordHash: 'unused-test-hash',
          firstName: 'Cart',
          lastName: role,
          role,
        },
      }),
    ),
  );
  const category = await prisma.category.create({
    data: { name: 'Cart fixtures', slug: `cart-fixtures-${suffix}` },
  });
  const products = await Promise.all(
    [
      ['active', 'ACTIVE'],
      ['out-of-stock', 'ACTIVE'],
      ['draft', 'DRAFT'],
    ].map(([label, status]) =>
      prisma.product.create({
        data: {
          categoryId: category.id,
          sku: `CART-${label}-${suffix}`,
          name: `${label} cart product`,
          slug: `${label}-cart-${suffix}`,
          shortDescription: `${label} current description`,
          sellingUnit: 'each',
          status,
        },
      }),
    ),
  );
  await Promise.all(
    products.map((product) =>
      prisma.productPriceHistory.create({
        data: {
          productId: product.id,
          price: 9007199254740993n,
          startsAt: new Date('2020-01-01T00:00:00Z'),
        },
      }),
    ),
  );
  await Promise.all(
    products.map((product, index) =>
      prisma.inventory.create({
        data: {
          productId: product.id,
          quantityOnHand: index === 1 ? 0 : 10,
        },
      }),
    ),
  );
  const sessions = createSessionService({ prisma, config });
  const tokens = await Promise.all(
    users.map(async ({ id }) => (await sessions.issue(id)).data.accessToken),
  );

  t.after(async () => {
    await prisma.user.deleteMany({
      where: { id: { in: users.map(({ id }) => id) } },
    });
    await prisma.productPriceHistory.deleteMany({
      where: { productId: { in: products.map(({ id }) => id) } },
    });
    await prisma.inventory.deleteMany({
      where: { productId: { in: products.map(({ id }) => id) } },
    });
    await prisma.product.deleteMany({
      where: { id: { in: products.map(({ id }) => id) } },
    });
    await prisma.category.delete({ where: { id: category.id } });
    await database.close();
  });

  return {
    app: createApp({
      prisma,
      authConfig: config,
      origin: config.origin,
      logger: () => {},
    }),
    prisma,
    users,
    tokens,
    products,
  };
}

test('cart read/add is Customer-only, owner-scoped, no-store, and returns current catalog data', async (t) => {
  const { app, prisma, users, tokens, products } = await setup(t);
  await request(app).get('/api/v1/cart').expect(401);
  await request(app)
    .get('/api/v1/cart')
    .set('Authorization', bearer(tokens[2]))
    .expect(403);

  const empty = await request(app)
    .get('/api/v1/cart')
    .set('Authorization', bearer(tokens[0]))
    .expect(200);
  assert.deepEqual(empty.body, {
    data: { id: null, items: [], itemCount: 0 },
  });
  assert.match(empty.headers['cache-control'], /no-store/);
  assert.equal(await prisma.cart.count(), 0);

  const added = await request(app)
    .post('/api/v1/cart/items')
    .set('Authorization', bearer(tokens[0]))
    .send({ productId: products[0].id, quantity: 2 })
    .expect(200);
  assert.equal(added.body.data.itemCount, 2);
  assert.equal(added.body.data.items[0].quantity, 2);
  assert.equal(added.body.data.items[0].product.price, '9007199254740993');
  assert.equal(
    added.body.data.items[0].product.shortDescription,
    'active current description',
  );
  assert.deepEqual(added.body.data.items[0].product.availability, {
    status: 'IN_STOCK',
    canAddToCart: true,
  });
  assert.equal(Object.hasOwn(added.body.data, 'userId'), false);

  const other = await request(app)
    .get('/api/v1/cart')
    .set('Authorization', bearer(tokens[1]))
    .expect(200);
  assert.deepEqual(other.body, {
    data: { id: null, items: [], itemCount: 0 },
  });
  assert.equal(await prisma.cart.count({ where: { userId: users[0].id } }), 1);
  await request(app)
    .get('/api/v1/cart?userId=' + users[0].id)
    .set('Authorization', bearer(tokens[1]))
    .expect(422);
});

test('cart add upserts one product row and rejects accumulated quantity above 99 without clamping', async (t) => {
  const { app, prisma, users, tokens, products } = await setup(t);
  const first = await request(app)
    .post('/api/v1/cart/items')
    .set('Authorization', bearer(tokens[0]))
    .send({ productId: products[0].id, quantity: 40 })
    .expect(200);
  const itemId = first.body.data.items[0].id;
  const maximum = await request(app)
    .post('/api/v1/cart/items')
    .set('Authorization', bearer(tokens[0]))
    .send({ productId: products[0].id, quantity: 59 })
    .expect(200);
  assert.equal(maximum.body.data.items[0].id, itemId);
  assert.equal(maximum.body.data.items[0].quantity, 99);
  assert.equal(maximum.body.data.itemCount, 99);

  const overflow = await request(app)
    .post('/api/v1/cart/items')
    .set('Authorization', bearer(tokens[0]))
    .send({ productId: products[0].id, quantity: 1 })
    .expect(422);
  assert.equal(overflow.body.error.code, 'VALIDATION_ERROR');
  assert.equal(overflow.body.error.details[0].maximum, 99);
  assert.equal(overflow.body.error.details[0].resultingQuantity, 100);

  for (const body of [
    { productId: products[0].id, quantity: 0 },
    { productId: products[0].id, quantity: 100 },
    { productId: products[0].id, quantity: 1.5 },
    { productId: products[0].id, quantity: '1' },
    { productId: products[0].id, quantity: 1, userId: users[1].id },
  ])
    await request(app)
      .post('/api/v1/cart/items')
      .set('Authorization', bearer(tokens[0]))
      .send(body)
      .expect(422);

  const rows = await prisma.cartItem.findMany({
    where: { cart: { userId: users[0].id } },
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].quantity, 99);
});

test('cart reconciles current stock/public visibility without reserving inventory', async (t) => {
  const { app, prisma, tokens, products } = await setup(t);
  await request(app)
    .post('/api/v1/cart/items')
    .set('Authorization', bearer(tokens[0]))
    .send({ productId: products[0].id, quantity: 20 })
    .expect(200);

  await prisma.inventory.update({
    where: { productId: products[0].id },
    data: { quantityOnHand: 0 },
  });
  const outOfStock = await request(app)
    .get('/api/v1/cart')
    .set('Authorization', bearer(tokens[0]))
    .expect(200);
  assert.equal(outOfStock.body.data.items[0].quantity, 20);
  assert.equal(outOfStock.body.data.items[0].availability, 'OUT_OF_STOCK');
  assert.equal(
    outOfStock.body.data.items[0].product.availability.canAddToCart,
    false,
  );
  await request(app)
    .post('/api/v1/cart/items')
    .set('Authorization', bearer(tokens[0]))
    .send({ productId: products[0].id, quantity: 1 })
    .expect(409);

  await prisma.product.update({
    where: { id: products[0].id },
    data: { status: 'ARCHIVED', archivedAt: new Date() },
  });
  const unavailable = await request(app)
    .get('/api/v1/cart')
    .set('Authorization', bearer(tokens[0]))
    .expect(200);
  assert.equal(unavailable.body.data.items[0].availability, 'UNAVAILABLE');
  assert.equal(unavailable.body.data.items[0].product, null);
  await request(app)
    .post('/api/v1/cart/items')
    .set('Authorization', bearer(tokens[0]))
    .send({ productId: products[0].id, quantity: 1 })
    .expect(404);
});

test('rejected products create no cart and concurrent adds retain one row without lost updates', async (t) => {
  const { app, prisma, users, tokens, products } = await setup(t);
  for (const [productId, status] of [
    [products[1].id, 409],
    [products[2].id, 404],
    [randomUUID(), 404],
  ])
    await request(app)
      .post('/api/v1/cart/items')
      .set('Authorization', bearer(tokens[0]))
      .send({ productId, quantity: 1 })
      .expect(status);
  assert.equal(await prisma.cart.count({ where: { userId: users[0].id } }), 0);

  const calls = await Promise.all(
    Array.from({ length: 8 }, () =>
      request(app)
        .post('/api/v1/cart/items')
        .set('Authorization', bearer(tokens[1]))
        .send({ productId: products[0].id, quantity: 1 }),
    ),
  );
  assert.deepEqual(
    calls.map(({ status }) => status),
    Array(8).fill(200),
  );
  const cart = await prisma.cart.findFirstOrThrow({
    where: { userId: users[1].id, checkedOutAt: null, archivedAt: null },
    include: { items: true },
  });
  assert.equal(cart.items.length, 1);
  assert.equal(cart.items[0].quantity, 8);
});
