import { randomBytes } from 'node:crypto';
import {
  registerSchema,
  loginSchema,
  publicUserSchema,
} from '@marthub/contracts';
import { ApiError } from '../../middleware/platform.js';
import { hashPassword, verifyPassword } from './passwords.js';
import { createAuthThrottle } from './throttle.js';

export const publicUserSelect = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  phone: true,
  role: true,
  status: true,
};
let dummyHash;
function getDummyHash() {
  dummyHash ??= hashPassword(randomBytes(32).toString('hex'));
  return dummyHash;
}
function parse(schema, input) {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new ApiError(
      422,
      'VALIDATION_ERROR',
      'Check the submitted fields.',
      result.error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
      })),
    );
  }
  return result.data;
}

export function createCredentials({
  prisma,
  throttle = createAuthThrottle({ prisma }),
}) {
  return {
    async register(input, { ip } = {}) {
      const data = parse(registerSchema, input);
      await throttle.consume('register', { ip, email: data.email });
      const passwordHash = await hashPassword(data.password);
      try {
        const user = await prisma.user.create({
          data: {
            email: data.email,
            passwordHash,
            firstName: data.firstName,
            lastName: data.lastName,
            phone: data.phone ?? null,
            role: 'CUSTOMER',
            status: 'ACTIVE',
          },
          select: publicUserSelect,
        });
        return publicUserSchema.parse(user);
      } catch (error) {
        if (error.code === 'P2002')
          throw new ApiError(
            409,
            'EMAIL_IN_USE',
            'An account already uses this email.',
          );
        throw error;
      }
    },
    async login(input, { ip } = {}) {
      const data = parse(loginSchema, input);
      await throttle.consume('login', { ip, email: data.email });
      const user = await prisma.user.findUnique({
        where: { email: data.email },
        select: { ...publicUserSelect, passwordHash: true, archivedAt: true },
      });
      const valid = await verifyPassword(
        user?.passwordHash ?? (await getDummyHash()),
        data.password,
      );
      if (!valid || !user || user.status !== 'ACTIVE' || user.archivedAt) {
        throw new ApiError(
          401,
          'INVALID_CREDENTIALS',
          'Email or password is incorrect.',
        );
      }
      const updated = await prisma.user
        .update({
          where: { id: user.id, status: 'ACTIVE', archivedAt: null },
          data: { lastLoginAt: new Date() },
          select: publicUserSelect,
        })
        .catch((error) => {
          if (error.code === 'P2025')
            throw new ApiError(
              401,
              'INVALID_CREDENTIALS',
              'Email or password is incorrect.',
            );
          throw error;
        });
      return publicUserSchema.parse(updated);
    },
  };
}
