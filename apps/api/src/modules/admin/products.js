import {
  adminProductCreateSchema,
  adminProductIdSchema,
  adminProductListResponseSchema,
  adminProductQuerySchema,
  adminProductResponseSchema,
  adminProductUpdateSchema,
} from '@marthub/contracts';
import { ApiError } from '../../middleware/platform.js';

function productSelect(now = new Date()) {
  return {
    id: true,
    categoryId: true,
    sku: true,
    name: true,
    slug: true,
    shortDescription: true,
    description: true,
    brand: true,
    sellingUnit: true,
    status: true,
    isFeatured: true,
    isNew: true,
    isPopular: true,
    publishedAt: true,
    archivedAt: true,
    category: { select: { id: true, name: true, slug: true, status: true } },
    prices: {
      where: {
        startsAt: { lte: now },
        OR: [{ endsAt: null }, { endsAt: { gt: now } }],
      },
      orderBy: { startsAt: 'desc' },
      take: 1,
      select: { price: true, compareAtPrice: true },
    },
    inventory: { select: { quantityOnHand: true } },
    images: {
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        url: true,
        altText: true,
        width: true,
        height: true,
        sortOrder: true,
        isPrimary: true,
      },
    },
    _count: { select: { images: true } },
  };
}

function validationError(error) {
  return new ApiError(
    422,
    'VALIDATION_ERROR',
    'Check the submitted fields.',
    error.issues.map((issue) => ({
      field: issue.path.join('.'),
      message: issue.message,
    })),
  );
}

function parse(schema, input) {
  const result = schema.safeParse(input);
  if (!result.success) throw validationError(result.error);
  return result.data;
}

function productId(value) {
  const result = adminProductIdSchema.safeParse(value);
  if (!result.success)
    throw new ApiError(404, 'NOT_FOUND', 'Resource not found.');
  return result.data;
}

function notFound() {
  throw new ApiError(404, 'NOT_FOUND', 'Resource not found.');
}

function toProduct(row) {
  const currentPrice = row.prices[0];
  if (!currentPrice)
    throw new ApiError(500, 'INTERNAL_ERROR', 'Product price is missing.');
  return {
    id: row.id,
    categoryId: row.categoryId,
    sku: row.sku,
    name: row.name,
    slug: row.slug,
    shortDescription: row.shortDescription,
    description: row.description,
    brand: row.brand,
    sellingUnit: row.sellingUnit,
    status: row.status,
    isFeatured: row.isFeatured,
    isNew: row.isNew,
    isPopular: row.isPopular,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    category: row.category,
    price: currentPrice.price.toString(),
    compareAtPrice: currentPrice.compareAtPrice?.toString() ?? null,
    quantityOnHand: row.inventory?.quantityOnHand ?? 0,
    imageCount: row._count.images,
    images: row.images,
  };
}

async function databaseNow(db) {
  const [clock] = await db.$queryRaw`SELECT transaction_timestamp() AS "now"`;
  return clock.now;
}

async function findProduct(db, id, now = new Date()) {
  const row = await db.product.findUnique({
    where: { id: productId(id) },
    select: productSelect(now),
  });
  if (!row) notFound();
  return row;
}

async function requireActiveCategory(db, id) {
  const category = await db.category.findFirst({
    where: { id, status: 'ACTIVE', archivedAt: null },
    select: { id: true },
  });
  if (!category)
    throw new ApiError(
      422,
      'INVALID_PRODUCT_CATEGORY',
      'Select an active category.',
      [{ field: 'categoryId', message: 'Select an active category.' }],
    );
}

function mapConflict(error) {
  if (error?.code !== 'P2002') throw error;
  const target = [
    error.message,
    JSON.stringify(error.meta ?? {}),
    error.meta?.driverAdapterError?.cause?.constraint,
  ].join(' ');
  if (/sku/i.test(target))
    throw new ApiError(
      409,
      'SKU_CONFLICT',
      'A product already uses this SKU.',
      [{ field: 'sku', message: 'Choose a different SKU.' }],
    );
  throw new ApiError(
    409,
    'SLUG_CONFLICT',
    'A product already uses this slug.',
    [{ field: 'slug', message: 'Choose a different slug.' }],
  );
}

