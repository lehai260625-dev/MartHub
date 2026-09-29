import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createDatabase } from '../../src/db/client.js';
import { validateDatabaseUrl } from '../../src/config/env.js';

async function fixture(t) {
  const database = createDatabase(
    validateDatabaseUrl(process.env.DATABASE_URL),
  );
  const { prisma } = database;
  const suffix = randomUUID();
  const category = await prisma.category.create({
    data: { name: 'Test category', slug: `test-${suffix}` },
  });
  const product = await prisma.product.create({
    data: {
      categoryId: category.id,
      sku: `TEST-${suffix}`,
      name: 'Test product',
      slug: `product-${suffix}`,
      sellingUnit: 'each',
    },
  });
  t.after(async () => {
    await prisma.productPriceHistory.deleteMany({
      where: { productId: product.id },
    });
    await prisma.productImage.deleteMany({ where: { productId: product.id } });
    await prisma.inventory.deleteMany({ where: { productId: product.id } });
    await prisma.product.delete({ where: { id: product.id } });
    await prisma.category.delete({ where: { id: category.id } });
    await database.close();
  });
  return { prisma, category, product, suffix };
}

async function checkViolation(prisma, sql, expectedCode = '23514') {
  await assert.rejects(prisma.$executeRawUnsafe(sql), (error) => {
    assert.equal(error.code, 'P2010');
    assert.match(error.message, new RegExp('Code: `' + expectedCode + '`'));
    return true;
  });
}

test('catalog identities, archive state, and image primary constraints', async (t) => {
  const { prisma, category, product, suffix } = await fixture(t);
  await assert.rejects(
    prisma.category.create({
      data: { name: 'Duplicate', slug: category.slug },
    }),
    { code: 'P2002' },
  );
  await assert.rejects(
    prisma.product.create({
      data: {
        categoryId: category.id,
        sku: product.sku,
        name: 'Duplicate',
        slug: `other-${suffix}`,
        sellingUnit: 'each',
      },
    }),
    { code: 'P2002' },
  );
  await assert.rejects(
    prisma.product.create({
      data: {
        categoryId: category.id,
        sku: `OTHER-${suffix}`,
        name: 'Duplicate',
        slug: product.slug,
        sellingUnit: 'each',
      },
    }),
    { code: 'P2002' },
  );
  await checkViolation(
    prisma,
    `UPDATE products SET status = 'ARCHIVED' WHERE id = '${product.id}'`,
  );
  await prisma.product.update({
    where: { id: product.id },
    data: { status: 'ARCHIVED', archivedAt: new Date() },
  });
  await checkViolation(
    prisma,
    `UPDATE categories SET status = 'ARCHIVED' WHERE id = '${category.id}'`,
  );
  await prisma.category.update({
    where: { id: category.id },
    data: { status: 'ARCHIVED', archivedAt: new Date() },
  });
  await prisma.productImage.create({
    data: {
      productId: product.id,
      cloudinaryPublicId: `first-${suffix}`,
      url: '/first',
      altText: 'First',
      width: 100,
      height: 100,
      sortOrder: 0,
      isPrimary: true,
    },
  });
  await assert.rejects(
    prisma.productImage.create({
      data: {
        productId: product.id,
        cloudinaryPublicId: `second-${suffix}`,
        url: '/second',
        altText: 'Second',
        width: 100,
        height: 100,
        sortOrder: 1,
        isPrimary: true,
      },
    }),
    { code: 'P2002' },
  );
});

test('VND price intervals and single nonnegative inventory row are database constrained', async (t) => {
  const { prisma, product } = await fixture(t);
  const now = new Date('2026-09-16T00:00:00Z');
  const later = new Date('2026-09-17T00:00:00Z');
  const price = await prisma.productPriceHistory.create({
    data: {
      productId: product.id,
      price: 9007199254740993n,
      startsAt: now,
      endsAt: later,
    },
  });
  assert.equal(typeof price.price, 'bigint');
  assert.equal(price.price, 9007199254740993n);
  await checkViolation(
    prisma,
    `INSERT INTO product_price_history (id, product_id, price, starts_at) VALUES ('${randomUUID()}', '${product.id}', 0, '2026-09-18')`,
  );
  await checkViolation(
    prisma,
    `INSERT INTO product_price_history (id, product_id, price, compare_at_price, starts_at) VALUES ('${randomUUID()}', '${product.id}', 100, 100, '2026-09-18')`,
  );
  await checkViolation(
    prisma,
    `INSERT INTO product_price_history (id, product_id, price, starts_at, ends_at) VALUES ('${randomUUID()}', '${product.id}', 100, '2026-09-18', '2026-09-17')`,
  );
  await checkViolation(
    prisma,
    `INSERT INTO product_price_history (id, product_id, price, starts_at) VALUES ('${randomUUID()}', '${product.id}', 100, '2026-09-16T12:00:00Z')`,
    '23P01',
  );
  await prisma.productPriceHistory.create({
    data: { productId: product.id, price: 100n, startsAt: later },
  });
  await prisma.inventory.create({
    data: { productId: product.id, quantityOnHand: 0 },
  });
  await assert.rejects(
    prisma.inventory.create({
      data: { productId: product.id, quantityOnHand: 1 },
    }),
    { code: 'P2002' },
  );
  await checkViolation(
    prisma,
    `UPDATE inventory SET quantity_on_hand = -1 WHERE product_id = '${product.id}'`,
  );
});

test('promotion schedule, archive state, placement, and internal path are constrained', async (t) => {
  const database = createDatabase(
    validateDatabaseUrl(process.env.DATABASE_URL),
  );
  const { prisma } = database;
  const promotion = await prisma.promotion.create({
    data: {
      title: 'Test promotion',
      internalHref: '/catalog',
      placement: 'HERO_PRIMARY',
      startsAt: new Date('2026-09-16T00:00:00Z'),
    },
  });
  t.after(async () => {
    await prisma.promotion.delete({ where: { id: promotion.id } });
    await database.close();
  });
  await checkViolation(
    prisma,
    `UPDATE promotions SET ends_at = starts_at WHERE id = '${promotion.id}'`,
  );
  await checkViolation(
    prisma,
    `UPDATE promotions SET status = 'ARCHIVED' WHERE id = '${promotion.id}'`,
  );
  await checkViolation(
    prisma,
    `UPDATE promotions SET internal_href = '//evil.example' WHERE id = '${promotion.id}'`,
  );
  await prisma.promotion.update({
    where: { id: promotion.id },
    data: {
      status: 'ARCHIVED',
      archivedAt: new Date(),
      endsAt: new Date('2026-09-17T00:00:00Z'),
    },
  });
});
