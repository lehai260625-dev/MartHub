const DEFAULT_WEB_ORIGIN = 'http://localhost:3000';

export function getWebOrigin(env = process.env) {
  const value = env.WEB_ORIGIN || DEFAULT_WEB_ORIGIN;
  const url = new URL(value);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      'WEB_ORIGIN must be an HTTP(S) origin without credentials or a path.',
    );
  }
  return url.origin;
}

export function absoluteCatalogUrl(path, origin = getWebOrigin()) {
  return new URL(path, `${origin}/`).href;
}

function descriptionFor(item, fallback) {
  return item.description || item.shortDescription || fallback;
}

export function categoryMetadata(category, origin = getWebOrigin()) {
  const canonical = absoluteCatalogUrl(`/category/${category.slug}`, origin);
  const description = descriptionFor(
    category,
    `Browse ${category.name} products at MartHub.`,
  );
  return {
    title: category.name,
    description,
    alternates: { canonical },
    openGraph: {
      title: category.name,
      description,
      url: canonical,
      type: 'website',
    },
  };
}

export function productMetadata(product, origin = getWebOrigin()) {
  const canonical = absoluteCatalogUrl(`/products/${product.slug}`, origin);
  const description = descriptionFor(
    product,
    `View ${product.name} at MartHub.`,
  );
  const images = product.images.map((image) => ({
    url: image.url,
    width: image.width,
    height: image.height,
    alt: image.altText,
  }));
  return {
    title: product.name,
    description,
    alternates: { canonical },
    openGraph: {
      title: product.name,
      description,
      url: canonical,
      type: 'website',
      ...(images.length ? { images } : {}),
    },
  };
}

export function productStructuredData(product, origin = getWebOrigin()) {
  const productUrl = absoluteCatalogUrl(`/products/${product.slug}`, origin);
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Product',
        '@id': `${productUrl}#product`,
        url: productUrl,
        name: product.name,
        description: descriptionFor(product, product.name),
        sku: product.sku,
        category: product.category.name,
        ...(product.brand
          ? { brand: { '@type': 'Brand', name: product.brand } }
          : {}),
        ...(product.images.length
          ? { image: product.images.map((image) => image.url) }
          : {}),
        offers: {
          '@type': 'Offer',
          url: productUrl,
          priceCurrency: product.currency,
          price: product.price,
          itemCondition: 'https://schema.org/NewCondition',
          availability: product.availability.canAddToCart
            ? 'https://schema.org/InStock'
            : 'https://schema.org/OutOfStock',
        },
      },
      breadcrumbStructuredData(
        [
          { name: 'MartHub', path: '/' },
          { name: 'Categories', path: '/categories' },
          {
            name: product.category.name,
            path: `/category/${product.category.slug}`,
          },
          { name: product.name, path: `/products/${product.slug}` },
        ],
        origin,
      ),
    ],
  };
}

export function breadcrumbStructuredData(items, origin = getWebOrigin()) {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: absoluteCatalogUrl(item.path, origin),
    })),
  };
}

export function categoryStructuredData(category, origin = getWebOrigin()) {
  const items = [
    { name: 'MartHub', path: '/' },
    { name: 'Categories', path: '/categories' },
    ...(category.parent
      ? [
          {
            name: category.parent.name,
            path: `/category/${category.parent.slug}`,
          },
        ]
      : []),
    { name: category.name, path: `/category/${category.slug}` },
  ];
  return {
    '@context': 'https://schema.org',
    ...breadcrumbStructuredData(items, origin),
  };
}

export function serializeStructuredData(value) {
  return JSON.stringify(value).replaceAll('<', '\\u003c');
}

export function catalogSitemap(categories, products, origin = getWebOrigin()) {
  const paths = new Map([
    ['/', {}],
    ['/categories', {}],
  ]);
  for (const category of categories) {
    paths.set(`/category/${category.slug}`, {});
    for (const child of category.children)
      paths.set(`/category/${child.slug}`, {});
  }
  for (const product of products) {
    paths.set(`/products/${product.slug}`, {
      ...(product.image ? { images: [product.image.url] } : {}),
    });
  }
  return [...paths].map(([path, extra]) => ({
    url: absoluteCatalogUrl(path, origin),
    ...extra,
  }));
}
