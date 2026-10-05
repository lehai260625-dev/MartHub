import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { ProductRail, railBounds } from '../features/homepage/product-rail';
import { ProductMedia } from '../features/catalog/product-media';

afterEach(() => vi.unstubAllGlobals());
describe('native bounded rails', () => {
  it.each([
    [600, 600, 0, false, true, true],
    [1500, 600, 0, true, true, false],
    [1500, 600, 400, true, false, false],
    [1500, 600, 899.5, true, false, true],
  ])(
    'calculates overflow/boundaries (%i/%i/%i)',
    (scrollWidth, clientWidth, scrollLeft, overflow, start, end) => {
      expect(railBounds({ scrollWidth, clientWidth, scrollLeft })).toEqual({
        overflow,
        start,
        end,
      });
    },
  );
  it('updates on resize/scroll, uses viewport advance, reduced motion and disconnects observers', async () => {
    const disconnect = vi.fn();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect = disconnect;
      },
    );
    let reduced = false;
    vi.stubGlobal('matchMedia', () => ({ matches: reduced }));
    const view = render(
      <ProductRail title="Deals" id="deals">
        <li>Card</li>
      </ProductRail>,
    );
    const rail = screen.getByRole('list');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    Object.defineProperties(rail, {
      clientWidth: { value: 600, configurable: true },
      scrollWidth: { value: 1500, configurable: true },
      scrollLeft: { value: 0, writable: true },
    });
    rail.scrollBy = vi.fn();
    fireEvent(window, new Event('resize'));
    const next = await screen.findByRole('button', {
      name: 'Cuộn Deals sang phải',
    });
    expect(
      screen.getByRole('button', { name: 'Cuộn Deals sang trái' }),
    ).toBeDisabled();
    fireEvent.click(next);
    expect(rail.scrollBy).toHaveBeenLastCalledWith({
      left: 510,
      behavior: 'smooth',
    });
    reduced = true;
    rail.scrollLeft = 900;
    fireEvent.scroll(rail);
    await waitFor(() => expect(next).toBeDisabled());
    fireEvent.click(
      screen.getByRole('button', { name: 'Cuộn Deals sang trái' }),
    );
    expect(rail.scrollBy).toHaveBeenLastCalledWith({
      left: -510,
      behavior: 'auto',
    });
    Object.defineProperty(rail, 'clientWidth', {
      value: 1500,
      configurable: true,
    });
    fireEvent(window, new Event('resize'));
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    view.unmount();
    expect(disconnect).toHaveBeenCalled();
  });
  it('missing/broken media preserves MH; changing authoritative image URL resets failure', () => {
    const view = render(
      <ProductMedia
        image={{ url: '/broken.jpg', altText: 'Product' }}
        key="broken"
      />,
    );
    fireEvent.error(screen.getByRole('img'));
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByText('MH')).toHaveClass('product-placeholder');
    view.rerender(
      <ProductMedia
        image={{ url: '/good.jpg', altText: 'New product' }}
        key="good"
      />,
    );
    expect(screen.getByRole('img')).toHaveAttribute('src', '/good.jpg');
    view.rerender(<ProductMedia image={null} key="missing" />);
    expect(screen.getByText('MH')).toHaveAttribute('aria-hidden', 'true');
  });
});
