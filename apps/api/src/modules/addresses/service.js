import {
  addressCreateSchema,
  addressSchema,
  addressUpdateSchema,
} from '@marthub/contracts';
import { ApiError } from '../../middleware/platform.js';
import {
  ownedResourceId,
  ownedWhere,
  requireOwnedResource,
} from '../auth/authorization.js';

const addressSelect = {
  id: true,
  label: true,
  recipientName: true,
  phone: true,
  line1: true,
  line2: true,
  ward: true,
  district: true,
  province: true,
  postalCode: true,
  isDefault: true,
};

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

async function lockUser(tx, userId) {
  await tx.$queryRaw`SELECT "id" FROM "users" WHERE "id" = ${userId}::uuid FOR UPDATE`;
}

async function findOwned(tx, auth, id) {
  return requireOwnedResource(
    await tx.address.findFirst({
      where: ownedWhere(auth, {
        id: ownedResourceId(id),
        archivedAt: null,
      }),
      select: addressSelect,
    }),
  );
}

export function createAddressService({ prisma }) {
  return {
    async list(auth) {
      const rows = await prisma.address.findMany({
        where: { userId: auth.user.id, archivedAt: null },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
        select: addressSelect,
      });
      return rows.map((row) => addressSchema.parse(row));
    },

    async create(auth, input) {
      const { isDefault = false, ...data } = parse(addressCreateSchema, input);
      return prisma.$transaction(async (tx) => {
        await lockUser(tx, auth.user.id);
        const existing = await tx.address.findFirst({
          where: { userId: auth.user.id, archivedAt: null },
          select: { id: true },
        });
        const makeDefault = isDefault || !existing;
        if (makeDefault)
          await tx.address.updateMany({
            where: { userId: auth.user.id, archivedAt: null, isDefault: true },
            data: { isDefault: false },
          });
        return addressSchema.parse(
          await tx.address.create({
            data: { ...data, userId: auth.user.id, isDefault: makeDefault },
            select: addressSelect,
          }),
        );
      });
    },

    async update(auth, id, input) {
      const data = parse(addressUpdateSchema, input);
      return prisma.$transaction(async (tx) => {
        await lockUser(tx, auth.user.id);
        const owned = await findOwned(tx, auth, id);
        return addressSchema.parse(
          await tx.address.update({
            where: { id: owned.id },
            data,
            select: addressSelect,
          }),
        );
      });
    },

    async remove(auth, id) {
      return prisma.$transaction(async (tx) => {
        await lockUser(tx, auth.user.id);
        const owned = await findOwned(tx, auth, id);
        await tx.address.update({
          where: { id: owned.id },
          data: { archivedAt: new Date(), isDefault: false },
        });
      });
    },

    async makeDefault(auth, id) {
      return prisma.$transaction(async (tx) => {
        await lockUser(tx, auth.user.id);
        const owned = await findOwned(tx, auth, id);
        await tx.address.updateMany({
          where: {
            userId: auth.user.id,
            archivedAt: null,
            isDefault: true,
            id: { not: owned.id },
          },
          data: { isDefault: false },
        });
        return addressSchema.parse(
          await tx.address.update({
            where: { id: owned.id },
            data: { isDefault: true },
            select: addressSelect,
          }),
        );
      });
    },
  };
}
