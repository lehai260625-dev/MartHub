import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import test from 'node:test';
import request from 'supertest';
import { checkoutQuoteResponseSchema } from '@marthub/contracts';
import { createApp } from '../../src/app.js';
import { readAuthConfig } from '../../src/config/auth.js';
import {
  readShippingConfig,
  validateDatabaseUrl,
} from '../../src/config/env.js';
import { createDatabase } from '../../src/db/client.js';
import { createSessionService } from '../../src/modules/auth/sessions.js';
import { createCheckoutService } from '../../src/modules/checkout/service.js';

const config = readAuthConfig({
  AUTH_JWT_SECRET: randomBytes(32).toString('hex'),
  WEB_ORIGIN: 'https://shop.example.test',
  NODE_ENV: 'production',
});
async function setup(t, price = 250000n, quantity = 2) {
  const database = createDatabase(
    validateDatabaseUrl(process.env.DATABASE_URL),
  );
  const { prisma } = database;
  t.after(() => database.close());
  const suffix = randomUUID();
  const users = await Promise.all(
    ['CUSTOMER', 'CUSTOMER', 'ADMIN'].map((role, index) =>
      prisma.user.create({
        data: {
          email: `quote-${suffix}-${index}@example.test`,
          passwordHash: 'unused',
          firstName: 'Quote',
          lastName: 'Test',
          role,
        },
      }),
    ),
  );
  const addresses = await Promise.all(
    users.map((user) =>
      prisma.address.create({
        data: {
          userId: user.id,
          label: 'Home',
          recipientName: 'Quote Test',
          phone: '0901234567',
          line1: '10 Test Street',
          ward: 'Test ward',
          district: 'Test district',
          province: 'Any valid province',
        },
      }),
    ),
  );
  const category = await prisma.category.create({
    data: { name: 'Quote category', slug: `quote-${suffix}` },
  });
  const product = await prisma.product.create({
    data: {
      categoryId: category.id,
      name: 'Quote product',
      slug: `quote-product-${suffix}`,
      sku: `QUOTE-${suffix}`,
      status: 'ACTIVE',
      sellingUnit: 'each',
    },
  });
  await prisma.productPriceHistory.create({
    data: {
      productId: product.id,
      price,
      compareAtPrice: price + 100000n,
      startsAt: new Date('2020-01-01'),
    },
  });
  await prisma.inventory.create({
    data: { productId: product.id, quantityOnHand: 10 },
  });
  const cart = await prisma.cart.create({
    data: {
      userId: users[0].id,
      items: { create: { productId: product.id, quantity } },
    },
    include: { items: true },
  });
  const sessions = createSessionService({ prisma, config });
  const tokens = await Promise.all(
    users.map(async (user) => (await sessions.issue(user.id)).data.accessToken),
  );
  const app = createApp({
    prisma,
    authConfig: config,
    shippingPolicy: readShippingConfig({}),
    origin: config.origin,
    logger: () => {},
  });
  const quote = (
    input = { addressId: addresses[0].id },
    token = tokens[0],
    query = '',
  ) =>
    request(app)
      .post(`/api/v1/checkout/quote${query}`)
      .set('Authorization', `Bearer ${token}`)
      .send(input);
  return {
    prisma,
    app,
    users,
    addresses,
    product,
    category,
    cart,
    tokens,
    quote,
  };
}

test('quote is Customer-only, strict, owner-scoped and no-store', async (t) => {
  const f = await setup(t);
  await request(f.app)
    .post('/api/v1/checkout/quote')
    .send({ addressId: f.addresses[0].id })
    .expect(401);
  await f.quote(undefined, f.tokens[2]).expect(403);
  await f.quote({ addressId: f.addresses[1].id }).expect(404);
  await f.quote({ addressId: randomUUID() }).expect(404);
  for (const input of [
    {},
    { addressId: 'bad' },
    ...['price', 'total', 'stock', 'userId', 'quantity', 'shippingFee'].map(
      (key) => ({ addressId: f.addresses[0].id, [key]: 1 }),
    ),
  ])
    await f.quote(input).expect(422);
  await f.quote(undefined, undefined, '?total=1').expect(422);
  const res = await f.quote().expect(200);
  assert.match(res.headers['cache-control'], /no-store/);
  assert.equal(checkoutQuoteResponseSchema.safeParse(res.body).success, true);
  await f.prisma.address.update({
    where: { id: f.addresses[0].id },
    data: { archivedAt: new Date() },
  });
  await f.quote().expect(404);
});

