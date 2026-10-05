import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  catalogSitemap,
  categoryMetadata,
  categoryStructuredData,
  getWebOrigin,
  productMetadata,
  productStructuredData,
  serializeStructuredData,
} from '../features/catalog/catalog-seo';
import { StructuredData } from '../features/catalog/structured-data';

const origin = 'https://shop.example.test';
vi.mock('next/headers', () => ({
  headers: async () => new Headers({ 'x-nonce': 'test-server-nonce' }),
}));
const category = {
  id: 'da7a0000-0000-4000-8000-010000000004',
  name: 'Tabletop',
  slug: 'tabletop',
  description: 'Everyday pieces for the table.',
  image: null,
  parent: {
    id: 'da7a0000-0000-4000-8000-010000000001',
    name: 'Home & Living',
    slug: 'home-living',
  },
  children: [],
};
const product = {
  id: 'da7a0000-0000-4000-8000-020000000001',
  slug: 'cove-stoneware-mug',
  sku: 'MHB-DEMO-001',
  name: 'Cove Stoneware Mug',
  shortDescription: 'A rounded mug for a quiet coffee break.',
  description: 'A softly shaped <stoneware> mug.',
  brand: 'MartHub Studio',
  category: { id: category.id, name: category.name, slug: category.slug },
  image: null,
  images: [],
  price: '9007199254740993',
  compareAtPrice: '9007199254741993',
  currency: 'VND',
  sellingUnit: 'each',
  badges: ['SALE'],
  availability: { status: 'IN_STOCK', canAddToCart: true },
};

describe('M3.8 catalog metadata', () => {
  it('builds absolute canonical category and product metadata without fake images', () => {
    expect(categoryMetadata(category, origin)).toMatchObject({
      title: 'Tabletop',
      alternates: { canonical: `${origin}/category/tabletop` },
      openGraph: { url: `${origin}/category/tabletop` },
    });
    const metadata = productMetadata(product, origin);
    expect(metadata.alternates.canonical).toBe(
      `${origin}/products/cove-stoneware-mug`,
    );
    expect(metadata.openGraph.images).toBeUndefined();
    expect(() => getWebOrigin({ WEB_ORIGIN: `${origin}/store` })).toThrow(
      /without credentials or a path/,
    );
  });

  it('emits exact Product offers and a complete product BreadcrumbList', () => {
    const data = productStructuredData(product, origin);
    const productNode = data['@graph'][0];
    const breadcrumbs = data['@graph'][1];
    expect(productNode).toMatchObject({
      '@type': 'Product',
      name: product.name,
      sku: product.sku,
      offers: {
        priceCurrency: 'VND',
        price: '9007199254740993',
        availability: 'https://schema.org/InStock',
      },
    });
    expect(productNode).not.toHaveProperty('aggregateRating');
    expect(breadcrumbs['@type']).toBe('BreadcrumbList');
    expect(breadcrumbs.itemListElement.map(({ item }) => item)).toEqual([
      `${origin}/`,
      `${origin}/categories`,
      `${origin}/category/tabletop`,
      `${origin}/products/cove-stoneware-mug`,
    ]);
  });

  it('includes parent category ancestry in category breadcrumb data', () => {
    const data = categoryStructuredData(category, origin);
    expect(
      data.itemListElement.map(({ name, position }) => [name, position]),
    ).toEqual([
      ['MartHub', 1],
      ['Categories', 2],
      ['Home & Living', 3],
      ['Tabletop', 4],
    ]);
  });

  it('serializes JSON-LD without executable less-than characters and includes the trusted request nonce', async () => {
    const data = productStructuredData(product, origin);
    const serialized = serializeStructuredData(data);
    expect(serialized).not.toContain('<');
    expect(serialized).toContain('\\u003cstoneware>');
    const { container } = render(
      await StructuredData({ data, id: 'product-structured-data' }),
    );
    expect(
      container.querySelector('script[type="application/ld+json"]'),
    ).toHaveAttribute('id', 'product-structured-data');
    expect(container.querySelector('script').nonce).toBe('test-server-nonce');
  });

  it('creates a deduplicated sitemap for public category and product projections only', () => {
    const entries = catalogSitemap(
      [
        {
          ...category,
          slug: 'home-living',
          children: [
            { id: category.id, name: category.name, slug: category.slug },
          ],
        },
      ],
      [
        product,
        {
          ...product,
          id: 'da7a0000-0000-4000-8000-020000000002',
          slug: 'rill-glass-tumbler',
          image: {
            url: 'https://media.example.test/rill.jpg',
            altText: 'Rill tumbler',
          },
        },
      ],
      origin,
    );
    expect(entries.map(({ url }) => url)).toEqual([
      `${origin}/`,
      `${origin}/categories`,
      `${origin}/category/home-living`,
      `${origin}/category/tabletop`,
      `${origin}/products/cove-stoneware-mug`,
      `${origin}/products/rill-glass-tumbler`,
    ]);
    expect(entries.at(-1).images).toEqual([
      'https://media.example.test/rill.jpg',
    ]);
    expect(entries.some(({ url }) => url.includes('/search'))).toBe(false);
  });
});
