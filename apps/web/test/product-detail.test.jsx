import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ProductLoading from '../app/products/[slug]/loading';
import { ProductDetail } from '../features/catalog/product-detail';
import { ProductGallery } from '../features/catalog/product-gallery';
import { ShoppingTestShell } from './shopping-test-shell';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

const images = [
  {
    id: 'da7a0000-0000-4000-8000-030000000001',
    url: 'https://media.example.test/mug-front.jpg',
    altText: 'Cove mug viewed from the front',
    width: 800,
    height: 800,
  },
  {
    id: 'da7a0000-0000-4000-8000-030000000002',
    url: 'https://media.example.test/mug-handle.jpg',
    altText: 'Cove mug handle detail',
    width: 800,
    height: 800,
  },
];

const product = {
  id: 'da7a0000-0000-4000-8000-020000000001',
  slug: 'cove-stoneware-mug',
  sku: 'MHB-DEMO-001',
  name: 'Cove Stoneware Mug',
  shortDescription: 'A rounded mug for a quiet coffee break.',
  description: 'A softly shaped stoneware mug with a comfortable handle.',
  brand: 'MartHub Studio',
  category: {
    id: 'da7a0000-0000-4000-8000-010000000004',
    name: 'Tabletop',
    slug: 'tabletop',
  },
  image: { url: images[0].url, altText: images[0].altText },
  images,
  price: '9007199254740993',
  compareAtPrice: '9007199254741993',
  currency: 'VND',
  sellingUnit: 'each',
  badges: ['SALE', 'NEW'],
  availability: { status: 'IN_STOCK', canAddToCart: true },
};

describe('M3.7 product gallery', () => {
  it('selects images with pointer and roving arrow-key controls', async () => {
    render(<ProductGallery images={images} productName={product.name} />);
    expect(screen.getByRole('img', { name: images[0].altText })).toBeVisible();
    const toolbar = screen.getByRole('toolbar', {
      name: 'Choose a product image',
    });
    const first = within(toolbar).getByRole('button', {
      name: /show image 1/i,
    });
    const second = within(toolbar).getByRole('button', {
      name: /show image 2/i,
    });
    expect(first).toHaveAttribute('aria-pressed', 'true');
    expect(second).toHaveAttribute('tabindex', '-1');

    fireEvent.click(second);
    expect(screen.getByRole('img', { name: images[1].altText })).toBeVisible();
    expect(second).toHaveAttribute('aria-pressed', 'true');
    fireEvent.keyDown(second, { key: 'ArrowLeft' });
    expect(screen.getByRole('img', { name: images[0].altText })).toBeVisible();
    await waitFor(() => expect(first).toHaveFocus());
  });

  it('shows an accessible nonblank fallback for missing and failed images', () => {
    const first = render(
      <ProductGallery images={[]} productName="Product without media" />,
    );
    expect(
      screen.getByRole('img', {
        name: 'No image available for Product without media',
      }),
    ).toHaveTextContent('Image unavailable');
    first.unmount();

    render(<ProductGallery images={images} productName={product.name} />);
    fireEvent.error(screen.getByRole('img', { name: images[0].altText }));
    expect(
      screen.getByRole('img', {
        name: `No image available for ${product.name}`,
      }),
    ).toHaveTextContent('Image unavailable');
  });
});

describe('M3.7 product detail', () => {
  it('renders exact public detail fields, price, badges, and in-stock state', () => {
    render(<ProductDetail product={product} />, {
      wrapper: ShoppingTestShell,
    });
    expect(screen.getByRole('heading', { name: product.name })).toBeVisible();
    expect(screen.getByText('MartHub Studio')).toBeVisible();
    expect(screen.getByText(/9\.007\.199\.254\.740\.993/)).toBeVisible();
    expect(screen.getByText('Sale')).toBeVisible();
    expect(screen.getByText('New')).toBeVisible();
    expect(screen.getByText(product.description)).toBeVisible();
    expect(screen.getByText(product.sku)).toBeVisible();
    expect(screen.getByLabelText('Quantity')).toBeEnabled();
    expect(
      screen.getByRole('button', { name: /add .* to cart/i }),
    ).toBeEnabled();
    expect(screen.queryByText(/rating/i)).not.toBeInTheDocument();
  });

  it('makes stock unavailability explicit and provides a layout-matched loading state', () => {
    const unavailable = {
      ...product,
      images: [],
      image: null,
      compareAtPrice: null,
      badges: [],
      availability: { status: 'OUT_OF_STOCK', canAddToCart: false },
    };
    const detail = render(<ProductDetail product={unavailable} />, {
      wrapper: ShoppingTestShell,
    });
    expect(screen.getByText('Out of stock', { selector: 'p' })).toBeVisible();
    expect(screen.getByLabelText('Quantity')).toBeDisabled();
    expect(
      screen.getByRole('button', { name: /out of stock/i }),
    ).toBeDisabled();
    detail.unmount();

    render(<ProductLoading />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading product');
    expect(screen.getByLabelText('Loading product')).toHaveAttribute(
      'aria-busy',
      'true',
    );
  });
});
