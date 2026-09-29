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
          email: `wishlist-${index}-${suffix}@example.test`,
          passwordHash: 'unused-test-hash',
          firstName: 'Wishlist',
          lastName: role,
          role,
        },
      }),
    ),
  );
  const category = await prisma.category.create({
    data: { name: 'Wishlist fixtures', slug: `wishlist-fixtures-${suffix}` },
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
          sku: `WISH-${label}-${suffix}`,
          name: `${label} wishlist product`,
          slug: `${label}-wishlist-${suffix}`,
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

test('wishlist list/add is Customer-only, owner-scoped, no-store, and idempotent', async (t) => {
  const { app, prisma, users, tokens, products } = await setup(t);
  await request(app).get('/api/v1/wishlist').expect(401);
  await request(app)
    .get('/api/v1/wishlist')
    .set('Authorization', bearer(tokens[2]))
    .expect(403);
  await request(app)
    .put(`/api/v1/wishlist/items/${products[0].id}`)
    .expect(401);
  await request(app)
    .put(`/api/v1/wishlist/items/${products[0].id}`)
    .set('Authorization', bearer(tokens[2]))
    .expect(403);

  const empty = await request(app)
    .get('/api/v1/wishlist')
    .set('Authorization', bearer(tokens[0]))
    .expect(200);
  assert.deepEqual(empty.body, {
    data: { id: null, items: [], itemCount: 0 },
  });
  assert.match(empty.headers['cache-control'], /no-store/);
  assert.equal(await prisma.wishlist.count(), 0);

  const first = await request(app)
    .put(`/api/v1/wishlist/items/${products[0].id}`)
    .set('Authorization', bearer(tokens[0]))
    .expect(200);
  assert.match(first.headers['cache-control'], /no-store/);
  assert.equal(first.body.data.itemCount, 1);
  assert.equal(first.body.data.items[0].product.price, '9007199254740993');
  assert.equal(first.body.data.items[0].availability, 'IN_STOCK');
  assert.equal(Object.hasOwn(first.body.data, 'userId'), false);
  const repeated = await request(app)
    .put(`/api/v1/wishlist/items/${products[0].id}`)
    .set('Authorization', bearer(tokens[0]))
    .expect(200);
  assert.deepEqual(repeated.body, first.body);
  assert.equal(
    await prisma.wishlistItem.count({
      where: { wishlist: { userId: users[0].id } },
    }),
    1,
  );

  const other = await request(app)
    .get('/api/v1/wishlist')
    .set('Authorization', bearer(tokens[1]))
    .expect(200);
  assert.deepEqual(other.body, {
    data: { id: null, items: [], itemCount: 0 },
  });
});

test('wishlist returns current out-of-stock and unavailable states', async (t) => {
  const { app, prisma, tokens, products } = await setup(t);
  const outOfStock = await request(app)
    .put(`/api/v1/wishlist/items/${products[1].id}`)
    .set('Authorization', bearer(tokens[0]))
    .expect(200);
  assert.equal(outOfStock.body.data.items[0].availability, 'OUT_OF_STOCK');
  assert.equal(
    outOfStock.body.data.items[0].product.availability.canAddToCart,
    false,
  );

  await prisma.product.update({
    where: { id: products[1].id },
    data: { status: 'ARCHIVED', archivedAt: new Date() },
  });
  const unavailable = await request(app)
    .get('/api/v1/wishlist')
    .set('Authorization', bearer(tokens[0]))
    .expect(200);
  assert.equal(unavailable.body.data.items[0].availability, 'UNAVAILABLE');
  assert.equal(unavailable.body.data.items[0].product, null);
  const repeated = await request(app)
    .put(`/api/v1/wishlist/items/${products[1].id}`)
    .set('Authorization', bearer(tokens[0]))
    .expect(200);
  assert.deepEqual(repeated.body, unavailable.body);
  for (const productId of [products[2].id, randomUUID()])
    await request(app)
      .put(`/api/v1/wishlist/items/${productId}`)
      .set('Authorization', bearer(tokens[0]))
      .expect(404);
  assert.equal(unavailable.body.data.itemCount, 1);
});

test('wishlist removal is idempotent, strictly validated, and cannot affect another owner', async (t) => {
  const { app, prisma, users, tokens, products } = await setup(t);
  for (const token of tokens.slice(0, 2))
    await request(app)
      .put(`/api/v1/wishlist/items/${products[0].id}`)
      .set('Authorization', bearer(token))
      .expect(200);

  const removed = await request(app)
    .delete(`/api/v1/wishlist/items/${products[0].id}`)
    .set('Authorization', bearer(tokens[0]))
    .expect(204);
  assert.match(removed.headers['cache-control'], /no-store/);
  await request(app)
    .delete(`/api/v1/wishlist/items/${products[0].id}`)
    .set('Authorization', bearer(tokens[0]))
    .expect(204);
  assert.equal(
    await prisma.wishlistItem.count({
      where: { wishlist: { userId: users[0].id } },
    }),
    0,
  );
  assert.equal(
    await prisma.wishlistItem.count({
      where: { wishlist: { userId: users[1].id } },
    }),
    1,
  );
  await request(app)
    .delete('/api/v1/wishlist/items/not-a-uuid')
    .set('Authorization', bearer(tokens[0]))
    .expect(404);
  await request(app)
    .put(`/api/v1/wishlist/items/${products[0].id}?owner=true`)
    .set('Authorization', bearer(tokens[0]))
    .expect(422);
  await request(app)
    .put(`/api/v1/wishlist/items/${products[0].id}`)
    .set('Authorization', bearer(tokens[0]))
    .send({ userId: users[1].id })
    .expect(422);
  await request(app)
    .delete(`/api/v1/wishlist/items/${products[0].id}`)
    .set('Authorization', bearer(tokens[0]))
    .send({ userId: users[1].id })
    .expect(422);
});

test('concurrent wishlist adds serialize to one owned product row', async (t) => {
  const { app, prisma, users, tokens, products } = await setup(t);
  const calls = await Promise.all(
    Array.from({ length: 8 }, () =>
      request(app)
        .put(`/api/v1/wishlist/items/${products[0].id}`)
        .set('Authorization', bearer(tokens[0])),
    ),
  );
  assert.deepEqual(
    calls.map(({ status }) => status),
    Array(8).fill(200),
  );
  assert.equal(
    await prisma.wishlist.count({ where: { userId: users[0].id } }),
    1,
  );
  assert.equal(
    await prisma.wishlistItem.count({
      where: { wishlist: { userId: users[0].id } },
    }),
    1,
  );
});
