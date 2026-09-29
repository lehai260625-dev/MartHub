import { createDatabase } from '../src/db/client.js';
import { validateDatabaseUrl } from '../src/config/env.js';

// Reserved IDs make repeated runs additive without changing edited development records.
const seedId = (group, number) =>
  `da7a0000-0000-4000-8000-${String(group).padStart(2, '0')}${String(number).padStart(10, '0')}`;
const createdAt = new Date('2026-01-01T00:00:00.000Z');
const publishedAt = new Date('2026-08-15T00:00:00.000Z');
const archivedAt = new Date('2026-08-20T00:00:00.000Z');
const currentPriceAt = new Date('2026-08-15T00:00:00.000Z');

const categories = [
  {
    id: seedId(1, 1),
    name: 'Home & Living',
    slug: 'home-living',
    description: 'Useful pieces for everyday spaces.',
    sortOrder: 0,
  },
  {
    id: seedId(1, 2),
    name: 'Desk & Paper',
    slug: 'desk-paper',
    description: 'Simple tools for notes and a tidy workspace.',
    sortOrder: 1,
  },
  {
    id: seedId(1, 3),
    name: 'On the Go',
    slug: 'on-the-go',
    description: 'Small companions for daily trips.',
    sortOrder: 2,
  },
  {
    id: seedId(1, 5),
    name: 'Past Seasons',
    slug: 'past-seasons',
    description: 'Retired catalog examples.',
    sortOrder: 3,
    status: 'ARCHIVED',
    archivedAt,
  },
].map((category) => ({ ...category, createdAt, updatedAt: createdAt }));
const childCategories = [
  {
    id: seedId(1, 4),
    parentId: seedId(1, 1),
    name: 'Tabletop',
    slug: 'tabletop',
    description: 'Everyday pieces for the table.',
    sortOrder: 0,
    createdAt,
    updatedAt: createdAt,
  },
];

const catalogProducts = [
  {
    name: 'Cove Stoneware Mug',
    slug: 'cove-stoneware-mug',
    sku: 'MHB-DEMO-001',
    categoryId: seedId(1, 4),
    shortDescription: 'A rounded mug for a quiet coffee break.',
    description:
      'A softly shaped stoneware mug with a comfortable handle and a simple glazed finish.',
    brand: 'MartHub Studio',
    sellingUnit: 'each',
    isFeatured: true,
    isPopular: true,
    stock: 24,
    price: 149000n,
  },
  {
    name: 'Rill Glass Tumbler',
    slug: 'rill-glass-tumbler',
    sku: 'MHB-DEMO-002',
    categoryId: seedId(1, 4),
    shortDescription: 'A clear tumbler for everyday drinks.',
    description:
      'Straight sides and a steady base make this glass an easy choice for water or juice.',
    brand: 'MartHub Studio',
    sellingUnit: 'each',
    isPopular: true,
    stock: 32,
    price: 99000n,
  },
  {
    name: 'Mora Cotton Napkin Set',
    slug: 'mora-cotton-napkin-set',
    sku: 'MHB-DEMO-003',
    categoryId: seedId(1, 4),
    shortDescription: 'Four soft napkins for the daily table.',
    description:
      'A coordinated set of four cotton napkins with a plain woven texture.',
    brand: 'MartHub Studio',
    sellingUnit: 'set of 4',
    stock: 18,
    price: 119000n,
  },
  {
    name: 'Arc Desk Tray',
    slug: 'arc-desk-tray',
    sku: 'MHB-DEMO-004',
    categoryId: seedId(1, 2),
    shortDescription: 'A place for notes, pens, and small tools.',
    description:
      'This shallow desk tray keeps loose essentials together without taking over the work surface.',
    brand: 'MartHub Studio',
    sellingUnit: 'each',
    isFeatured: true,
    stock: 16,
    price: 179000n,
  },
  {
    name: 'Folio Dot Notebook',
    slug: 'folio-dot-notebook',
    sku: 'MHB-DEMO-005',
    categoryId: seedId(1, 2),
    shortDescription: 'A flexible notebook for lists and sketches.',
    description: 'Dot-grid pages leave room for writing, diagrams, and plans.',
    brand: 'MartHub Studio',
    sellingUnit: 'each',
    isNew: true,
    stock: 40,
    price: 69000n,
  },
  {
    name: 'Loop Pen Cup',
    slug: 'loop-pen-cup',
    sku: 'MHB-DEMO-006',
    categoryId: seedId(1, 2),
    shortDescription: 'A compact home for writing tools.',
    description: 'A simple open cup keeps frequently used pens within reach.',
    brand: 'MartHub Studio',
    sellingUnit: 'each',
    stock: 21,
    price: 89000n,
  },
  {
    name: 'Loom Canvas Tote',
    slug: 'loom-canvas-tote',
    sku: 'MHB-DEMO-007',
    categoryId: seedId(1, 3),
    shortDescription: 'An easy carryall for daily essentials.',
    description:
      'A roomy canvas tote with a plain shape and comfortable handles.',
    brand: 'MartHub Studio',
    sellingUnit: 'each',
    isFeatured: true,
    isNew: true,
    stock: 14,
    price: 139000n,
  },
  {
    name: 'Pocket Zip Pouch',
    slug: 'pocket-zip-pouch',
    sku: 'MHB-DEMO-008',
    categoryId: seedId(1, 3),
    shortDescription: 'A small pouch for items that travel together.',
    description:
      'A zip pouch sized for cables, notes, and other loose essentials.',
    brand: 'MartHub Studio',
    sellingUnit: 'each',
    stock: 0,
    price: 79000n,
  },
  {
    name: 'Harbor Felt Organizer',
    slug: 'harbor-felt-organizer',
    sku: 'MHB-DEMO-009',
    categoryId: seedId(1, 2),
    shortDescription: 'A flexible organizer for desk supplies.',
    description: 'A draft catalog example for future availability.',
    brand: 'MartHub Studio',
    sellingUnit: 'each',
    status: 'DRAFT',
    stock: 0,
    price: 189000n,
  },
  {
    name: 'Season Notes Planner',
    slug: 'season-notes-planner',
    sku: 'MHB-DEMO-010',
    categoryId: seedId(1, 5),
    shortDescription: 'A retired planner from an earlier collection.',
    description:
      'An archived catalog example that should not appear in public browsing.',
    brand: 'MartHub Studio',
    sellingUnit: 'each',
    status: 'ARCHIVED',
    archivedAt,
    stock: 0,
    price: 109000n,
  },
];
const products = catalogProducts.map(
  ({ stock: _stock, price: _price, ...product }, index) => ({
    ...product,
    id: seedId(2, index + 1),
    status: product.status ?? 'ACTIVE',
    isFeatured: product.isFeatured ?? false,
    isNew: product.isNew ?? false,
    isPopular: product.isPopular ?? false,
    publishedAt: product.status ? null : publishedAt,
    createdAt,
    updatedAt: createdAt,
  }),
);

