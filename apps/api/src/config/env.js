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
  };
}
