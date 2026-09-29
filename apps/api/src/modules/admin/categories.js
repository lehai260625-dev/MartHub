import {
  adminCategoryCreateSchema,
  adminCategoryIdSchema,
  adminCategoryListResponseSchema,
  adminCategoryResponseSchema,
  adminCategoryUpdateSchema,
} from '@marthub/contracts';
import { ApiError } from '../../middleware/platform.js';

const parentSelect = { id: true, name: true, slug: true };
const categorySelect = {
  id: true,
  parentId: true,
  name: true,
  slug: true,
  description: true,
  status: true,
  sortOrder: true,
  archivedAt: true,
  parent: { select: parentSelect },
  _count: { select: { children: true, products: true } },
};

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

function categoryId(value) {
  const parsed = adminCategoryIdSchema.safeParse(value);
  if (!parsed.success)
    throw new ApiError(404, 'NOT_FOUND', 'Resource not found.');
  return parsed.data;
}

function toCategory(row) {
  return {
    id: row.id,
    parentId: row.parentId,
    name: row.name,
    slug: row.slug,
    description: row.description,
    status: row.status,
    sortOrder: row.sortOrder,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    parent: row.parent,
    childCount: row._count.children,
    productCount: row._count.products,
  };
}

function notFound() {
  throw new ApiError(404, 'NOT_FOUND', 'Resource not found.');
}

function treeError(message, field = 'parentId') {
  throw new ApiError(422, 'INVALID_CATEGORY_TREE', message, [
    { field, message },
  ]);
}

function cycleError() {
  throw new ApiError(
    409,
    'CATEGORY_CYCLE',
    'A category cannot be moved beneath itself or one of its descendants.',
  );
}

async function lockTree(tx) {
  await tx.$queryRawUnsafe(
    'SELECT "id" FROM "categories" ORDER BY "id" FOR UPDATE',
  );
}

async function treeRows(tx) {
  return tx.category.findMany({
    select: {
      id: true,
      parentId: true,
      status: true,
      archivedAt: true,
    },
  });
}

function validateParent(rows, parentId, currentId = null) {
  if (parentId === null) return;
  const byId = new Map(rows.map((row) => [row.id, row]));
  const parent = byId.get(parentId);
  if (!parent) treeError('Select an existing parent category.');

  let cursor = parent;
  const visited = new Set();
  while (cursor) {
    if (cursor.id === currentId) cycleError();
    if (visited.has(cursor.id)) cycleError();
    visited.add(cursor.id);
    cursor = cursor.parentId ? byId.get(cursor.parentId) : null;
  }

  if (parent.parentId !== null)
    treeError('Categories support only a top-level and one child level.');
  if (parent.status !== 'ACTIVE' || parent.archivedAt !== null)
    treeError('Select an active parent category.');
  if (
    currentId &&
    rows.some(
      (row) =>
        row.parentId === currentId &&
        row.status === 'ACTIVE' &&
        row.archivedAt === null,
    )
  )
    treeError('A category with active children must remain top-level.');
}

function mapConflict(error) {
  if (error?.code === 'P2002')
    throw new ApiError(
      409,
      'SLUG_CONFLICT',
      'A category already uses this slug.',
      [{ field: 'slug', message: 'Choose a different slug.' }],
    );
  throw error;
}

async function findCategory(tx, id) {
  const row = await tx.category.findUnique({
    where: { id: categoryId(id) },
    select: categorySelect,
  });
  if (!row) notFound();
  return row;
}

export function createAdminCategoryService({ prisma }) {
  return {
    async list() {
      const rows = await prisma.category.findMany({
        orderBy: [
          { parentId: { sort: 'asc', nulls: 'first' } },
          { sortOrder: 'asc' },
          { name: 'asc' },
          { id: 'asc' },
        ],
        select: categorySelect,
      });
      return adminCategoryListResponseSchema.parse({
        data: rows.map(toCategory),
      }).data;
    },

    async get(id) {
      return adminCategoryResponseSchema.parse({
        data: toCategory(await findCategory(prisma, id)),
      }).data;
    },

    async create(input) {
      const data = parse(adminCategoryCreateSchema, input);
      try {
        return await prisma.$transaction(async (tx) => {
          await lockTree(tx);
          const rows = await treeRows(tx);
          validateParent(rows, data.parentId);
          const row = await tx.category.create({
            data,
            select: categorySelect,
          });
          return adminCategoryResponseSchema.parse({
            data: toCategory(row),
          }).data;
        });
      } catch (error) {
        mapConflict(error);
      }
    },

    async update(id, input) {
      const categoryIdValue = categoryId(id);
      const data = parse(adminCategoryUpdateSchema, input);
      return prisma.$transaction(async (tx) => {
        await lockTree(tx);
        const existing = await findCategory(tx, categoryIdValue);
        if (Object.hasOwn(data, 'parentId')) {
          const rows = await treeRows(tx);
          validateParent(rows, data.parentId, existing.id);
        }
        const row = await tx.category.update({
          where: { id: existing.id },
          data,
          select: categorySelect,
        });
        return adminCategoryResponseSchema.parse({
          data: toCategory(row),
        }).data;
      });
    },

    async archive(id, now = new Date()) {
      const categoryIdValue = categoryId(id);
      return prisma.$transaction(async (tx) => {
        await lockTree(tx);
        const existing = await findCategory(tx, categoryIdValue);
        if (existing.status === 'ARCHIVED') return toCategory(existing);
        const activeChild = await tx.category.findFirst({
          where: {
            parentId: existing.id,
            status: 'ACTIVE',
            archivedAt: null,
          },
          select: { id: true },
        });
        if (activeChild)
          throw new ApiError(
            409,
            'CATEGORY_HAS_ACTIVE_CHILDREN',
            'Archive active child categories first.',
          );
        const row = await tx.category.update({
          where: { id: existing.id },
          data: { status: 'ARCHIVED', archivedAt: now },
          select: categorySelect,
        });
        return adminCategoryResponseSchema.parse({
          data: toCategory(row),
        }).data;
      });
    },
  };
}
