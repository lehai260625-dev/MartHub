export function safeReturnTo(value) {
  if (
    typeof value !== 'string' ||
    value.length > 2048 ||
    !value.startsWith('/')
  )
    return '/account';
  let decoded = value;
  try {
    for (let i = 0; i < 3; i++) {
      if (/^[\/]{2}|[\\\u0000-\u0020]/.test(decoded)) return '/account';
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    }
    if (/^[\/]{2}|[\\\u0000-\u0020]|%[0-9a-f]{2}/i.test(decoded))
      return '/account';
    const url = new URL(value, 'https://marthub.invalid');
    const decodedUrl = new URL(decoded, 'https://marthub.invalid');
    if (
      url.origin !== 'https://marthub.invalid' ||
      decodedUrl.origin !== url.origin ||
      /^\/(login|register)(\/|$)/.test(decodedUrl.pathname) ||
      decodedUrl.pathname.startsWith('/api/')
    )
      return '/account';
    return url.pathname + url.search + url.hash;
  } catch {
    return '/account';
  }
}
