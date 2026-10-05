import { createHash } from 'node:crypto';

export const fixtureId = (number) =>
  `10600000-0000-4000-8000-${String(number).padStart(12, '0')}`;
export const exactVnd = 9007199254740993n;
const at = new Date('2026-09-01T00:00:00.000Z');
const hash = (value) => createHash('sha256').update(value).digest('hex');

// Test-only representative persistence fixture, not an alternate business API.
// IDs/copy/timestamps are deterministic; these synthetic media URLs are never fetched.
export async function seedRecoveryFixture(prisma) {
  const userId = fixtureId(1),
    adminId = fixtureId(2),
    productId = fixtureId(10);
  for (const [id, role, status] of [
    [1, 'CUSTOMER', 'ACTIVE'],
    [2, 'ADMIN', 'ACTIVE'],
    [3, 'CUSTOMER', 'SUSPENDED'],
    [4, 'CUSTOMER', 'ARCHIVED'],
  ]) {
    await prisma.user.create({
      data: {
        id: fixtureId(id),
        email: `restore-${id}@example.test`,
        passwordHash: 'non-authenticating-test-only-hash',
        firstName: 'Recovery',
        lastName: 'Fixture',
        role,
        status,
        createdAt: at,
        updatedAt: at,
        archivedAt: status === 'ARCHIVED' ? at : null,
      },
    });
  }
  await prisma.refreshSession.create({
    data: {
      id: fixtureId(5),
      userId,
      tokenHash: hash('revoked-rehearsal-fixture'),
      familyId: fixtureId(5),
      expiresAt: new Date('2026-12-01T00:00:00Z'),
      revokedAt: at,
      revokeReason: 'ROTATED',
      createdAt: at,
    },
  });
  await prisma.refreshSession.create({
    data: {
      id: fixtureId(6),
      userId,
      tokenHash: hash('child-rehearsal-fixture'),
      familyId: fixtureId(5),
      parentSessionId: fixtureId(5),
      expiresAt: new Date('2026-12-01T00:00:00Z'),
      createdAt: at,
    },
  });
  await prisma.authThrottle.create({
    data: { key: hash('rehearsal-throttle'), attempts: 2, expiresAt: at },
  });
  const address = {
    recipientName: 'Recovery Fixture',
    phone: '0900000000',
    line1: 'Synthetic test address',
    ward: 'Test ward',
    district: 'Test district',
    province: 'Test province',
  };
  await prisma.address.create({
    data: {
      id: fixtureId(7),
      userId,
      label: 'Rehearsal',
      ...address,
      isDefault: true,
      createdAt: at,
      updatedAt: at,
    },
  });
  await prisma.category.create({
    data: {
      id: fixtureId(9),
      name: 'Recovery fixture',
      slug: 'recovery-fixture',
      createdAt: at,
      updatedAt: at,
    },
  });
  await prisma.product.create({
    data: {
      id: productId,
      categoryId: fixtureId(9),
      sku: 'RECOVERY-EXACT',
      name: 'Recovery exact VND product',
      slug: 'recovery-exact-vnd',
      sellingUnit: 'each',
      status: 'ACTIVE',
      publishedAt: at,
      createdAt: at,
      updatedAt: at,
    },
  });
  await prisma.productPriceHistory.create({
    data: {
      id: fixtureId(11),
      productId,
      price: exactVnd,
      compareAtPrice: exactVnd + 10000n,
      startsAt: at,
      createdByUserId: adminId,
      createdAt: at,
    },
  });
  await prisma.inventory.create({
    data: { id: fixtureId(12), productId, quantityOnHand: 95, updatedAt: at },
  });
  await prisma.inventoryMovement.create({
    data: {
      id: fixtureId(13),
      productId,
      type: 'INITIAL',
      quantityDelta: 100,
      quantityAfter: 100,
      actorUserId: adminId,
      createdAt: at,
    },
  });
  await prisma.productImage.create({
    data: {
      id: fixtureId(14),
      productId,
      cloudinaryPublicId: 'marthub/rehearsal/product',
      url: 'https://res.cloudinary.com/rehearsal/image/upload/product.png',
      altText: 'Synthetic restore metadata',
      width: 600,
      height: 600,
      sortOrder: 0,
      isPrimary: true,
      createdAt: at,
      updatedAt: at,
    },
  });
  await prisma.promotion.create({
    data: {
      id: fixtureId(15),
      title: 'Recovery fixture',
      internalHref: '/products/recovery-exact-vnd',
      placement: 'EDITORIAL',
      status: 'ACTIVE',
      startsAt: at,
      imagePublicId: 'marthub/rehearsal/promotion',
      imageUrl:
        'https://res.cloudinary.com/rehearsal/image/upload/promotion.png',
      createdByUserId: adminId,
      createdAt: at,
      updatedAt: at,
    },
  });
  for (const [i, status] of ['PENDING', 'FAILED', 'COMPLETED'].entries()) {
    await prisma.mediaCleanup.create({
      data: {
        id: fixtureId(16 + i),
        ownerType: 'PRODUCT_IMAGE',
        productId,
        productImageId: fixtureId(800 + i),
        cloudinaryPublicId: `marthub/rehearsal/removed-${i}`,
        status,
        attemptCount: status === 'FAILED' ? 5 : i,
        lastErrorCode: status === 'FAILED' ? 'PROVIDER_UNAVAILABLE' : null,
        completedAt: status === 'COMPLETED' ? at : null,
        createdAt: at,
        updatedAt: at,
      },
    });
  }
  await prisma.mediaCleanup.create({
    data: {
      id: fixtureId(19),
      ownerType: 'PROMOTION_MEDIA',
      promotionId: fixtureId(15),
      cloudinaryPublicId: 'marthub/rehearsal/removed-promotion',
      createdAt: at,
      updatedAt: at,
    },
  });
  await prisma.cart.create({
    data: {
      id: fixtureId(20),
      userId,
      createdAt: at,
      updatedAt: at,
      items: {
        create: {
          id: fixtureId(21),
          productId,
          quantity: 2,
          createdAt: at,
          updatedAt: at,
        },
      },
    },
  });
  await prisma.wishlist.create({
    data: {
      id: fixtureId(22),
      userId,
      createdAt: at,
      updatedAt: at,
      items: { create: { id: fixtureId(23), productId, createdAt: at } },
    },
  });
  const forward = ['PENDING', 'CONFIRMED', 'PACKING', 'SHIPPING', 'DELIVERED'];
  let stock = 100;
  for (const [index, status] of [...forward, 'CANCELLED'].entries()) {
    const orderId = fixtureId(30 + index),
      cancelled = status === 'CANCELLED';
    const chain = cancelled
      ? ['PENDING', 'CONFIRMED', 'PACKING', 'CANCELLED']
      : forward.slice(0, index + 1);
    const lastAt = new Date(at.getTime() + chain.length * 1000);
    const reason = cancelled ? 'Rehearsal cancellation' : null;
    await prisma.order.create({
      data: {
        id: orderId,
        orderNumber: `MH-RESTORE-${index}`,
        userId,
        status,
        subtotal: exactVnd,
        shippingFee: 30000n,
        discountTotal: 0n,
        total: exactVnd + 30000n,
        recipientName: address.recipientName,
        recipientPhone: address.phone,
        addressLine1: address.line1,
        ward: address.ward,
        district: address.district,
        province: address.province,
        customerNote: 'Synthetic immutable snapshot',
        cancellationReason: reason,
        idempotencyKey: fixtureId(40 + index),
        requestFingerprint: hash(`restore-order-${index}`),
        placedAt: at,
        createdAt: at,
        updatedAt: lastAt,
        cancelledAt: cancelled ? lastAt : null,
        deliveredAt: status === 'DELIVERED' ? lastAt : null,
        items: {
          create: {
            id: fixtureId(50 + index),
            productId,
            sku: 'HISTORICAL-SKU',
            productName: 'Historical snapshot distinct from current product',
            sellingUnit: 'each',
            unitPrice: exactVnd,
            quantity: 1,
            lineTotal: exactVnd,
            createdAt: at,
          },
        },
      },
    });
    await prisma.inventoryMovement.create({
      data: {
        id: fixtureId(60 + index),
        productId,
        orderId,
        type: 'ORDER_DEBIT',
        quantityDelta: -1,
        quantityAfter: --stock,
        actorUserId: userId,
        idempotencyKey: fixtureId(40 + index),
        createdAt: at,
      },
    });
    for (const [step, toStatus] of chain.entries()) {
      const createdAt = new Date(at.getTime() + (step + 1) * 1000);
      await prisma.orderStatusHistory.create({
        data: {
          id: fixtureId(100 + index * 10 + step),
          orderId,
          fromStatus: step ? chain[step - 1] : null,
          toStatus,
          actorUserId: step ? adminId : userId,
          reason: toStatus === 'CANCELLED' ? reason : null,
          createdAt,
        },
      });
      if (step)
        await prisma.adminAuditLog.create({
          data: {
            id: fixtureId(200 + index * 10 + step),
            actorUserId: adminId,
            action: 'ORDER_STATUS_TRANSITION',
            entityType: 'ORDER',
            entityId: orderId,
            requestId: `restore-${index}-${step}`,
            beforeJson: {
              orderNumber: `MH-RESTORE-${index}`,
              status: chain[step - 1],
            },
            afterJson: {
              orderNumber: `MH-RESTORE-${index}`,
              status: toStatus,
              ...(toStatus === 'CANCELLED'
                ? { cancellationReason: reason }
                : {}),
            },
            createdAt,
          },
        });
    }
    if (cancelled)
      await prisma.inventoryMovement.create({
        data: {
          id: fixtureId(70),
          productId,
          orderId,
          type: 'ORDER_CANCEL_RESTORE',
          quantityDelta: 1,
          quantityAfter: ++stock,
          actorUserId: adminId,
          reason,
          createdAt: lastAt,
        },
      });
  }
}
