import { Prisma } from '@prisma/client';
import { ApiError } from '../../middleware/platform.js';

const activeCategory = { status: 'ACTIVE', archivedAt: null };
const visibleCategory = {
  ...activeCategory,
  OR: [{ parentId: null }, { parent: { is: activeCategory } }],
};
const categorySummary = { id: true, name: true, slug: true };
const categorySelect = {
  ...categorySummary,
  description: true,
  imageUrl: true,
  parent: { select: categorySummary },
  children: {
    where: activeCategory,
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }, { id: 'asc' }],
    select: categorySummary,
  },
};
const imagesSelect = {
  orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
  select: {
    id: true,
    url: true,
    altText: true,
    width: true,
    height: true,
    isPrimary: true,
  },
};
const publicProduct = {
  status: 'ACTIVE',
  archivedAt: null,
  category: { is: visibleCategory },
};

function validSlug(slug) {
  return (
    typeof slug === 'string' &&
    slug.length <= 160 &&
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)
  );
}

function notFound() {
  throw new ApiError(404, 'NOT_FOUND', 'Resource not found.');
}

function toCategory(row) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    image: row.imageUrl ? { url: row.imageUrl, altText: row.name } : null,
    children: row.children,
  };
}

function toCard(row) {
  const image = row.images.find(({ isPrimary }) => isPrimary) ?? row.images[0];
  const currentPrice = row.prices[0];
  const inStock = (row.inventory?.quantityOnHand ?? 0) > 0;
  return {
    id: row.id,
    slug: row.slug,
    sku: row.sku,
    name: row.name,
    shortDescription: row.shortDescription,
    image: image ? { url: image.url, altText: image.altText } : null,
    price: currentPrice.price.toString(),
    compareAtPrice: currentPrice.compareAtPrice?.toString() ?? null,
    currency: 'VND',
    sellingUnit: row.sellingUnit,
    badges: [
      ...(currentPrice.compareAtPrice == null ? [] : ['SALE']),
      ...(row.isNew ? ['NEW'] : []),
    ],
    availability: {
      status: inStock ? 'IN_STOCK' : 'OUT_OF_STOCK',
      canAddToCart: inStock,
    },
  };
}

