'use client';

import { useEffect, useRef, useState } from 'react';

export function railBounds(element) {
  const end = Math.max(0, element.scrollWidth - element.clientWidth);
  return {
    overflow: end > 1,
    start: element.scrollLeft <= 1,
    end: element.scrollLeft >= end - 1,
  };
}

export function ProductRail({ title, id, children }) {
  const ref = useRef(null);
  const [bounds, setBounds] = useState({
    overflow: false,
    start: true,
    end: true,
  });
  useEffect(() => {
    const element = ref.current;
    const update = () => setBounds(railBounds(element));
    update();
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    observer?.observe(element);
    for (const child of element.children) observer?.observe(child);
    element.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      observer?.disconnect();
      element.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [children]);
  const move = (direction) => {
    const element = ref.current;
    const reduced = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches;
    element.scrollBy({
      left: direction * element.clientWidth * 0.85,
      behavior: reduced ? 'auto' : 'smooth',
    });
  };
  return (
    <div className="home-rail-wrap">
      {bounds.overflow ? (
        <div className="home-rail-controls">
          <button
            type="button"
            aria-controls={id}
            aria-label={`Cuộn ${title} sang trái`}
            title={`Cuộn ${title} sang trái`}
            disabled={bounds.start}
            onClick={() => move(-1)}
          >
            <span aria-hidden="true">←</span>
          </button>
          <button
            type="button"
            aria-controls={id}
            aria-label={`Cuộn ${title} sang phải`}
            title={`Cuộn ${title} sang phải`}
            disabled={bounds.end}
            onClick={() => move(1)}
          >
            <span aria-hidden="true">→</span>
          </button>
        </div>
      ) : null}
      <ul ref={ref} id={id} className="home-product-rail">
        {children}
      </ul>
    </div>
  );
}
