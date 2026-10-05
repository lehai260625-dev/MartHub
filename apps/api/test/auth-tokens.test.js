import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import test from 'node:test';
import { SignJWT } from 'jose';
import { readAuthConfig } from '../src/config/auth.js';
import { readRefreshCookie } from '../src/modules/auth/routes.js';
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

test('signed JWT rejects missing, malformed and unsafe lifetime claims with a safe error', async () => {
  const now = new Date('2026-10-05T00:00:00Z');
  const issued = Math.floor(now.getTime() / 1000);
  const claims = {
    sub: randomUUID(),
    sid: randomUUID(),
    jti: randomUUID(),
    role: 'CUSTOMER',
    iss: config.issuer,
    aud: config.audience,
    iat: issued,
    exp: issued + 900,
  };
  const sign = (payload, typ = 'JWT') =>
    new SignJWT(payload)
      .setProtectedHeader({ alg: 'HS256', typ })
      .sign(config.secret);
  const invalid = [];
  for (const field of ['sub', 'sid', 'jti', 'role', 'iat', 'exp']) {
    const missing = { ...claims };
    delete missing[field];
    invalid.push(missing);
  }
  for (const field of ['sub', 'sid', 'jti'])
    for (const value of ['not-a-uuid', null, 123])
      invalid.push({ ...claims, [field]: value });
  for (const changes of [
    { role: 'SUPERADMIN' },
    { role: null },
    { iat: issued + 6 },
    { iat: issued + 0.5 },
    { iat: String(issued) },
    { exp: issued },
    { exp: issued - 1 },
    { exp: issued + 901 },
    { exp: issued + 899.5 },
    { exp: String(issued + 900) },
    { nbf: issued + 1 },
  ])
    invalid.push({ ...claims, ...changes });
  for (const payload of invalid)
    await assert.rejects(verifyAccessToken(await sign(payload), config, now), {
      status: 401,
      code: 'UNAUTHORIZED',
      message: 'Please sign in again.',
    });
  await assert.rejects(
    verifyAccessToken(await sign(claims, 'other'), config, now),
    {
      status: 401,
      code: 'UNAUTHORIZED',
    },
  );
  for (const role of ['CUSTOMER', 'ADMIN'])
    assert.equal(
      (await verifyAccessToken(await sign({ ...claims, role }), config, now))
        .role,
      role,
    );
  assert.equal(
    (
      await verifyAccessToken(
        await sign({ ...claims, iat: issued + 5 }),
        config,
        now,
      )
    ).iat,
    issued + 5,
  );
});

test('refresh cookie parser accepts exactly one exact cookie name and rejects ambiguous credentials', () => {
  const read = (cookie) => readRefreshCookie({ get: () => cookie });
  assert.equal(read(undefined), null);
  assert.equal(
    read('other=value; mh_refresh=opaque; trailing=value'),
    'opaque',
  );
  assert.equal(read('  mh_refresh=opaque  '), 'opaque');
  for (const cookie of [
    'mh_refresh=first; mh_refresh=second',
    'mh_refresh=same; mh_refresh=same',
    'prefix_mh_refresh=opaque',
    'mh_refresh_extra=opaque',
    'MH_REFRESH=opaque',
  ])
    assert.equal(read(cookie), null);
});
