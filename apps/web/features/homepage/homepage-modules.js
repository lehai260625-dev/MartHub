// Presentation only: API eligibility, prices, ordering and labels remain authoritative.
export function selectProductModules(
  data,
  purchases = [],
  recommendation = null,
) {
  const seen = new Set();
  const take = (products) => {
    const selected = [];
    for (const product of products) {
      if (seen.has(product.id)) continue;
      seen.add(product.id);
      selected.push(product);
      if (selected.length === 8) break;
    }
    return selected;
  };
  return [
    { id: 'deals', title: 'Deals', products: take(data.deals) },
    {
      id: 'repurchase',
      title: 'Mua lại',
      href: '/account/my-items?tab=reorder',
      products: take(
        purchases
          .filter(
            (item) =>
              item.availability === 'IN_STOCK' &&
              item.currentProduct?.availability.canAddToCart,
          )
          .map((item) => item.currentProduct),
      ),
    },
    {
      id: 'recommendations',
      title:
        recommendation?.label === 'PERSONALIZED'
          ? 'Gợi ý cho bạn'
          : 'Sản phẩm phổ biến',
      products: take(recommendation?.products || []),
    },
    {
      id: 'new',
      title: 'Sản phẩm mới',
      href: '/search?sort=newest',
      products: take(data.newProducts),
    },
    {
      id: 'popular',
      title: 'Sản phẩm phổ biến',
      href: '/search?sort=popular',
      products: take(data.popularProducts),
    },
  ];
}

export function selectEditorial(promotions, mosaic) {
  const consumed = new Set(mosaic.map((promotion) => promotion.id));
  return promotions
    .filter((p) => p.placement === 'EDITORIAL' && !consumed.has(p.id))
    .slice(0, 2);
}
