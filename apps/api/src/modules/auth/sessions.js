import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { ApiError } from '../../middleware/platform.js';
import { publicUserSelect } from './credentials.js';
import { signAccessToken } from './tokens.js';

export const hashRefreshToken = (value) =>
  createHash('sha256').update(value).digest('hex');
const unauthorized = () =>
  new ApiError(401, 'UNAUTHORIZED', 'Please sign in again.');
export async function lockUser(tx, userId) {
  await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
}

export function createSessionService({
  prisma,
  config,
  clock = () => new Date(),
}) {
  async function response(user, session, refreshToken, now) {
    return {
      data: {
        user,
        accessToken: await signAccessToken(user, session.id, config, now),
        expiresIn: config.accessSeconds,
      },
      refreshToken,
      expiresAt: session.expiresAt,
    };
  }
  const metadata = ({ ip, userAgent } = {}) => ({
    ipAddress: typeof ip === 'string' ? ip.slice(0, 64) : null,
    userAgent: typeof userAgent === 'string' ? userAgent.slice(0, 512) : null,
  });
  return {
    async issue(userId, info = {}) {
      const now = clock();
      const refreshToken = randomBytes(32).toString('base64url');
      const result = await prisma.$transaction(async (tx) => {
        await lockUser(tx, userId);
        const user = await tx.user.findFirst({
          where: { id: userId, status: 'ACTIVE', archivedAt: null },
          select: publicUserSelect,
        });
        if (!user) throw unauthorized();
        const session = await tx.refreshSession.create({
          data: {
            userId,
            familyId: randomUUID(),
            tokenHash: hashRefreshToken(refreshToken),
            expiresAt: new Date(now.getTime() + config.refreshSeconds * 1000),
            ...metadata(info),
          },
        });
        return { user, session };
      });
      return response(result.user, result.session, refreshToken, now);
    },
    async rotate(rawToken, info = {}) {
      if (typeof rawToken !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(rawToken))
        throw unauthorized();
      const tokenHash = hashRefreshToken(rawToken);
      const candidate = await prisma.refreshSession.findUnique({
        where: { tokenHash },
      });
      if (!candidate) throw unauthorized();
      const now = clock();
      const refreshToken = randomBytes(32).toString('base64url');
      const result = await prisma.$transaction(async (tx) => {
        // All session mutations serialize on the owning user, including family-wide revocation.
        await lockUser(tx, candidate.userId);
        const current = await tx.refreshSession.findUnique({
          where: { id: candidate.id },
        });
        if (!current) return null;
        if (current.revokedAt) {
          if (current.revokeReason === 'ROTATED') {
            await tx.refreshSession.updateMany({
              where: {
                userId: current.userId,
                familyId: current.familyId,
                revokedAt: null,
              },
              data: { revokedAt: now, revokeReason: 'REUSE_DETECTED' },
            });
          }
          return null; // Commit revocation before returning an unauthorized response.
        }
        const user = await tx.user.findFirst({
          where: { id: current.userId, status: 'ACTIVE', archivedAt: null },
          select: publicUserSelect,
        });
        if (!user || current.expiresAt <= now) {
          await tx.refreshSession.updateMany({
            where: {
              userId: current.userId,
              familyId: current.familyId,
              revokedAt: null,
            },
            data: {
              revokedAt: now,
              revokeReason: !user ? 'ACCOUNT_DISABLED' : 'EXPIRED',
            },
          });
          return null;
        }
        await tx.refreshSession.update({
          where: { id: current.id },
          data: { revokedAt: now, lastUsedAt: now, revokeReason: 'ROTATED' },
        });
        const session = await tx.refreshSession.create({
          data: {
            userId: current.userId,
            familyId: current.familyId,
            parentSessionId: current.id,
            tokenHash: hashRefreshToken(refreshToken),
            expiresAt: current.expiresAt,
            ...metadata(info),
          },
        });
        return { user, session };
      });
      if (!result) throw unauthorized();
      return response(result.user, result.session, refreshToken, now);
    },
  };
}