async function atDatabaseTime(prisma, action) {
  const [{ now }] = await prisma.$queryRaw`SELECT CURRENT_TIMESTAMP AS now`;
  const priceWhere = {
    startsAt: { lte: now },
    OR: [{ endsAt: null }, { endsAt: { gt: now } }],
  };
  const productSelect = {
    id: true,
    slug: true,
    sku: true,
    name: true,
    shortDescription: true,
    description: true,
    brand: true,
    sellingUnit: true,
    isNew: true,
    category: { select: categorySummary },
    images: imagesSelect,
    prices: {
      where: priceWhere,
      orderBy: { startsAt: 'desc' },
      take: 1,
      select: { price: true, compareAtPrice: true },
    },
    inventory: { select: { quantityOnHand: true } },
  };
  return action(prisma, now, priceWhere, productSelect);
}
async function findProductPage(db, now, query, priceWhere, select) {
  const clauses = [
    Prisma.sql`p.status = 'ACTIVE'`,
    Prisma.sql`p.archived_at IS NULL`,
    Prisma.sql`c.status = 'ACTIVE'`,
    Prisma.sql`c.archived_at IS NULL`,
    Prisma.sql`(c.parent_id IS NULL OR (parent.status = 'ACTIVE' AND parent.archived_at IS NULL))`,
  ];
  for (const term of query.q?.split(' ') ?? []) {
    const pattern = `%${term}%`;
    clauses.push(
      Prisma.sql`(p.name ILIKE ${pattern} OR p.brand ILIKE ${pattern} OR p.sku ILIKE ${pattern})`,
    );
  }
  if (query.category)
    clauses.push(
      Prisma.sql`(c.slug = ${query.category} OR parent.slug = ${query.category})`,
    );
  if (query.minPrice !== undefined)
    clauses.push(Prisma.sql`current_price.price >= ${BigInt(query.minPrice)}`);
  if (query.maxPrice !== undefined)
    clauses.push(Prisma.sql`current_price.price <= ${BigInt(query.maxPrice)}`);
  if (query.availability === 'in-stock')
    clauses.push(Prisma.sql`COALESCE(i.quantity_on_hand, 0) > 0`);
  if (query.featured !== undefined)
    clauses.push(Prisma.sql`p.is_featured = ${query.featured}`);
  if (query.new !== undefined)
    clauses.push(Prisma.sql`p.is_new = ${query.new}`);
  if (query.popular !== undefined)
    clauses.push(Prisma.sql`p.is_popular = ${query.popular}`);

  const source = Prisma.sql`
    FROM products p
    JOIN categories c ON c.id = p.category_id
    LEFT JOIN categories parent ON parent.id = c.parent_id
    JOIN LATERAL (
      SELECT price FROM product_price_history
      WHERE product_id = p.id AND starts_at <= ${now}
        AND (ends_at IS NULL OR ends_at > ${now})
      ORDER BY starts_at DESC LIMIT 1
    ) current_price ON true
    LEFT JOIN inventory i ON i.product_id = p.id
    WHERE ${Prisma.join(clauses, ' AND ')}
  `;
  let order;
  switch (query.sort) {
    case 'relevance': {
      const prefix = `${query.q}%`;
      order = Prisma.sql`CASE WHEN p.sku ILIKE ${query.q} THEN 0 WHEN p.name ILIKE ${query.q} THEN 1 WHEN p.name ILIKE ${prefix} THEN 2 ELSE 3 END,
        GREATEST(similarity(p.name, ${query.q}), similarity(COALESCE(p.brand, ''), ${query.q}), similarity(p.sku, ${query.q})) DESC,
        p.name ASC, p.id ASC`;
      break;
    }
    case 'price-asc':
      order = Prisma.sql`current_price.price ASC, p.id ASC`;
      break;
    case 'price-desc':
      order = Prisma.sql`current_price.price DESC, p.id ASC`;
      break;
    case 'popular':
      order = Prisma.sql`p.is_popular DESC, p.published_at DESC NULLS LAST, p.created_at DESC, p.id ASC`;
      break;
    default:
      order = Prisma.sql`p.published_at DESC NULLS LAST, p.created_at DESC, p.id ASC`;
  }
  const [{ total }] = await db.$queryRaw(
    Prisma.sql`SELECT COUNT(*)::bigint AS total ${source}`,
  );
  const totalItems = Number(total);
  if (!Number.isSafeInteger(totalItems))
    throw new ApiError(500, 'INTERNAL_ERROR', 'Catalog count is out of range.');
  const ids = await db.$queryRaw(Prisma.sql`
    SELECT p.id ${source} ORDER BY ${order}
    LIMIT ${query.perPage} OFFSET ${(query.page - 1) * query.perPage}
  `);
  const rows = ids.length
    ? await db.product.findMany({
        where: {
          id: { in: ids.map(({ id }) => id) },
          ...publicProduct,
          prices: { some: priceWhere },
        },
        select,
      })
    : [];
  const byId = new Map(rows.map((row) => [row.id, row]));
  return {
    data: ids
      .map(({ id }) => byId.get(id))
      .filter((row) => row?.prices.length)
      .map(toCard),
    meta: {
      page: query.page,
      perPage: query.perPage,
      totalItems,
      totalPages: Math.ceil(totalItems / query.perPage),
    },
  };
}
async function findCuratedProducts(db, priceWhere, select, where, orderBy) {
  const { currentPrice, ...productWhere } = where;
  const rows = await db.product.findMany({
    where: {
      ...publicProduct,
      ...productWhere,
      prices: { some: { ...priceWhere, ...(currentPrice ?? {}) } },
    },
    orderBy,
    take: 12,
    select,
  });
  return rows.map(toCard);
}

