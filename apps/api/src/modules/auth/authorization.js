import { publicUserSchema } from '@marthub/contracts';
import { ApiError } from '../../middleware/platform.js';
import { publicUserSelect } from './credentials.js';
import { verifyAccessToken } from './tokens.js';

const unauthorized = () =>
  new ApiError(401, 'UNAUTHORIZED', 'Please sign in again.');
export function requireAuthentication({
  prisma,
  config,
  clock = () => new Date(),
}) {
  return async (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    const match =
      /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i.exec(
        req.get('authorization') || '',
      );
    if (!match) throw unauthorized();
    const now = clock();
    const claims = await verifyAccessToken(match[1], config, now);
    const session = await prisma.refreshSession.findFirst({
      where: {
        id: claims.sid,
        userId: claims.sub,
        revokedAt: null,
        expiresAt: { gt: now },
        user: { status: 'ACTIVE', archivedAt: null },
      },
      select: { id: true, user: { select: publicUserSelect } },
    });
    if (!session) throw unauthorized();
    // Current database role is authoritative; a stale ADMIN claim confers no privilege.
    req.auth = { user: session.user, sessionId: session.id, claims };
    next();
  };
}

export function requireRoles(...roles) {
  return (req, res, next) => {
    if (!req.auth) throw unauthorized();
    if (!roles.includes(req.auth.user.role))
      throw new ApiError(
        403,
        'FORBIDDEN',
        'You do not have permission to perform this action.',
      );
    next();
  };
}

export function ownedWhere(auth, criteria = {}) {
  if (!auth?.user?.id) throw unauthorized();
  return { AND: [criteria, { userId: auth.user.id }] };
}
export function ownedResourceId(value) {
  if (!publicUserSchema.shape.id.safeParse(value).success)
    throw new ApiError(404, 'NOT_FOUND', 'Resource not found.');
  return value;
}
export function requireOwnedResource(resource) {
  if (!resource) throw new ApiError(404, 'NOT_FOUND', 'Resource not found.');
  return resource;
}
