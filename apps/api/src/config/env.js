export function validateDatabaseUrl(value) {
  try {
    const url = new URL(value);
    if (
      !['postgres:', 'postgresql:'].includes(url.protocol) ||
      !url.hostname ||
      url.pathname.length < 2
    )
      throw new Error();
    return value;
  } catch {
    throw new Error(
      'DATABASE_URL must be a PostgreSQL URL with a host and database name.',
    );
  }
}

export function readShippingConfig(env = process.env) {
  const amount = (key, fallback) => {
    const value = env[key] ?? fallback;
    if (
      typeof value !== 'string' ||
      !/^(0|[1-9][0-9]*)$/.test(value) ||
      value.length > 19 ||
      BigInt(value) > 9223372036854775807n
    )
      throw new Error(
        `${key} must be a non-negative integer VND amount within BIGINT range.`,
      );
    return BigInt(value);
  };
  return Object.freeze({
    fixedFee: amount('SHIPPING_FIXED_FEE_VND', '30000'),
    freeThreshold: amount('SHIPPING_FREE_THRESHOLD_VND', '500000'),
  });
}

export function readEnv(env = process.env) {
  const port = Number(env.PORT || 4000);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('PORT must be an integer from 1 to 65535.');
  const nodeEnv = env.NODE_ENV || 'development';
  if (!['development', 'test', 'production'].includes(nodeEnv))
    throw new Error('NODE_ENV must be development, test, or production.');
  let origin;
  try {
    const url = new URL(
      env.WEB_ORIGIN ||
        (nodeEnv === 'production' ? '' : 'http://localhost:3000'),
    );
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash ||
      (nodeEnv === 'production' && url.protocol !== 'https:')
    )
      throw new Error();
    origin = url.origin;
  } catch {
    throw new Error(
      'WEB_ORIGIN must be an HTTP(S) origin, with HTTPS required in production.',
    );
  }
  return {
    port,
    host: env.HOST || '127.0.0.1',
    nodeEnv,
    origin,
    databaseUrl: validateDatabaseUrl(env.DATABASE_URL),
    shippingPolicy: readShippingConfig(env),
  };
}