function toPromotion(row) {
  return {
    id: row.id,
    title: row.title,
    subtitle: row.subtitle,
    image: row.imageUrl ? { url: row.imageUrl, altText: row.title } : null,
    internalHref: row.internalHref,
    placement: row.placement,
  };
}
export function createCatalogService({ prisma }) {
  return {
    async getHomepage() {
      return atDatabaseTime(prisma, async (db, now, priceWhere, select) => {
        const stableNewest = [
          { publishedAt: { sort: 'desc', nulls: 'last' } },
          { createdAt: 'desc' },
          { id: 'asc' },
        ];
        const [promotions, categories, deals, newProducts, popularProducts] =
          await Promise.all([
            db.promotion.findMany({
              where: {
                status: 'ACTIVE',
                archivedAt: null,
                startsAt: { lte: now },
                OR: [{ endsAt: null }, { endsAt: { gt: now } }],
              },
              orderBy: [
                { placement: 'asc' },
                { sortOrder: 'asc' },
                { startsAt: 'desc' },
                { id: 'asc' },
              ],
              take: 8,
              select: {
                id: true,
                title: true,
                subtitle: true,
                imageUrl: true,
                internalHref: true,
                placement: true,
              },
            }),
            db.category.findMany({
              where: { ...activeCategory, parentId: null },
              orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }, { id: 'asc' }],
              take: 8,
              select: {
                ...categorySelect,
                children: { ...categorySelect.children, take: 8 },
              },
            }),
            findCuratedProducts(
              db,
              priceWhere,
              select,
              { currentPrice: { compareAtPrice: { not: null } } },
              stableNewest,
            ),
            findCuratedProducts(
              db,
              priceWhere,
              select,
              { isNew: true },
              stableNewest,
            ),
            findCuratedProducts(
              db,
              priceWhere,
              select,
              { isPopular: true },
              stableNewest,
            ),
          ]);
        return {
          promotions: promotions.map(toPromotion),
          categories: categories.map(toCategory),
          deals,
          newProducts,
          popularProducts,
        };
      });
    },
    async listCategories() {
      const rows = await prisma.category.findMany({
        where: { ...activeCategory, parentId: null },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }, { id: 'asc' }],
        select: categorySelect,
      });
      return rows.map(toCategory);
    },

    async getCategory(slug) {
      if (!validSlug(slug)) notFound();
      const row = await prisma.category.findFirst({
        where: { slug, ...visibleCategory },
        select: categorySelect,
      });
      if (!row) notFound();
      return { ...toCategory(row), parent: row.parent };
    },

    async listProducts(query) {
      return atDatabaseTime(prisma, (db, now, priceWhere, select) =>
        findProductPage(db, now, query, priceWhere, select),
      );
    },
    async getProductCardsByIds(productIds) {
      const ids = [...new Set(productIds)];
      if (!ids.length) return [];
      return atDatabaseTime(prisma, async (db, _now, priceWhere, select) => {
        const rows = await db.product.findMany({
          where: {
            id: { in: ids },
            ...publicProduct,
            prices: { some: priceWhere },
          },
          select,
        });
        return rows.filter((row) => row.prices.length).map(toCard);
      });
    },
    async getProduct(slug) {
      if (!validSlug(slug)) notFound();
      return atDatabaseTime(prisma, async (tx, _now, priceWhere, select) => {
        const row = await tx.product.findFirst({
          where: { slug, ...publicProduct, prices: { some: priceWhere } },
          select,
        });
        if (!row) notFound();
        return {
          ...toCard(row),
          description: row.description,
          brand: row.brand,
          category: row.category,
          images: row.images.map(({ id, url, altText, width, height }) => ({
            id,
            url,
            altText,
            width,
            height,
          })),
        };
      });
    },
  };
}
