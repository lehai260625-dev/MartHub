import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import test from 'node:test';
import { SignJWT } from 'jose';
import { readAuthConfig } from '../src/config/auth.js';
import {
  signAccessToken,
  verifyAccessToken,
} from '../src/modules/auth/tokens.js';

const config = readAuthConfig({
  AUTH_JWT_SECRET: randomBytes(32).toString('hex'),
  WEB_ORIGIN: 'http://localhost:3000',
  NODE_ENV: 'test',
});

test('auth configuration validates key material and production HTTPS', () => {
  assert.equal(config.secret.length, 32);
  assert.equal(config.accessSeconds, 900);
  assert.equal(config.refreshSeconds, 2592000);
  assert.equal(config.secureCookies, false);
  for (const secret of [
    undefined,
    '',
    'x'.repeat(64),
    'aa'.repeat(31),
    'aa'.repeat(33),
  ]) {
    assert.throws(() =>
      readAuthConfig({
        AUTH_JWT_SECRET: secret,
        WEB_ORIGIN: config.origin,
        NODE_ENV: 'test',
      }),
    );
  }
  assert.throws(() =>
    readAuthConfig({
      AUTH_JWT_SECRET: randomBytes(32).toString('hex'),
      WEB_ORIGIN: config.origin,
      NODE_ENV: 'production',
    }),
  );
  assert.equal(
    readAuthConfig({
      AUTH_JWT_SECRET: randomBytes(32).toString('hex'),
      WEB_ORIGIN: 'https://shop.example.test',
      NODE_ENV: 'production',
    }).secureCookies,
    true,
  );
});

test('access JWT contains only authorization identifiers and expires at the boundary', async () => {
  const now = new Date('2026-09-14T00:00:00Z');
  const user = {
    id: randomUUID(),
    role: 'CUSTOMER',
    email: 'private@example.test',
    phone: '0901234567',
    passwordHash: 'secret',
    firstName: 'Private',
  };
  const sid = randomUUID();
  const token = await signAccessToken(user, sid, config, now);
  const claims = await verifyAccessToken(token, config, now);
  assert.equal(claims.sub, user.id);
  assert.equal(claims.sid, sid);
  assert.equal(claims.role, 'CUSTOMER');
  assert.equal(claims.iss, config.issuer);
  assert.equal(claims.aud, config.audience);
  assert.equal(claims.exp - claims.iat, 900);
  assert.ok(
    Object.keys(claims).every((key) =>
      ['sub', 'role', 'sid', 'jti', 'iss', 'aud', 'iat', 'exp'].includes(key),
    ),
  );
  await assert.rejects(
    verifyAccessToken(token, config, new Date(now.getTime() + 900000)),
    { status: 401 },
  );
  await assert.rejects(
    verifyAccessToken(token, { ...config, secret: randomBytes(32) }, now),
    { status: 401 },
  );
});

test('JWT rejects wrong issuer, audience, algorithm, malformed and unsigned tokens', async () => {
  const now = new Date();
  const claims = {
    jti: randomUUID(),
    sub: randomUUID(),
    sid: randomUUID(),
    role: 'CUSTOMER',
    iss: config.issuer,
    aud: config.audience,
    iat: Math.floor(now.getTime() / 1000),
    exp: Math.floor(now.getTime() / 1000) + 900,
  };
  const control = await new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .sign(config.secret);
  assert.equal((await verifyAccessToken(control, config, now)).jti, claims.jti);
  for (const [changes, alg] of [
    [{ iss: 'other-api' }, 'HS256'],
    [{ aud: 'other-web' }, 'HS256'],
    [{}, 'HS384'],
  ]) {
    const token = await new SignJWT({ ...claims, ...changes })
      .setProtectedHeader({ alg, typ: 'JWT' })
      .sign(config.secret);
    await assert.rejects(verifyAccessToken(token, config, now), {
      status: 401,
    });
  }
  for (const token of [
    '',
    'not-a-jwt',
    `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.`,
  ]) {
    await assert.rejects(verifyAccessToken(token, config, now), {
      status: 401,
    });
  }
});
