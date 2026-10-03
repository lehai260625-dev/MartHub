import { createHash, randomUUID } from 'node:crypto';
import {
  checkoutOrderInputSchema,
  checkoutOrderSchema,
  idempotencyKeySchema,
} from '@marthub/contracts';
import { ApiError } from '../../middleware/platform.js';
import { readCheckout } from './service.js';

export function fingerprintIntent(intent) {
  return createHash('sha256')
    .update(
      JSON.stringify({
        cartId: intent.cartId,
        addressId: intent.addressId,
        customerNote: intent.customerNote,
      }),
    )
    .digest('hex');
}

const itemsSelect = {
  id: true,
  productId: true,
  sku: true,
  productName: true,
  imageUrl: true,
  sellingUnit: true,
  unitPrice: true,
  compareAtPrice: true,
  quantity: true,
  lineTotal: true,
};
const orderSelect = {
  id: true,
  orderNumber: true,
  status: true,
  paymentMethod: true,
  currency: true,
  subtotal: true,
  shippingFee: true,
  discountTotal: true,
  total: true,
  recipientName: true,
  recipientPhone: true,
  addressLine1: true,
  addressLine2: true,
  ward: true,
  district: true,
  province: true,
  postalCode: true,
  customerNote: true,
  placedAt: true,
  requestFingerprint: true,
  items: {
    select: itemsSelect,
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  },
};

function publicOrder(row) {
  return checkoutOrderSchema.parse({
    id: row.id,
    orderNumber: row.orderNumber,
    status: row.status,
    paymentMethod: row.paymentMethod,
    currency: row.currency,
    subtotal: row.subtotal.toString(),
    shippingFee: row.shippingFee.toString(),
    discountTotal: row.discountTotal.toString(),
    total: row.total.toString(),
    address: {
      recipientName: row.recipientName,
      phone: row.recipientPhone,
      line1: row.addressLine1,
      line2: row.addressLine2,
      ward: row.ward,
      district: row.district,
      province: row.province,
      postalCode: row.postalCode,
    },
    customerNote: row.customerNote,
    placedAt: row.placedAt.toISOString(),
    items: row.items.map((item) => ({
      ...item,
      unitPrice: item.unitPrice.toString(),
      compareAtPrice: item.compareAtPrice?.toString() ?? null,
      lineTotal: item.lineTotal.toString(),
    })),
  });
}

function replay(row, fingerprint) {
  if (row.requestFingerprint !== fingerprint)
    throw new ApiError(
      400,
      'IDEMPOTENCY_KEY_REUSED',
      'This idempotency key was already used for a different checkout request.',
    );
  return { created: false, order: publicOrder(row) };
}

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

export function createOrderService({ prisma, shippingPolicy }) {
  return {
    async create(auth, input, key) {
      const intent = parse(checkoutOrderInputSchema, input);
      const idempotencyKey = parse(idempotencyKeySchema, key);
      const fingerprint = fingerprintIntent(intent);
      const where = {
        userId_idempotencyKey: { userId: auth.user.id, idempotencyKey },
      };
      try {
        return await prisma.$transaction(
          async (tx) => {
            const existing = await tx.order.findUnique({
              where,
              select: orderSelect,
            });
            if (existing) return replay(existing, fingerprint);
            const { quote, cards } = await readCheckout(
              tx,
              auth,
              intent,
              shippingPolicy,
            );
            const byId = new Map(cards.map((card) => [card.id, card]));
            const address = quote.address;
            const row = await tx.order.create({
              data: {
                orderNumber: `MH-${randomUUID()}`,
                userId: auth.user.id,
                idempotencyKey,
                requestFingerprint: fingerprint,
                subtotal: BigInt(quote.subtotal),
                shippingFee: BigInt(quote.shippingFee),
                discountTotal: 0n,
                total: BigInt(quote.total),
                recipientName: address.recipientName,
                recipientPhone: address.phone,
                addressLine1: address.line1,
                addressLine2: address.line2,
                ward: address.ward,
                district: address.district,
                province: address.province,
                postalCode: address.postalCode,
                customerNote: intent.customerNote,
                items: {
                  create: quote.items.map((item) => {
                    const card = byId.get(item.productId);
                    return {
                      productId: item.productId,
                      sku: item.sku,
                      productName: item.name,
                      imageUrl: card.image?.url ?? null,
                      sellingUnit: card.sellingUnit,
                      unitPrice: BigInt(item.unitPrice),
                      compareAtPrice:
                        item.compareAtPrice === null
                          ? null
                          : BigInt(item.compareAtPrice),
                      quantity: item.quantity,
                      lineTotal: BigInt(item.lineTotal),
                    };
                  }),
                },
                statusHistory: {
                  create: {
                    fromStatus: null,
                    toStatus: 'PENDING',
                    actorUserId: auth.user.id,
                  },
                },
              },
              select: orderSelect,
            });
            return { created: true, order: publicOrder(row) };
          },
          { isolationLevel: 'RepeatableRead' },
        );
      } catch (error) {
        // A same-key race is resolved only after the losing transaction rolled back.
        if (error.code === 'P2002') {
          const existing = await prisma.order.findUnique({
            where,
            select: orderSelect,
          });
          if (existing) return replay(existing, fingerprint);
        }
        throw error;
      }
    },
  };
}
