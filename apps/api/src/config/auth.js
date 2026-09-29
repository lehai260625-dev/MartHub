export function readAuthConfig(env = process.env) {
  if (!/^[a-fA-F0-9]{64}$/.test(env.AUTH_JWT_SECRET || ''))
    throw new Error(
      'AUTH_JWT_SECRET must contain 32 random bytes encoded as 64 hexadecimal characters.',
    );
  const production = env.NODE_ENV === 'production';
  let origin;
  try {
    const url = new URL(
      env.WEB_ORIGIN || (production ? '' : 'http://localhost:3000'),
    );
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash ||
      (production && url.protocol !== 'https:')
    )
      throw new Error();
    if (
      !production &&
      url.protocol === 'http:' &&
      !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    )
      throw new Error();
    origin = url.origin;
  } catch {
    throw new Error(
      'WEB_ORIGIN must use HTTPS except for local development/test loopback.',
    );
  }
  return {
    secret: Buffer.from(env.AUTH_JWT_SECRET, 'hex'),
    issuer: 'marthub-api',
    audience: 'marthub-web',
    accessSeconds: 900,
    refreshSeconds: 30 * 24 * 60 * 60,
    secureCookies: production || origin.startsWith('https:'),
    origin,
  };
}