test('quote uses exact current prices, display-only compare price, server stock and five-minute database timestamps without writes', async (t) => {
  const f = await setup(t, 9007199254740993n);
  const before = await f.prisma.inventory.findUnique({
    where: { productId: f.product.id },
  });
  const ordersBefore = await f.prisma.order.count();
  const [{ now: start }] = await f.prisma
    .$queryRaw`SELECT CURRENT_TIMESTAMP AS now`;
  const { data } = (await f.quote().expect(200)).body;
  const [{ now: end }] = await f.prisma
    .$queryRaw`SELECT CURRENT_TIMESTAMP AS now`;
  assert.equal(data.subtotal, '18014398509481986');
  assert.equal(data.total, data.subtotal);
  assert.equal(data.discountTotal, '0');
  assert.equal(data.shippingFee, '0');
  assert.equal(data.items[0].compareAtPrice, '9007199254840993');
  assert.equal(data.items[0].stock, 10);
  assert.equal(data.items[0].lineTotal, data.subtotal);
  assert.ok(new Date(data.quotedAt) >= start && new Date(data.quotedAt) <= end);
  assert.equal(Date.parse(data.expiresAt) - Date.parse(data.quotedAt), 300000);
  assert.deepEqual(
    await f.prisma.inventory.findUnique({ where: { productId: f.product.id } }),
    before,
  );
  assert.equal(await f.prisma.order.count(), ordersBefore);
  assert.equal(
    await f.prisma.cartItem.count({ where: { cartId: f.cart.id } }),
    1,
  );
  assert.equal(
    (await f.prisma.cart.findUnique({ where: { id: f.cart.id } })).checkedOutAt,
    null,
  );
});

test('shipping boundaries and subsequent quotes reprice at half-open interval boundaries', async (t) => {
  const f = await setup(t, 499999n, 1);
  assert.equal((await f.quote().expect(200)).body.data.total, '529999');
  const [{ now }] = await f.prisma.$queryRaw`SELECT CURRENT_TIMESTAMP AS now`;
  await f.prisma.$transaction(async (tx) => {
    await tx.productPriceHistory.updateMany({
      where: { productId: f.product.id },
      data: { endsAt: now },
    });
    await tx.productPriceHistory.create({
      data: { productId: f.product.id, price: 500000n, startsAt: now },
    });
  });
  const data = (await f.quote().expect(200)).body.data;
  assert.equal(data.items[0].unitPrice, '500000');
  assert.equal(data.shippingFee, '0');
  assert.equal(data.total, '500000');
  assert.equal(data.items[0].compareAtPrice, null);
  const [{ now: later }] = await f.prisma
    .$queryRaw`SELECT CURRENT_TIMESTAMP AS now`;
  await f.prisma.$transaction(async (tx) => {
    await tx.productPriceHistory.updateMany({
      where: { productId: f.product.id, endsAt: null },
      data: { endsAt: later },
    });
    await tx.productPriceHistory.create({
      data: { productId: f.product.id, price: 500001n, startsAt: later },
    });
  });
  assert.equal((await f.quote().expect(200)).body.data.total, '500001');
});

test('empty, hidden, archived, missing-price and insufficient-stock carts reject without mutation', async (t) => {
  const f = await setup(t);
  const inventoryBefore = await f.prisma.inventory.findUnique({
    where: { productId: f.product.id },
  });
  for (const change of [
    { status: 'DRAFT' },
    { status: 'ACTIVE', archivedAt: new Date() },
  ]) {
    await f.prisma.product.update({
      where: { id: f.product.id },
      data: change,
    });
    assert.equal(
      (await f.quote().expect(409)).body.error.code,
      'PRODUCT_UNAVAILABLE',
    );
  }
  await f.prisma.product.update({
    where: { id: f.product.id },
    data: { status: 'ACTIVE', archivedAt: null },
  });
  await f.prisma.category.update({
    where: { id: f.category.id },
    data: { status: 'ARCHIVED', archivedAt: new Date() },
  });
  await f.quote().expect(409);
  await f.prisma.category.update({
    where: { id: f.category.id },
    data: { status: 'ACTIVE', archivedAt: null },
  });
  await f.prisma.cartItem.update({
    where: { id: f.cart.items[0].id },
    data: { quantity: 11 },
  });
  await f.quote().expect(409);
  await f.prisma.cartItem.update({
    where: { id: f.cart.items[0].id },
    data: { quantity: 2 },
  });
  await f.prisma.productPriceHistory.deleteMany({
    where: { productId: f.product.id },
  });
  await f.quote().expect(409);
  assert.deepEqual(
    await f.prisma.inventory.findUnique({ where: { productId: f.product.id } }),
    inventoryBefore,
  );
  assert.equal(
    await f.prisma.cartItem.count({ where: { cartId: f.cart.id } }),
    1,
  );
  assert.equal(
    (await f.quote({ addressId: f.addresses[1].id }, f.tokens[1]).expect(409))
      .body.error.code,
    'CART_EMPTY',
  );
  assert.equal(
    await f.prisma.cart.count({ where: { userId: f.users[1].id } }),
    0,
  );
});

