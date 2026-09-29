import { profileUpdateSchema, publicUserSchema } from '@marthub/contracts';
import { ApiError } from '../../middleware/platform.js';
import { publicUserSelect } from '../auth/credentials.js';

export function parseProfileUpdate(input) {
  const result = profileUpdateSchema.safeParse(input);
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

export function createProfileService({ prisma }) {
  return {
    async update(userId, input) {
      const data = parseProfileUpdate(input);
      try {
        const user = await prisma.user.update({
          where: { id: userId, status: 'ACTIVE', archivedAt: null },
          data,
          select: publicUserSelect,
        });
        return publicUserSchema.parse(user);
      } catch (error) {
        if (error.code === 'P2025')
          throw new ApiError(401, 'UNAUTHORIZED', 'Please sign in again.');
        throw error;
      }
    },
  };
}
