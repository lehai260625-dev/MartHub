import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { validateDatabaseUrl } from '../../src/config/env.js';
import { createDatabase } from '../../src/db/client.js';

const exactPrice = 9007199254740993n;

async function fixture(t) {
  const database = createDatabase(
    validateDatabaseUrl(process.env.DATABASE_URL),
  );
  t.after(() => database.close());
  const { prisma } = database;
  const suffix = randomUUID();
  const [firstUser, secondUser, category] = await Promise.all([
    prisma.user.create({
      data: {
        email: `order-first-${suffix}@example.test`,
        passwordHash: 'test-hash',
        firstName: 'First',
        lastName: 'Customer',
      },
    }),
    prisma.user.create({
      data: {
        email: `order-second-${suffix}@example.test`,
        passwordHash: 'test-hash',
        firstName: 'Second',
        lastName: 'Customer',
      },
    }),
    prisma.category.create({
      data: { name: 'Order fixtures', slug: `order-fixtures-${suffix}` },
    }),
  ]);
  const product = await prisma.product.create({
    data: {
      categoryId: category.id,
      sku: `ORDER-${suffix}`,
      name: 'Order snapshot product',
      slug: `order-snapshot-${suffix}`,
      sellingUnit: 'each',
    },
  });
  return { prisma, firstUser, secondUser, product, suffix };
}

const orderData = (userId, suffix, overrides = {}) => ({
  orderNumber: `MH-${suffix}`,
  userId,
  subtotal: exactPrice,
  shippingFee: 30000n,
  discountTotal: 0n,
  total: exactPrice + 30000n,
  recipientName: 'Minh Nguyen',
  recipientPhone: '0900000000',
  addressLine1: '1 Market Street',
  addressLine2: null,
  ward: 'Ward 1',
  district: 'District 1',
  province: 'Ho Chi Minh City',
  postalCode: '700000',
  customerNote: 'Office hours',
  idempotencyKey: randomUUID(),
  requestFingerprint: `fingerprint-${suffix}`,
  ...overrides,
});

async function checkSqlFailure(prisma, sql, databaseCode) {
  await assert.rejects(prisma.$executeRawUnsafe(sql), (error) => {
    assert.equal(error.code, 'P2010');
    if (databaseCode)
      assert.match(error.message, new RegExp(`Code: \`${databaseCode}\``));
    return true;
  });
}

async function checkConstraintViolation(operation) {
  await assert.rejects(operation, (error) => {
    assert.equal(error.code, 'P2039');
    assert.match(error.message, /Code: `23514`/u);
    return true;
  });
}

test('order schema keeps exact snapshots and enforces business uniqueness', async (t) => {
  const { prisma, firstUser, secondUser, product, suffix } = await fixture(t);
  const idempotencyKey = randomUUID();
  const order = await prisma.order.create({
    data: orderData(firstUser.id, suffix, { idempotencyKey }),
  });
  assert.equal(order.status, 'PENDING');
  assert.equal(order.paymentMethod, 'COD');
  assert.equal(order.currency, 'VND');
  assert.equal(order.subtotal, exactPrice);

  await assert.rejects(
    prisma.order.create({
      data: orderData(firstUser.id, `${suffix}-same-key`, { idempotencyKey }),
    }),
    { code: 'P2002' },
  );
  await assert.rejects(
    prisma.order.create({
      data: orderData(firstUser.id, `${suffix}-same-number`, {
        orderNumber: order.orderNumber,
      }),
    }),
    { code: 'P2002' },
  );
  await prisma.order.create({
    data: orderData(secondUser.id, `${suffix}-other-owner`, { idempotencyKey }),
  });

  const item = await prisma.orderItem.create({
    data: {
      orderId: order.id,
      productId: product.id,
      sku: product.sku,
      productName: product.name,
      imageUrl: null,
      sellingUnit: product.sellingUnit,
      unitPrice: exactPrice,
      compareAtPrice: exactPrice + 100000n,
      quantity: 1,
      lineTotal: exactPrice,
    },
  });
  assert.equal(item.unitPrice, exactPrice);
  await assert.rejects(
    prisma.orderItem.create({
      data: {
        orderId: order.id,
        productId: product.id,
        sku: product.sku,
        productName: product.name,
        sellingUnit: product.sellingUnit,
        unitPrice: exactPrice,
        quantity: 1,
        lineTotal: exactPrice,
      },
    }),
    { code: 'P2002' },
  );

  const history = await prisma.orderStatusHistory.create({
    data: {
      orderId: order.id,
      fromStatus: null,
      toStatus: 'PENDING',
      actorUserId: firstUser.id,
      reason: 'COD order created',
    },
  });
  assert.equal(history.actorUserId, firstUser.id);

  await prisma.inventoryMovement.create({
    data: {
      productId: product.id,
      type: 'ORDER_DEBIT',
      quantityDelta: -1,
      quantityAfter: 4,
      orderId: order.id,
      idempotencyKey: `${order.id}:${product.id}:debit`,
    },
  });
  await assert.rejects(
    prisma.inventoryMovement.create({
      data: {
        productId: product.id,
        type: 'ORDER_DEBIT',
        quantityDelta: -1,
        quantityAfter: 3,
        orderId: order.id,
      },
    }),
    { code: 'P2002' },
  );
});

