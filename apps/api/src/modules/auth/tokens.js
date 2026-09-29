import { randomUUID } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { publicUserSchema } from '@marthub/contracts';
import { ApiError } from '../../middleware/platform.js';

export function signAccessToken(user, sessionId, config, now = new Date()) {
  const issued = Math.floor(now.getTime() / 1000);
  return new SignJWT({ role: user.role, sid: sessionId })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(user.id)
    .setJti(randomUUID())
    .setIssuer(config.issuer)
    .setAudience(config.audience)
    .setIssuedAt(issued)
    .setExpirationTime(issued + config.accessSeconds)
    .sign(config.secret);
}

export async function verifyAccessToken(token, config, now = new Date()) {
  try {
    const { payload, protectedHeader } = await jwtVerify(token, config.secret, {
      algorithms: ['HS256'],
      issuer: config.issuer,
      audience: config.audience,
      currentDate: now,
      requiredClaims: ['sub', 'sid', 'role', 'jti', 'iat', 'exp'],
    });
    if (
      protectedHeader.typ !== 'JWT' ||
      !['CUSTOMER', 'ADMIN'].includes(payload.role) ||
      ![payload.sub, payload.sid, payload.jti].every(
        (value) => publicUserSchema.shape.id.safeParse(value).success,
      ) ||
      !Number.isInteger(payload.iat) ||
      !Number.isInteger(payload.exp) ||
      payload.iat > Math.floor(now.getTime() / 1000) + 5 ||
      payload.exp <= payload.iat ||
      payload.exp - payload.iat > config.accessSeconds
    )
      throw new Error();
    return payload;
  } catch {
    throw new ApiError(401, 'UNAUTHORIZED', 'Please sign in again.');
  }
}