test('quote rejects exact monetary overflow rather than returning rounded or oversized totals', async (t) => {
  const f = await setup(t, 5000000000000000000n);
  assert.equal(
    (await f.quote().expect(422)).body.error.code,
    'VALIDATION_ERROR',
  );
  assert.equal(
    (
      await f.prisma.inventory.findUnique({
        where: { productId: f.product.id },
      })
    ).quantityOnHand,
    10,
  );
});

test('quote snapshot stays consistent during a concurrent inventory change; next quote sees the change', async (t) => {
  const f = await setup(t);
  const wrapped = {
    $transaction: (callback, options) =>
      f.prisma.$transaction(async (tx) => {
        const inventory = {
          findMany: async (args) => {
            await f.prisma.inventory.update({
              where: { productId: f.product.id },
              data: { quantityOnHand: 0 },
            });
            return tx.inventory.findMany(args);
          },
        };
        return callback(
          new Proxy(tx, {
            get: (target, key) =>
              key === 'inventory' ? inventory : target[key],
          }),
        );
      }, options),
  };
  const data = await createCheckoutService({
    prisma: wrapped,
    shippingPolicy: readShippingConfig({}),
  }).quote({ user: f.users[0] }, { addressId: f.addresses[0].id });
  assert.equal(data.items[0].stock, 10);
  await f.quote().expect(409);
});

test('quote sums multiple lines deterministically, ignores future price and honors configured shipping', async (t) => {
  const f = await setup(t, 10000n, 99);
  await f.prisma.inventory.update({
    where: { productId: f.product.id },
    data: { quantityOnHand: 99 },
  });
  const future = new Date(Date.now() + 86400000);
  await f.prisma.$transaction(async (tx) => {
    await tx.productPriceHistory.updateMany({
      where: { productId: f.product.id },
      data: { endsAt: future },
    });
    await tx.productPriceHistory.create({
      data: { productId: f.product.id, price: 20000n, startsAt: future },
    });
  });
  const second = await f.prisma.product.create({
    data: {
      categoryId: f.category.id,
      name: 'Second quote product',
      slug: `second-${randomUUID()}`,
      sku: `SECOND-${randomUUID()}`,
      status: 'ACTIVE',
      sellingUnit: 'each',
    },
  });
  await f.prisma.productPriceHistory.create({
    data: {
      productId: second.id,
      price: 100n,
      startsAt: new Date('2020-01-01'),
    },
  });
  await f.prisma.inventory.create({
    data: { productId: second.id, quantityOnHand: 2 },
  });
  const secondItem = await f.prisma.cartItem.create({
    data: { cartId: f.cart.id, productId: second.id, quantity: 2 },
  });
  const customApp = createApp({
    prisma: f.prisma,
    authConfig: config,
    shippingPolicy: readShippingConfig({
      SHIPPING_FIXED_FEE_VND: '100',
      SHIPPING_FREE_THRESHOLD_VND: '1000000',
    }),
    origin: config.origin,
    logger: () => {},
  });
  const get = () =>
    request(customApp)
      .post('/api/v1/checkout/quote')
      .set('Authorization', `Bearer ${f.tokens[0]}`)
      .send({ addressId: f.addresses[0].id });
  const data = (await get().expect(200)).body.data;
  assert.equal(data.items[0].unitPrice, '10000');
  assert.equal(data.items[0].quantity, 99);
  assert.equal(data.subtotal, '990200');
  assert.equal(data.shippingFee, '100');
  assert.equal(data.total, '990300');
  assert.deepEqual(
    data.items.map(({ itemId }) => itemId),
    [f.cart.items[0].id, secondItem.id],
  );
  assert.deepEqual((await get().expect(200)).body.data.items, data.items);
  await f.prisma.product.update({
    where: { id: second.id },
    data: { status: 'DRAFT' },
  });
  await get().expect(409);
  assert.equal(
    await f.prisma.cartItem.count({ where: { cartId: f.cart.id } }),
    2,
  );
  await request(f.app)
    .post('/api/v1/checkout/orders')
    .set('Authorization', `Bearer ${f.tokens[0]}`)
    .send({ addressId: f.addresses[0].id })
    .expect(422);
});
