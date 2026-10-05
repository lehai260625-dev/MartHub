import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  catalogHref,
  formatVnd,
  parseCatalogQuery,
} from '../features/catalog/catalog-query';
import { CatalogListing } from '../features/catalog/catalog-listing';
import { ProductCard } from '../features/catalog/product-card';
import { ShoppingTestShell } from './shopping-test-shell';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

const product = {
  id: 'da7a0000-0000-4000-8000-020000000001',
  slug: 'cove-stoneware-mug',
  sku: 'MHB-DEMO-001',
  name: 'Cove Stoneware Mug with an intentionally descriptive name',
  shortDescription: 'A rounded mug for a quiet coffee break.',
  image: null,
  price: '9007199254740993',
  compareAtPrice: '9007199254741993',
  currency: 'VND',
  sellingUnit: 'each',
  badges: ['SALE', 'NEW'],
  availability: { status: 'IN_STOCK', canAddToCart: true },
};

describe('catalog URL state', () => {
  it('validates and serializes every supported discovery control without losing exact prices', () => {
    const parsed = parseCatalogQuery({
      q: '  stoneware   mug ',
      minPrice: '149000',
      maxPrice: '9007199254740993',
      availability: 'in-stock',
      new: 'true',
      sort: 'price-desc',
      page: '2',
      perPage: '12',
    });
    expect(parsed.success).toBe(true);
    expect(parsed.query.q).toBe('stoneware mug');
    expect(parsed.state).toEqual({
      q: 'stoneware mug',
      minPrice: '149000',
      maxPrice: '9007199254740993',
      availability: 'in-stock',
      new: 'true',
      sort: 'price-desc',
      page: '2',
      perPage: '12',
    });
    expect(catalogHref('/search', parsed.state, { page: 3 })).toContain(
      'maxPrice=9007199254740993',
    );
    expect(formatVnd('9007199254740993')).toBe('9.007.199.254.740.993 ₫');
  });

  it('rejects repeated, unknown, conflicting, and route-conflicting filters', () => {
    expect(parseCatalogQuery({ q: ['mug', 'bowl'] }).success).toBe(false);
    expect(parseCatalogQuery({ unsafe: 'value' }).success).toBe(false);
    expect(
      parseCatalogQuery({ minPrice: '200', maxPrice: '100' }).success,
    ).toBe(false);
    expect(parseCatalogQuery({ category: 'home' }, 'kitchen').success).toBe(
      false,
    );
  });
});

describe('M3.6 catalog components', () => {
  it('declares English operational copy within a Vietnamese homepage', () => {
    render(
      <main lang="vi">
        <ProductCard product={product} headingLevel={3} />
      </main>,
      { wrapper: ShoppingTestShell },
    );
    const card = screen.getByRole('article');
    expect(card).toHaveAttribute('lang', 'en');
    expect(screen.getByText('In stock').closest('[lang]')).toBe(card);
    for (const button of within(card).getAllByRole('button')) {
      expect(button.closest('[lang]')).toBe(card);
    }
    expect(screen.getByRole('main')).toHaveAttribute('lang', 'vi');
  });

  it('renders the stable public ProductCard anatomy and truthful unavailable actions', () => {
    const { rerender } = render(<ProductCard product={product} />, {
      wrapper: ShoppingTestShell,
    });
    const card = screen.getByRole('article');
    expect(within(card).getAllByRole('link')).toHaveLength(2);
    expect(within(card).getAllByRole('link')[0]).toHaveAttribute(
      'href',
      '/products/cove-stoneware-mug',
    );
    expect(within(card).getByText(/9\.007\.199\.254\.740\.993/)).toBeVisible();
    expect(within(card).getByText('Sale')).toBeVisible();
    expect(within(card).getByText('New')).toBeVisible();
    expect(within(card).getByText('In stock')).toHaveClass('text-stock-in');
    expect(
      within(card).getByRole('button', { name: /add .* to cart/i }),
    ).toBeEnabled();
    expect(within(card).queryByText(/rating/i)).not.toBeInTheDocument();

    rerender(
      <ProductCard
        product={{
          ...product,
          badges: [],
          compareAtPrice: product.price,
          availability: { status: 'OUT_OF_STOCK', canAddToCart: false },
        }}
      />,
    );
    expect(
      screen.getByRole('button', { name: /out of stock/i }),
    ).toBeDisabled();
    expect(screen.getByText('Out of stock', { selector: 'p' })).toHaveClass(
      'text-stock-out',
    );
    expect(
      screen.queryByText('9.007.199.254.741.993 ₫'),
    ).not.toBeInTheDocument();
  });

  it('restores filters, sorting, and pagination from URL-backed state', () => {
    const parsed = parseCatalogQuery({
      q: 'mug',
      minPrice: '100000',
      availability: 'in-stock',
      sort: 'price-asc',
      page: '2',
      perPage: '12',
    });
    render(
      <CatalogListing
        action="/search"
        description="Matches"
        result={{
          data: [product],
          meta: { page: 2, perPage: 12, totalItems: 25, totalPages: 3 },
        }}
        state={{ query: parsed.query, values: parsed.state }}
        title="Search results"
      />,
      { wrapper: ShoppingTestShell },
    );
    expect(screen.getByLabelText('Minimum')).toHaveValue(100000);
    expect(screen.getByLabelText('In stock')).toBeChecked();
    expect(screen.getByLabelText('Sort by')).toHaveValue('price-asc');
    expect(screen.getByLabelText('Products per page')).toHaveValue('12');
    expect(
      screen.getByRole('navigation', { name: 'Pagination' }),
    ).toHaveTextContent('Page 2 of 3');
    const next = screen.getByRole('link', { name: 'Next' });
    expect(next.getAttribute('href')).toContain('q=mug');
    expect(next.getAttribute('href')).toContain('availability=in-stock');
    expect(next.getAttribute('href')).toContain('sort=price-asc');
    expect(next.getAttribute('href')).toContain('page=3');
  });
});
