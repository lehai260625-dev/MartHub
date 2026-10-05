'use client';

import { useState } from 'react';

export function ProductMedia({ image }) {
  const [failed, setFailed] = useState(false);
  return image && !failed ? (
    // Existing server-controlled catalog media; square box is reserved by ProductCard.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      alt={image.altText}
      src={image.url}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  ) : (
    <span aria-hidden="true" className="product-placeholder">
      MH
    </span>
  );
}
