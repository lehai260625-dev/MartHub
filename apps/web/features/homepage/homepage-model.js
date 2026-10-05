import { parseCatalogQuery } from '../catalog/catalog-query';

// Presentation slots only: never mutate authoritative placement or response order.
export function selectPromotions(promotions) {
  const secondary = promotions.filter((p) => p.placement === 'HERO_SECONDARY');
  const editorial = promotions.filter((p) => p.placement === 'EDITORIAL');
  const primary =
    promotions.find((p) => p.placement === 'HERO_PRIMARY') ||
    secondary.shift() ||
    editorial.shift();
  return primary ? [primary, ...[...secondary, ...editorial].slice(0, 2)] : [];
}

export function promotionDestination(href) {
  // Reject normalization tricks before URL parsing can hide them.
  if (
    typeof href !== 'string' ||
    !href.startsWith('/') ||
    /[\\#\s\u0000-\u001f\u007f]/u.test(href) ||
    href.startsWith('//')
  )
    return null;
  const [path, query = ''] = href.split('?');
  if (href.split('?').length > 2) return null;
  const match = path.match(
    /^\/(category|products)\/([a-z0-9]+(?:-[a-z0-9]+)*)$/,
  );
  if (!['/', '/categories', '/search'].includes(path) && !match) return null;
  const params = new URLSearchParams(query);
  const input = Object.create(null);
  for (const [key, value] of params) {
    if (Object.hasOwn(input, key)) return null;
    input[key] = value;
  }
  if (query) {
    if (path !== '/search' && match?.[1] !== 'category') return null;
    if (
      !parseCatalogQuery(
        input,
        match?.[1] === 'category' ? match[2] : undefined,
      ).success
    )
      return null;
  }
  return {
    href,
    resource: match?.[1] === 'category' ? 'categories' : match?.[1],
    slug: match?.[2],
  };
}
