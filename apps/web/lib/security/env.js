export function readApiOrigin(env = process.env) {
  const value =
    env.API_INTERNAL_ORIGIN ||
    (env.NODE_ENV === 'production' ? '' : 'http://127.0.0.1:4000');
  try {
    const url = new URL(value);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    )
      throw new Error();
    return url.origin;
  } catch {
    throw new Error(
      'API_INTERNAL_ORIGIN must be explicitly configured in production as an HTTP(S) origin without credentials or a path.',
    );
  }
}
