import { Router } from 'express';
import { ApiError } from '../../middleware/platform.js';
import { createCredentials } from './credentials.js';
import { createSessionService } from './sessions.js';
import { createAuthThrottle } from './throttle.js';
import { requireAuthentication } from './authorization.js';
import { createRevocationService } from './revocation.js';

export const REFRESH_COOKIE = 'mh_refresh';
export function cookieOptions(config) {
  return {
    httpOnly: true,
    secure: config.secureCookies,
    sameSite: 'lax',
    path: '/api/v1/auth',
  };
}
export function readRefreshCookie(req) {
  const matches = (req.get('cookie') || '')
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.startsWith(REFRESH_COOKIE + '='));
  if (matches.length !== 1) return null;
  return matches[0].slice(REFRESH_COOKIE.length + 1);
}
export function requireAuthOrigin(config) {
  return (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (req.get('origin') !== config.origin)
      return next(
        new ApiError(
          403,
          'ORIGIN_NOT_ALLOWED',
          'Request origin is not allowed.',
        ),
      );
    next();
  };
}
export function createAuthRouter({ prisma, config }) {
  const router = Router();
  const credentials = createCredentials({ prisma });
  const sessions = createSessionService({ prisma, config });
  const revocations = createRevocationService({ prisma });
  const authenticate = requireAuthentication({ prisma, config });
  const requireEmptyBody = (req) => {
    if (
      req.body !== undefined &&
      (req.body === null ||
        typeof req.body !== 'object' ||
        Array.isArray(req.body) ||
        Object.keys(req.body).length)
    )
      throw new ApiError(
        422,
        'VALIDATION_ERROR',
        'This endpoint does not accept fields.',
      );
  };
  const refreshThrottle = createAuthThrottle({
    prisma,
    ipLimit: 300,
    accountLimit: 300,
  });
  router.use(requireAuthOrigin(config));
  const info = (req) => ({ ip: req.ip, userAgent: req.get('user-agent') });
  function sendSession(res, result, status = 200) {
    res.cookie(REFRESH_COOKIE, result.refreshToken, {
      ...cookieOptions(config),
      expires: result.expiresAt,
    });
    res.status(status).json({ data: result.data });
  }
  for (const [path, status] of [
    ['register', 201],
    ['login', 200],
  ]) {
    router.post('/' + path, async (req, res) => {
      const user = await credentials[path](req.body, info(req));
      sendSession(res, await sessions.issue(user.id, info(req)), status);
    });
  }
  router.post('/refresh', async (req, res) => {
    if (
      req.body !== undefined &&
      (req.body === null ||
        typeof req.body !== 'object' ||
        Array.isArray(req.body) ||
        Object.keys(req.body).length)
    )
      throw new ApiError(
        422,
        'VALIDATION_ERROR',
        'This endpoint does not accept fields.',
      );
    await refreshThrottle.consume('refresh', { ip: req.ip, email: req.ip });
    try {
      sendSession(
        res,
        await sessions.rotate(readRefreshCookie(req), info(req)),
      );
    } catch (error) {
      if (error.status === 401)
        res.clearCookie(REFRESH_COOKIE, cookieOptions(config));
      throw error;
    }
  });
  router.post('/logout', async (req, res) => {
    requireEmptyBody(req);
    await revocations.logout(readRefreshCookie(req));
    res.clearCookie(REFRESH_COOKIE, cookieOptions(config));
    res.status(204).end();
  });
  router.post('/logout-all', authenticate, async (req, res) => {
    requireEmptyBody(req);
    await revocations.logoutAll(req.auth.user.id);
    res.clearCookie(REFRESH_COOKIE, cookieOptions(config));
    res.status(204).end();
  });
  return router;
}
