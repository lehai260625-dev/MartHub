import assert from 'node:assert/strict';
import test from 'node:test';
import { readEnv, validateDatabaseUrl } from '../src/config/env.js';
import { readAuthConfig } from '../src/config/auth.js';
import { readMediaConfig } from '../src/config/media.js';
import { randomBytes } from 'node:crypto';

test('configuration rejects missing/invalid database and port without exposing secrets', () => {
  for (const value of [
    undefined,
    'https://user:secret@host/db',
    'postgresql://localhost',
  ]) {
    assert.throws(
      () => validateDatabaseUrl(value),
      (error) => !error.message.includes('secret'),
    );
  }
  assert.throws(() =>
    readEnv({ DATABASE_URL: 'postgresql://localhost/test', PORT: '-1' }),
  );
  assert.equal(
    readEnv({ DATABASE_URL: 'postgresql://localhost/test' }).port,
    4000,
  );
});

test('production required env fails fast without development fallbacks or secret values', () => {
  const env = {
    NODE_ENV: 'production',
    HOST: '127.0.0.1',
    PORT: '4000',
    DATABASE_URL: 'postgresql://private.internal/test',
    WEB_ORIGIN: 'https://shop.example.test',
    SHIPPING_FIXED_FEE_VND: '30000',
    SHIPPING_FREE_THRESHOLD_VND: '500000',
  };
  for (const key of [
    'HOST',
    'PORT',
    'DATABASE_URL',
    'WEB_ORIGIN',
    'SHIPPING_FIXED_FEE_VND',
    'SHIPPING_FREE_THRESHOLD_VND',
  ]) {
    const copy = { ...env };
    delete copy[key];
    assert.throws(() => readEnv(copy), /required/);
  }
  assert.equal(readEnv(env).shippingPolicy.fixedFee, 30000n);
  for (const override of [
    { WEB_ORIGIN: 'http://shop.example.test' },
    { HOST: 'host/secret' },
    { PORT: '-1' },
    { DATABASE_URL: 'https://user:secret@example.test/db' },
    { SHIPPING_FIXED_FEE_VND: 'secret' },
  ]) {
    assert.throws(
      () => readEnv({ ...env, ...override }),
      (error) => !error.message.includes('secret'),
    );
  }
  assert.throws(() => readAuthConfig(env));
  assert.equal(
    readAuthConfig({ ...env, AUTH_JWT_SECRET: randomBytes(32).toString('hex') })
      .secureCookies,
    true,
  );
  assert.throws(() => readMediaConfig(env));
  assert.throws(
    () =>
      readMediaConfig({
        ...env,
        CLOUDINARY_CLOUD_NAME: 'replace-with-cloud-name',
        CLOUDINARY_API_KEY: 'replace-with-api-key',
        CLOUDINARY_API_SECRET: 'replace-with-api-secret',
      }),
    /placeholders/,
  );
});
