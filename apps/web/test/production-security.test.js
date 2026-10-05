import { afterEach, expect, test, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { proxy } from '../proxy';
import { readApiOrigin } from '../lib/security/env';
import { getWebOrigin } from '../features/catalog/catalog-seo';

afterEach(() => vi.unstubAllEnvs());
test('production config has no silent local origin fallback or leaked input', () => {
  const production = { NODE_ENV: 'production' };
  expect(() => readApiOrigin(production)).toThrow(/explicitly configured/);
  expect(() => getWebOrigin(production)).toThrow(/required/);
  expect(() =>
    getWebOrigin({ ...production, WEB_ORIGIN: 'http://shop.example.test' }),
  ).toThrow(/HTTPS/);
  expect(
    readApiOrigin({
      ...production,
      API_INTERNAL_ORIGIN: 'http://api.internal:4000',
    }),
  ).toBe('http://api.internal:4000');
  expect(
    getWebOrigin({ ...production, WEB_ORIGIN: 'https://shop.example.test' }),
  ).toBe('https://shop.example.test');
  for (const value of [
    'invalid-secret',
    'http://user:secret@api.internal',
    'http://api.internal/path',
    'http://api.internal?token=secret',
  ]) {
    try {
      readApiOrigin({ ...production, API_INTERNAL_ORIGIN: value });
      throw new Error('Expected failure');
    } catch (error) {
      expect(error.message).not.toContain('secret');
    }
  }
});
test('production CSP uses distinct unpredictable nonces and overwrites forged request headers', () => {
  vi.stubEnv('NODE_ENV', 'production');
  const request = new NextRequest('https://shop.example.test/cart', {
    headers: {
      'x-nonce': 'forged',
      'Content-Security-Policy': "script-src 'unsafe-inline'",
    },
  });
  const first = proxy(request),
    second = proxy(request);
  const policy = first.headers.get('Content-Security-Policy');
  const script = policy
    .split('; ')
    .find((value) => value.startsWith('script-src'));
  expect(script).toMatch(/^script-src 'self' 'nonce-[A-Za-z0-9+/=]+'$/);
  expect(script).not.toContain('unsafe-inline');
  expect(policy).not.toMatch(/unsafe-eval|\*|font-src.*data:/);
  expect(policy).toContain('https://api.cloudinary.com');
  expect(policy).toContain("frame-ancestors 'none'");
  expect(first.headers.get('x-middleware-request-x-nonce')).not.toBe('forged');
  expect(
    first.headers.get('x-middleware-request-content-security-policy'),
  ).toBe(policy);
  expect(policy).not.toBe(second.headers.get('Content-Security-Policy'));
  expect(first.headers.get('Cache-Control')).toContain('no-store');
});
test('development does not inherit the production nonce restriction', () => {
  vi.stubEnv('NODE_ENV', 'development');
  expect(
    proxy(new NextRequest('http://localhost:3000')).headers.has(
      'Content-Security-Policy',
    ),
  ).toBe(false);
});
