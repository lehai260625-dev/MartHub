export const statisticsAdmin = {
  id: 'b2ecb79a-b74a-4748-93dc-f2fc02b93b3d',
  email: 'admin@example.test',
  firstName: 'Admin',
  lastName: 'User',
  phone: null,
  role: 'ADMIN',
  status: 'ACTIVE',
};

export function statisticsRange(from = '2026-09-05', to = '2026-10-04') {
  const end = new Date(Date.parse(to + 'T00:00:00Z') + 86400000 - 25200000);
  return {
    from,
    to,
    timezone: 'Asia/Ho_Chi_Minh',
    startInclusive: new Date(
      Date.parse(from + 'T00:00:00Z') - 25200000,
    ).toISOString(),
    endExclusive: end.toISOString(),
  };
}

export function statisticsOverview(range = statisticsRange(), zero = false) {
  return {
    data: {
      range,
      revenue: zero ? '0' : '18446744073709551614',
      deliveredOrderCount: zero ? '0' : '9007199254740993',
      unitsSold: zero ? '0' : '9007199254740994',
      createdOrderCount: zero ? '0' : '9007199254740995',
      statusCounts: {
        PENDING: '0',
        CONFIRMED: '0',
        PACKING: '0',
        SHIPPING: '0',
        DELIVERED: zero ? '0' : '9007199254740993',
        CANCELLED: zero ? '0' : '2',
      },
    },
  };
}

export function statisticsTop(range = statisticsRange(), empty = false) {
  return {
    data: {
      range,
      limit: 10,
      totalProducts: empty ? '0' : '2',
      items: empty
        ? []
        : [
            {
              productId: '0e7b73b7-9db0-4ae0-80b5-08e4049162cf',
              sku: 'HISTORICAL-SKU',
              productName:
                'Historical snapshot product with a long immutable name',
              imageUrl: null,
              sellingUnit: 'box',
              soldQuantity: '9007199254740994',
              revenue: '18446744073709551614',
            },
            {
              productId: '715db285-4231-4138-a05d-e5b0ca1a1111',
              sku: 'SECOND-SKU',
              productName: 'Second historical product',
              imageUrl: null,
              sellingUnit: 'unit',
              soldQuantity: '2',
              revenue: '10000',
            },
          ],
    },
  };
}

export function statisticsLow(empty = false) {
  return {
    data: {
      threshold: 5,
      limit: 10,
      totalProducts: empty ? '0' : '2',
      items: empty
        ? []
        : [
            {
              productId: '0e7b73b7-9db0-4ae0-80b5-08e4049162cf',
              sku: 'CURRENT-SKU',
              name: 'Current operational product',
              quantity: 0,
              currentPrice: '9007199254740993',
              availability: { status: 'OUT_OF_STOCK', canAddToCart: false },
            },
            {
              productId: '715db285-4231-4138-a05d-e5b0ca1a1111',
              sku: 'STOCK-SKU',
              name: 'Product at threshold',
              quantity: 5,
              currentPrice: '25000',
              availability: { status: 'IN_STOCK', canAddToCart: true },
            },
          ],
    },
  };
}

export function statisticsFixture(
  path,
  { zero = false, topEmpty = false, lowEmpty = false } = {},
) {
  const url = new URL(path, 'http://marthub.test');
  const from = url.searchParams.get('from');
  const range = from
    ? statisticsRange(from, url.searchParams.get('to'))
    : statisticsRange();
  if (url.pathname.endsWith('/overview'))
    return statisticsOverview(range, zero);
  if (url.pathname.endsWith('/top-products'))
    return statisticsTop(range, topEmpty);
  if (url.pathname.endsWith('/low-stock')) return statisticsLow(lowEmpty);
  throw new Error('Unexpected statistics endpoint: ' + path);
}
