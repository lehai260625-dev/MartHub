import { hashRefreshToken, lockUser } from './sessions.js';

export function createRevocationService({ prisma, clock = () => new Date() }) {
  return {
    async logout(rawToken) {
      if (typeof rawToken !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(rawToken))
        return;
      const candidate = await prisma.refreshSession.findUnique({
        where: { tokenHash: hashRefreshToken(rawToken) },
        select: { userId: true, familyId: true },
      });
      if (!candidate) return;
      await prisma.$transaction(async (tx) => {
        await lockUser(tx, candidate.userId);
        await tx.refreshSession.updateMany({
          where: {
            userId: candidate.userId,
            familyId: candidate.familyId,
            revokedAt: null,
          },
          data: { revokedAt: clock(), revokeReason: 'LOGOUT' },
        });
      });
    },
    async logoutAll(userId) {
      await prisma.$transaction(async (tx) => {
        await lockUser(tx, userId);
        await tx.refreshSession.updateMany({
          where: { userId, revokedAt: null },
          data: { revokedAt: clock(), revokeReason: 'LOGOUT_ALL' },
        });
      });
    },
  };
}
