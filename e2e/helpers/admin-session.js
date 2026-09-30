const forbidden = (route) =>
  route.fulfill({
    status: 403,
    contentType: 'application/json',
    body: JSON.stringify({
      error: {
        code: 'FORBIDDEN',
        message: 'This action requires a Customer account.',
        requestId: 'e2e_admin_customer_resource_denied',
      },
    }),
  });

export async function mockAdminSession(page, admin) {
  await page.route('**/api/v1/auth/refresh', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          user: admin,
          accessToken: 'browser-memory-only-token',
          expiresIn: 900,
        },
      }),
    }),
  );
  await page.route('**/api/v1/admin', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'Cache-Control': 'no-store' },
      body: JSON.stringify({ data: { user: admin } }),
    }),
  );
  await page.route('**/api/v1/admin/**', (route) =>
    route.fulfill({
      status: 404,
      contentType: 'application/json',
      headers: { 'Cache-Control': 'no-store' },
      body: JSON.stringify({
        error: {
          code: 'NOT_FOUND',
          message: 'This Admin resource is outside this focused test.',
          requestId: 'e2e_admin_unhandled_resource',
        },
      }),
    }),
  );
  await page.route(/\/api\/v1\/(?:cart|wishlist)(?:[/?]|$)/u, forbidden);
}