export function createAdminProductService({ prisma }) {
  return {
    async list(input) {
      const query = parse(adminProductQuerySchema, input);
      const where = {
        ...(query.status ? { status: query.status } : {}),
        ...(query.categoryId ? { categoryId: query.categoryId } : {}),
        ...(query.q
          ? {
              OR: [
                { name: { contains: query.q, mode: 'insensitive' } },
                { sku: { contains: query.q, mode: 'insensitive' } },
                { slug: { contains: query.q, mode: 'insensitive' } },
              ],
            }
          : {}),
      };
      return prisma.$transaction(async (tx) => {
        const now = await databaseNow(tx);
        const totalItems = await tx.product.count({ where });
        const rows = await tx.product.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
          skip: (query.page - 1) * query.perPage,
          take: query.perPage,
          select: productSelect(now),
        });
        return adminProductListResponseSchema.parse({
          data: rows.map(toProduct),
          meta: {
            page: query.page,
            perPage: query.perPage,
            totalItems,
            totalPages: Math.ceil(totalItems / query.perPage),
          },
        });
      });
    },

    async get(id) {
      return prisma.$transaction(async (tx) => {
        const now = await databaseNow(tx);
        return adminProductResponseSchema.parse({
          data: toProduct(await findProduct(tx, id, now)),
        }).data;
      });
    },

    async create(input, actorId, now = new Date()) {
      const data = parse(adminProductCreateSchema, input);
      const { price, compareAtPrice, ...catalog } = data;
      try {
        return await prisma.$transaction(async (tx) => {
          await requireActiveCategory(tx, catalog.categoryId);
          const row = await tx.product.create({
            data: {
              ...catalog,
              status: 'DRAFT',
              prices: {
                create: {
                  price: BigInt(price),
                  compareAtPrice:
                    compareAtPrice === null ? null : BigInt(compareAtPrice),
                  startsAt: now,
                  createdByUserId: actorId,
                },
              },
              inventory: { create: { quantityOnHand: 0 } },
            },
            select: productSelect(now),
          });
          return adminProductResponseSchema.parse({ data: toProduct(row) })
            .data;
        });
      } catch (error) {
        mapConflict(error);
      }
    },

    async update(id, input) {
      const data = parse(adminProductUpdateSchema, input);
      return prisma.$transaction(async (tx) => {
        const priceNow = await databaseNow(tx);
        const existing = await findProduct(tx, id, priceNow);
        if (existing.status === 'ARCHIVED')
          throw new ApiError(
            409,
            'PRODUCT_STATUS_CONFLICT',
            'Archived products cannot be edited.',
          );
        if (data.categoryId) await requireActiveCategory(tx, data.categoryId);
        const row = await tx.product.update({
          where: { id: existing.id },
          data,
          select: productSelect(priceNow),
        });
        return adminProductResponseSchema.parse({ data: toProduct(row) }).data;
      });
    },

    async publish(id, now = new Date()) {
      return prisma.$transaction(async (tx) => {
        const priceNow = await databaseNow(tx);
        const existing = await findProduct(tx, id, priceNow);
        if (existing.status === 'ARCHIVED')
          throw new ApiError(
            409,
            'PRODUCT_STATUS_CONFLICT',
            'Archived products cannot be published.',
          );
        await requireActiveCategory(tx, existing.categoryId);
        const row =
          existing.status === 'ACTIVE'
            ? existing
            : await tx.product.update({
                where: { id: existing.id },
                data: {
                  status: 'ACTIVE',
                  publishedAt: existing.publishedAt ?? now,
                  archivedAt: null,
                },
                select: productSelect(priceNow),
              });
        return adminProductResponseSchema.parse({ data: toProduct(row) }).data;
      });
    },

    async archive(id, now = new Date()) {
      return prisma.$transaction(async (tx) => {
        const priceNow = await databaseNow(tx);
        const existing = await findProduct(tx, id, priceNow);
        const row =
          existing.status === 'ARCHIVED'
            ? existing
            : await tx.product.update({
                where: { id: existing.id },
                data: { status: 'ARCHIVED', archivedAt: now },
                select: productSelect(priceNow),
              });
        return adminProductResponseSchema.parse({ data: toProduct(row) }).data;
      });
    },
  };
}