const prices = products.map((product, index) => ({
  id: seedId(3, index + 2),
  productId: product.id,
  price: catalogProducts[index].price,
  compareAtPrice: index === 0 ? 179000n : null,
  startsAt: currentPriceAt,
  createdAt,
}));
prices.unshift({
  id: seedId(3, 1),
  productId: seedId(2, 1),
  price: 179000n,
  compareAtPrice: null,
  startsAt: createdAt,
  endsAt: currentPriceAt,
  createdAt,
});
const inventory = catalogProducts.map(({ stock: quantityOnHand }, index) => ({
  id: seedId(4, index + 1),
  productId: seedId(2, index + 1),
  quantityOnHand,
  updatedAt: createdAt,
}));
const promotions = [
  {
    title: 'Make room for small rituals',
    subtitle: 'Everyday pieces for the table.',
    internalHref: '/category/tabletop',
    placement: 'HERO_PRIMARY',
    status: 'ACTIVE',
    sortOrder: 0,
    startsAt: createdAt,
  },
  {
    title: 'A calmer workday',
    subtitle: 'Keep useful things close at hand.',
    internalHref: '/category/desk-paper',
    placement: 'HERO_SECONDARY',
    status: 'ACTIVE',
    sortOrder: 0,
    startsAt: createdAt,
  },
  {
    title: 'Carry what matters',
    subtitle: 'Simple companions for daily trips.',
    internalHref: '/category/on-the-go',
    placement: 'EDITORIAL',
    status: 'ACTIVE',
    sortOrder: 0,
    startsAt: createdAt,
  },
  {
    title: 'A fresh page ahead',
    subtitle: 'A scheduled desk collection.',
    internalHref: '/category/desk-paper',
    placement: 'EDITORIAL',
    status: 'DRAFT',
    sortOrder: 1,
    startsAt: new Date('2030-01-01T00:00:00.000Z'),
  },
  {
    title: 'Past season edit',
    subtitle: 'A retired collection example.',
    internalHref: '/category/past-seasons',
    placement: 'EDITORIAL',
    status: 'ARCHIVED',
    sortOrder: 2,
    startsAt: createdAt,
    endsAt: archivedAt,
    archivedAt,
  },
].map((promotion, index) => ({
  ...promotion,
  id: seedId(5, index + 1),
  createdAt,
  updatedAt: createdAt,
}));

const database = createDatabase(validateDatabaseUrl(process.env.DATABASE_URL));
try {
  const created = await database.prisma.$transaction(async (tx) => ({
    categories:
      (await tx.category.createMany({ data: categories, skipDuplicates: true }))
        .count +
      (
        await tx.category.createMany({
          data: childCategories,
          skipDuplicates: true,
        })
      ).count,
    products: (
      await tx.product.createMany({ data: products, skipDuplicates: true })
    ).count,
    prices: (
      await tx.productPriceHistory.createMany({
        data: prices,
        skipDuplicates: true,
      })
    ).count,
    inventory: (
      await tx.inventory.createMany({ data: inventory, skipDuplicates: true })
    ).count,
    promotions: (
      await tx.promotion.createMany({ data: promotions, skipDuplicates: true })
    ).count,
  }));
  console.log(`MartHub catalog seed: ${JSON.stringify(created)}`);
} finally {
  await database.close();
}