test('PostgreSQL protects order money, line totals, and immutable history', async (t) => {
  const { prisma, firstUser, product, suffix } = await fixture(t);
  const order = await prisma.order.create({
    data: orderData(firstUser.id, suffix),
  });
  const item = await prisma.orderItem.create({
    data: {
      orderId: order.id,
      productId: product.id,
      sku: product.sku,
      productName: product.name,
      sellingUnit: product.sellingUnit,
      unitPrice: exactPrice,
      quantity: 2,
      lineTotal: exactPrice * 2n,
    },
  });
  const history = await prisma.orderStatusHistory.create({
    data: {
      orderId: order.id,
      toStatus: 'PENDING',
      actorUserId: firstUser.id,
      reason: 'Initial state',
    },
  });

  await checkConstraintViolation(
    prisma.order.create({
      data: orderData(firstUser.id, `${suffix}-bad-total`, { total: 1n }),
    }),
  );
  const badItemOrder = await prisma.order.create({
    data: orderData(firstUser.id, `${suffix}-bad-item`),
  });
  await checkConstraintViolation(
    prisma.orderItem.create({
      data: {
        orderId: badItemOrder.id,
        productId: product.id,
        sku: `${product.sku}-OTHER`,
        productName: product.name,
        sellingUnit: product.sellingUnit,
        unitPrice: 100n,
        quantity: 2,
        lineTotal: 199n,
      },
    }),
  );

  await checkSqlFailure(
    prisma,
    `UPDATE orders SET subtotal = subtotal + 1 WHERE id = '${order.id}'`,
    'P0001',
  );
  await checkSqlFailure(
    prisma,
    `UPDATE orders SET address_line_1 = 'Changed address' WHERE id = '${order.id}'`,
    'P0001',
  );
  await checkSqlFailure(
    prisma,
    `UPDATE order_items SET quantity = 3 WHERE id = '${item.id}'`,
    'P0001',
  );
  await checkSqlFailure(
    prisma,
    `DELETE FROM order_items WHERE id = '${item.id}'`,
    'P0001',
  );
  await checkSqlFailure(
    prisma,
    `UPDATE order_status_history SET reason = 'Changed' WHERE id = '${history.id}'`,
    'P0001',
  );
  await checkSqlFailure(
    prisma,
    `DELETE FROM order_status_history WHERE id = '${history.id}'`,
    'P0001',
  );
  await checkSqlFailure(
    prisma,
    `DELETE FROM orders WHERE id = '${order.id}'`,
    'P0001',
  );

  const transitioned = await prisma.order.update({
    where: { id: order.id },
    data: { status: 'CONFIRMED' },
  });
  assert.equal(transitioned.status, 'CONFIRMED');
  assert.equal(transitioned.subtotal, exactPrice);

  await checkConstraintViolation(
    prisma.orderStatusHistory.create({
      data: {
        orderId: order.id,
        fromStatus: 'CONFIRMED',
        toStatus: 'CONFIRMED',
        actorUserId: firstUser.id,
      },
    }),
  );
});
