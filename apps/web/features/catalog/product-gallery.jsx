'use client';

import { useRef, useState } from 'react';

function MissingImage({ productName }) {
  return (
    <span
      aria-label={`No image available for ${productName}`}
      className="product-gallery-placeholder"
      role="img"
    >
      <span aria-hidden="true">MH</span>
      <span>Image unavailable</span>
    </span>
  );
}

export function ProductGallery({ images, productName }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [failedImages, setFailedImages] = useState(() => new Set());
  const thumbnailRefs = useRef([]);
  const activeImage = images[activeIndex];

  function markFailed(index) {
    setFailedImages((current) => {
      const next = new Set(current);
      next.add(index);
      return next;
    });
  }

  function selectImage(index, focus = false) {
    setActiveIndex(index);
    if (focus)
      requestAnimationFrame(() => thumbnailRefs.current[index]?.focus());
  }

  function handleThumbnailKeyDown(event, index) {
    let nextIndex;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      nextIndex = (index + 1) % images.length;
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      nextIndex = (index - 1 + images.length) % images.length;
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = images.length - 1;
    } else {
      return;
    }
    event.preventDefault();
    selectImage(nextIndex, true);
  }

  return (
    <section aria-label={`${productName} images`} className="product-gallery">
      <div className="product-gallery-main" aria-live="polite">
        {activeImage && !failedImages.has(activeIndex) ? (
          // Catalog image hosts and dimensions are controlled by the server media adapter.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            alt={activeImage.altText}
            height={activeImage.height}
            key={activeImage.id}
            onError={() => markFailed(activeIndex)}
            src={activeImage.url}
            width={activeImage.width}
          />
        ) : (
          <MissingImage productName={productName} />
        )}
      </div>
      {images.length > 1 ? (
        <div
          aria-label="Choose a product image"
          className="product-thumbnails"
          role="toolbar"
        >
          {images.map((image, index) => (
            <button
              aria-label={`Show image ${index + 1}: ${image.altText}`}
              aria-pressed={index === activeIndex}
              className="product-thumbnail"
              key={image.id}
              onClick={() => selectImage(index)}
              onKeyDown={(event) => handleThumbnailKeyDown(event, index)}
              ref={(element) => {
                thumbnailRefs.current[index] = element;
              }}
              tabIndex={index === activeIndex ? 0 : -1}
              type="button"
            >
              {failedImages.has(index) ? (
                <span aria-hidden="true">MH</span>
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  alt=""
                  height={image.height}
                  onError={() => markFailed(index)}
                  src={image.url}
                  width={image.width}
                />
              )}
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}
