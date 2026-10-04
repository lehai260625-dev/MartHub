# MartHub REST API Design

This document defines the approved HTTP contract and endpoint inventory for the MartHub MVP. It is the source of truth for API conventions, authentication classes, validation, idempotency, and representative request and response shapes. The implemented endpoint contract is [OpenAPI 3.1](../packages/contracts/openapi.json); future endpoints below are added there with their implementation. Data invariants and transactions are defined in `docs/DATABASE.md`; roadmap status belongs in `docs/PLAN.md`.

## Base contract

- Base path: `/api/v1`
- Media type: `application/json; charset=utf-8`
- JSON property names: `camelCase`
- Timestamps: ISO 8601 UTC strings
- UUIDs: lowercase canonical UUID strings
- Money: base-10 integer strings in VND, never JSON floating-point numbers
- Request correlation: accept a valid `X-Request-Id` or generate one; always return it in `X-Request-Id`
- Mutating requests require JSON bodies unless the endpoint is bodyless by contract.
- JSON request bodies are limited to 100 KB. Unsupported body media types/encodings return 415; oversized bodies return 413.
- Request IDs contain 1-64 ASCII letters, digits, underscores, or hyphens. Invalid IDs are replaced with a UUID.
- CORS permits only configured `WEB_ORIGIN`, credentials, the API methods, and Authorization/Content-Type/X-Request-Id/Idempotency-Key headers. Unknown origins and preflights are rejected.
- Unknown body fields are rejected on security-sensitive and administrative endpoints.

Successful single-resource responses use:

```json
{
  "data": {
    "id": "b2ecb79a-b74a-4748-93dc-f2fc02b93b3d"
  }
}
```

List responses include pagination metadata:

```json
{
  "data": [],
  "meta": {
    "page": 1,
    "perPage": 24,
    "totalItems": 0,
    "totalPages": 0
  }
}
```

Successful deletes that have no response representation return `204 No Content`. Creation normally returns `201 Created`; asynchronous processing is outside the MVP.

## Error contract

All handled errors use stable machine-readable codes:

```json
{
  "error": {
    "code": "INSUFFICIENT_STOCK",
    "message": "One or more products no longer have the requested quantity.",
    "details": [
      {
        "field": "items.0.quantity",
        "productId": "b2ecb79a-b74a-4748-93dc-f2fc02b93b3d",
        "available": 2
      }
    ],
    "requestId": "req_01J..."
  }
}
```

- `400 Bad Request`: malformed JSON, query syntax, or idempotency-key reuse with a different payload.
- `401 Unauthorized`: missing, invalid, expired, or revoked authentication.
- `403 Forbidden`: authenticated but lacks role or resource permission.
- `404 Not Found`: resource absent or deliberately concealed by ownership checks.
- `409 Conflict`: uniqueness conflict, invalid state transition, stale mutation, or insufficient stock.
- `422 Unprocessable Entity`: well-formed request with field validation failures.
- `429 Too Many Requests`: rate limit exceeded; include `Retry-After`.
- `500 Internal Server Error`: unexpected failure with no sensitive implementation detail.
- `503 Service Unavailable`: required dependency is temporarily unavailable.

Logs use the stable error code and request ID. Passwords, hashes, authorization headers, cookies, tokens, and sensitive address data are redacted.

## Authentication classes

### Public

No access token is required. Public endpoints expose only active catalog and merchandising data. Authentication endpoints have tighter IP and account-aware rate limits.

### Customer

Requires `Authorization: Bearer <access-token>` with an active `CUSTOMER` or `ADMIN` account. Resource ownership is resolved from JWT `sub`, never from a client-supplied user ID. Access tokens are short-lived and held in frontend memory.

### Admin

Requires an active access token with `role = ADMIN`. Every mutation is authorized at the route/service boundary and creates an audit log. A hidden UI control is not authorization.

### Refresh cookie

The opaque refresh token is sent only in an `HttpOnly`, `Secure`, `SameSite=Lax` cookie scoped to the refresh/logout auth path as deployment permits. Refresh rotates the token. Reuse of a rotated token revokes its family. Cookie-authenticated endpoints validate the request origin against the configured same-origin deployment.

JWT claims are limited to identifiers and authorization metadata such as `sub`, `role`, `sid`, `jti`, `iss`, `aud`, `iat`, and `exp`. They contain no password, address, phone, or other unnecessary personal data.

Credential policy: registration/login use strict shared schemas. Email is trimmed and lowercased; names are bounded plain text. Passwords are 15-128 characters, preserve whitespace, and use Argon2id with 19 MiB memory, two iterations, and one lane. Incorrect passwords, unknown accounts, and inactive accounts receive the same `401 INVALID_CREDENTIALS` response. Registration cannot set role or status. Password and refresh-token hashes are omitted from default Prisma projections and all public DTOs.

Registration and login each allow 100 IP attempts and 10 normalized-account attempts per 15-minute window, shared through PostgreSQL. Throttling precedes password hashing/verification and returns `429 RATE_LIMITED` with `Retry-After`. Counters are not cleared by successful login.

Access tokens use HS256 with a required 32-byte random environment secret and a 900-second lifetime. Refresh tokens contain 32 random bytes, use the host-only `mh_refresh` cookie at `/api/v1/auth`, and expire absolutely 30 days after login (rotation does not extend the family lifetime). Rotation and family revocation serialize on the owning user row. All auth requests, including register/login, require an exact configured `Origin`. Only loopback development/test permits non-Secure HTTP cookies; production configuration requires HTTPS. Refresh accepts no fields and permits 300 attempts per API peer IP per 15 minutes. Express does not trust forwarded IP headers: deployments must apply per-client limits at the trusted edge; API peer limits remain an additional aggregate bound.

## Pagination, filtering, sorting, and search

Collection endpoints use `page` and `perPage`. Defaults are endpoint-specific, generally `page=1` and `perPage=24`; the public maximum is 60 and the admin maximum is 100. Invalid or excessive values return validation errors rather than being silently accepted.

Product query parameters include:

- `q`: normalized search text with a documented maximum length
- `category`: category slug
- `minPrice`, `maxPrice`: VND integer strings
- `availability`: `in-stock`
- `featured`, `new`, `popular`: boolean flags where relevant
- `sort`: whitelist of `relevance`, `newest`, `price-asc`, `price-desc`, `popular`
- `page`, `perPage`

Order lists may filter by an allowed `status` and date range. Admin lists may additionally search stable fields such as email, SKU, order number, or product name. Sort values are explicit whitelists mapped to safe database expressions; raw field names or SQL fragments are never accepted.

The response echoes applied filters only when useful. Pagination links are constructed by the frontend from stable query parameters; search/filter state remains URL-addressable.

## Public endpoints

### Authentication

- `POST /auth/register` - create a customer account and establish a refresh session.
- `POST /auth/login` - validate credentials and establish a refresh session.
- `POST /auth/refresh` - rotate the refresh cookie and issue a new access token.
- `POST /auth/logout` - revoke the current refresh session and clear its cookie.
- `POST /auth/logout-all` - authenticated; revoke all refresh families for the current user.

Logout and logout-all accept no body or `{}` and return 204 with the refresh cookie cleared. Logout is idempotent even without a valid cookie and revokes the cookie's entire family so a concurrent rotation cannot survive logout. Logout-all requires bearer authentication and revokes every family for that user. Both require the exact configured Origin. Protected operations verify the JWT, its session ID and user binding, unexpired/unrevoked session, and active non-archived user. Role checks use the current database role, not stale JWT privileges. Ownership predicates always include authenticated user ID; missing and foreign resources return the same 404.

Public registration ignores or rejects role fields. Login and registration return a minimal user representation plus the access token; the refresh token is never returned in JSON.

```json
{
  "data": {
    "accessToken": "<jwt>",
    "expiresIn": 900,
    "user": {
      "id": "b2ecb79a-b74a-4748-93dc-f2fc02b93b3d",
      "email": "customer@example.com",
      "firstName": "Minh",
      "lastName": "Nguyen",
      "role": "CUSTOMER"
    }
  }
}
```

### Homepage and catalog

- `GET /homepage` - return active promotions, featured categories, deals, new products, and popular products in a stable module shape.
- `GET /categories` - list the active category tree or top-level categories.
- `GET /categories/:slug` - return one active category and navigation metadata.
- `GET /products` - search, filter, sort, and paginate active products.
- `GET /products/:slug` - return product detail, images, current price, and availability.
- `GET /health/live` - process liveness with no dependency detail.
- `GET /health/ready` - deployment readiness; access may be restricted operationally.

The public product list searches name, brand, and SKU with all space-separated terms required. `q` is normalized to 2-80 characters. `category` includes direct children. Current-price bounds are inclusive exact VND integer strings; `minPrice` must not exceed `maxPrice`. `availability=in-stock` and explicit `featured`, `new`, and `popular` booleans filter the list. Sort accepts `relevance` (only with `q`), `newest`, `price-asc`, `price-desc`, or `popular`; defaults are relevance with search and newest otherwise. Every order uses the product ID as a stable final tie breaker. `page` defaults to 1 and is capped at 1000; `perPage` defaults to 24 and is capped at 60. Responses include `meta` with `page`, `perPage`, `totalItems`, and `totalPages`; unknown, repeated, malformed, or conflicting query values return 422. Category listing returns active top-level categories with active direct children. Category and product detail return 404 for inactive, archived, or unavailable records; current prices are base-10 VND strings and availability reveals only in-stock/out-of-stock state.

`GET /homepage` is an aggregation endpoint, not a persisted page document. It returns typed modules so the frontend can compose the approved hierarchy without extra round trips. Signed-in purchase history is not leaked into this public response; the frontend requests customer My Items separately. It accepts no query parameters and returns at most 8 scheduled promotions, 8 active top-level categories (each with at most 8 active direct children), and 12 cards in each of `deals`, `newProducts`, and `popularProducts`. Deals require a current compare-at price; new and popular collections use their curated flags. Every product still requires active category ancestry and a current price, and its availability comes from current inventory. The response uses `Cache-Control: public, max-age=60, s-maxage=300, stale-while-revalidate=600`; catalog administration must account for this bounded freshness window.

A product card projection contains only display and quick-add data:

```json
{
  "id": "da7a0000-0000-4000-8000-020000000001",
  "slug": "cove-stoneware-mug",
  "sku": "MHB-DEMO-001",
  "name": "Cove Stoneware Mug",
  "shortDescription": "A rounded mug for a quiet coffee break.",
  "image": null,
  "price": "149000",
  "compareAtPrice": "179000",
  "currency": "VND",
  "sellingUnit": "each",
  "badges": ["SALE"],
  "availability": {
    "status": "IN_STOCK",
    "canAddToCart": true
  }
}
```

## Customer endpoints

### Account and addresses

- `GET /users/me` - current Customer profile; the response contains only the public user projection and is never shared-cacheable.
- `PATCH /users/me` - update `firstName`, `lastName`, and nullable `phone` only. Names are trimmed bounded plain text. Phone is trimmed, 7-24 characters, and permits digits, spaces, parentheses, an optional leading `+`, and hyphens. Email, role, status, identity, password, and session fields are rejected.
- `GET /users/me/addresses` - list non-archived addresses.
- `POST /users/me/addresses` - create an address.
- `PATCH /users/me/addresses/:addressId` - update an owned address.
- `DELETE /users/me/addresses/:addressId` - archive an owned address.
- `PUT /users/me/addresses/:addressId/default` - atomically make an owned address the default.

Address writes accept only `label`, `recipientName`, `phone`, `line1`, nullable `line2`, `ward`, `district`, `province`, nullable `postalCode`, and `isDefault` on creation. The first active address becomes default even when `isDefault` is omitted or false. Later default changes use the dedicated `PUT` command; `PATCH` rejects identity and default fields. Create/default/archive operations serialize on the owning user, and the database partial unique index remains the final guarantee that at most one non-archived address is default. Delete archives the owned address and clears its default flag; foreign and archived IDs return the same `404 NOT_FOUND` response.

### Cart

- `GET /cart` - return active cart with current price and availability reconciliation.
- `POST /cart/items` - add a product or increment its quantity.
- `PATCH /cart/items/:itemId` - set quantity.
- `DELETE /cart/items/:itemId` - remove an item.
- `DELETE /cart/items` - clear the active cart.

Cart mutations return the updated cart representation. An add request is explicit:

```json
{
  "productId": "b2ecb79a-b74a-4748-93dc-f2fc02b93b3d",
  "quantity": 1
}
```

The API validates product status and quantity, but checkout remains the final price and stock authority. `MAX_CART_ITEM_QUANTITY` is 99: request quantities and the resulting accumulated per-product quantity must remain within 1-99; overflow is rejected and never clamped. This limit does not reserve inventory. Clients may use optimistic UI and must roll back on error.

GET does not create a database cart when none exists; it returns a nullable cart ID, an empty item list, and a zero item count. Cart lines are owner-scoped and stably ordered, include their server-owned item/product IDs and quantity, and reconcile the current public product-card projection on every response. An existing line whose product is no longer public returns UNAVAILABLE with a null product projection; a currently out-of-stock public product remains visible as OUT_OF_STOCK. POST increments the existing per-product row or creates it, and returns the complete reconciled cart.

PATCH accepts only { "quantity": 1..99 } and replaces, rather than increments, the owned active-cart item quantity. Zero does not mean removal; clients use DELETE. PATCH returns 409 PRODUCT_UNAVAILABLE without mutation when the current product is out of stock or no longer public, with the reconciled availability in error details. DELETE item remains available for those unavailable lines; foreign, missing, or non-active-cart item IDs return the same 404 NOT_FOUND. DELETE /cart/items clears only the current Customer's active-cart items, preserves the active cart identity, and is idempotent when the cart is absent or already empty. Update, removal, clear, and add serialize per owning user and return the complete reconciled cart.

### Wishlist and My Items

- `GET /wishlist` - list wishlist items with current product state.
- `PUT /wishlist/items/:productId` - idempotently add a product.
- `DELETE /wishlist/items/:productId` - idempotently remove a product.
- `GET /users/me/items` - aggregate products from delivered orders, most recent first by default.
- `GET /users/me/recommendations` - return history-based recommendations or an explicitly labeled popular fallback.

M7.6 owner-approved recommendation policy (2026-10-04): use only authenticated Customer-owned DELIVERED history, across all time; at least one delivered product is sufficient to try personalization. Personalized candidates come from categories represented in that history, with categoryAffinity equal to purchased quantity summed by category. Rank categoryAffinity DESC, existing isPopular DESC, createdAt DESC, productId ASC. Candidates must satisfy existing current public product/category-ancestry visibility, current price and stock > 0, and exclude products already purchased in owned DELIVERED orders. Return at most 8 cards. Return PERSONALIZED for 1-8 eligible personalized candidates, without popular padding. With no delivered history or zero personalized candidates, use the existing M3.5 curated popular source and label POPULAR, applying the same current visibility/price/positive-stock eligibility and excluding delivered purchased products when history exists. Empty fallback still returns POPULAR with an empty list. No ML, collaborative filtering or other Customer behavior is used. Attribution uses the owner-approved current-taxonomy rule below; OrderItem has no category-at-purchase snapshot.

My Items entries include `lastPurchasedAt`, `purchaseCount`, a recent source `orderId`, current product card data, and availability. Empty purchase history returns an empty `data` list, not an error.

M7.6 category attribution uses current Product.categoryId: all delivered quantity follows that current category after reassignment. Affinity reflects current catalog taxonomy, not historical category-at-purchase taxonomy. Do not reconstruct historical categories or add category snapshots/migrations/backfills. GET /users/me/recommendations is Customer-only/no-store, accepts no query parameters and returns data.label (PERSONALIZED or POPULAR) and data.products (at most 8 existing public ProductCards). PERSONALIZED is never empty; POPULAR may be empty, for example `{ "data": { "label": "POPULAR", "products": [] } }`. No affinity values, history source IDs, private identity or other Customer data are exposed.

M7.3 GET /users/me/items is Customer-only and no-store. Its strict query accepts page (default 1), perPage (default 20, maximum 50), and sort: recent (default, lastPurchasedAt DESC/productId ASC) or frequent (purchaseCount DESC/lastPurchasedAt DESC/productId ASC). Pagination counts deduplicated products and uses the standard meta. Reuse the existing integer offset representation check; unknown/repeated/invalid options return 422. Only owned orders currently DELIVERED contribute. purchaseCount sums OrderItem quantities, not order counts. lastPurchasedAt is the DELIVERED transition timestamp in OrderStatusHistory; source orderId and historical identification snapshot are selected by that timestamp DESC then orderId DESC.

Each entry returns productId, purchaseCount, lastPurchasedAt, orderId, snapshot (persisted OrderItem sku, productName, imageUrl, sellingUnit), currentProduct (the existing public ProductCard or null), currentPrice (its exact VND price string or null), and availability (IN_STOCK, OUT_OF_STOCK, UNAVAILABLE). Historical identity is always retained without substituting current catalog data. Public products with a current price use current stock for IN_STOCK/OUT_OF_STOCK; hidden/archived/category-hidden/missing-current-price products are UNAVAILABLE with null currentProduct/currentPrice. Never expose hidden current metadata or use historical prices as current prices.

Wishlist endpoints are Customer-only and return `Cache-Control: no-store`. GET returns a nullable wishlist ID, a stable item list, and an item count without creating database state when the wishlist is absent. PUT accepts no request fields, adds only a currently public product, and returns the complete reconciled wishlist; adding the same product again is a successful no-op even if that saved product has since become unavailable. Public out-of-stock products may be saved and return `OUT_OF_STOCK`. Items saved before a product becomes hidden or archived remain removable and return `UNAVAILABLE` with a null product projection, avoiding exposure of non-public catalog data. DELETE accepts no request fields, removes only the authenticated Customer's matching product, returns 204, and remains successful when that membership is already absent.

### Checkout

- `POST /checkout/quote` - validate the current cart and address choice and return a short-lived server-calculated summary for display; it does not reserve stock.
- `POST /checkout/orders` - atomically create a COD order from the active cart.

`POST /checkout/quote` is Customer-only, no-store, accepts only `{ "addressId": "<uuid>" }`, and rejects unknown body fields and query options. The address must be active, valid, and owned; foreign/missing/archived addresses use concealed 404 semantics. Every such address is eligible, with no geographic restrictions. Empty carts return `409 CART_EMPTY`; unavailable products, missing current prices, or insufficient stock return `409 PRODUCT_UNAVAILABLE` without altering cart or inventory.

The response `data` contains `cartId`, `address`, `currency: "VND"`, `items`, `subtotal`, `shippingFee`, `discountTotal`, `total`, `quotedAt`, and `expiresAt`. Each item contains `itemId`, `productId`, `sku`, `name`, `quantity`, `stock`, `unitPrice`, nullable `compareAtPrice`, and `lineTotal`. Prices/totals are exact integer strings. Server current selling price determines lineTotal and subtotal; `discountTotal` is always `"0"`, and compareAtPrice is display-only. Amounts exceeding the BIGINT money contract return 422 validation errors.

Server configuration `SHIPPING_FIXED_FEE_VND` and `SHIPPING_FREE_THRESHOLD_VND` uses non-negative integer-VND strings within BIGINT range, defaulting to the approved 30000 and 500000. Shipping is zero when merchandise subtotal >= threshold, otherwise the fixed fee. Invalid configuration fails startup without exposing its value. Quote timestamps use authoritative database time and expire after five minutes; expiration does not reserve stock or lock prices. Order creation must independently revalidate server prices, stock, and totals, regardless of any earlier quote.

Order creation requires `Idempotency-Key: <uuid>`. The key is scoped to the authenticated Customer and retained with the order. The strict body requires `cartId` and `addressId` and optionally accepts nullable `customerNote` (trimmed, maximum 500 characters after trim; omitted/null/empty/whitespace-only becomes null). UUIDs use canonical lowercase form. No other body fields or query options are accepted. Fingerprint fields and replay rules are owned by DATABASE.md. Repeating the same key and canonical client intent returns the same committed order without revalidation of mutable server state. Reusing the key with a different cartId/addressId/normalized note returns `400 IDEMPOTENCY_KEY_REUSED`. A quote ID or frontend total is never trusted as price authority.

New creation returns 201; replay returns 200. Both are Customer-only and no-store and return the safe persisted order summary (ID, order number/status, COD/VND, exact monetary strings, delivery snapshot, normalized customerNote, immutable items, and placedAt), never the internal fingerprint or idempotency key. On the first request, foreign/missing/non-active cart or address IDs return concealed 404; an empty owned cart returns 409 CART_EMPTY, and unavailable/missing-price products return 409 PRODUCT_UNAVAILABLE. Checkout stock shortages return 409 INSUFFICIENT_STOCK with authoritative product ID, requested quantity, and available quantity; quote's existing PRODUCT_UNAVAILABLE semantics remain unchanged. Missing or malformed keys and invalid body fields return 422. Order, items, initial actor-attributed PENDING history, stock decrement, ORDER_DEBIT movements, and cart clearing/check-out commit together; a failed step rolls all of them back. Creation serializes against cart/address mutations and locks inventory in stable product-ID order as defined in DATABASE.md. Replay returns before those effects and never touches a newly active cart.

```json
{
  "cartId": "a6620237-185f-47a8-9d94-69fa51d4aa8a",
  "addressId": "ab60db36-8b4d-4a91-bf42-a17ad33db0a2",
  "customerNote": "Giao trong gio hanh chinh"
}
```

The implemented contract selects only a saved owned address; inline address fields are rejected. The order stores an immutable snapshot. Checkout behavior, inventory locking, and rollback are defined in `docs/DATABASE.md`.

### Orders and reorder

- `GET /orders` - paginate the current customer's orders.
- `GET /orders/:orderId` - return an owned order, snapshots, and timeline.
- `GET /orders/by-number/:orderNumber` - M7.5 canonical order-detail lookup. Customer-only, no-store, no query options. Resolve the exact persisted orderNumber together with authenticated ownership; malformed, missing and foreign numbers share concealed 404. Reuse the unchanged M7.1 immutable detail/complete redacted history response and indexes. Existing orderId endpoints remain unchanged.

M7.1 Customer reads use database-authoritative Customer authorization, concealed 404 for missing/foreign/malformed order IDs, and no-store responses. List accepts only `page` (default 1), `perPage` (default 20, maximum 50), optional `status` from the existing six order statuses, and `sort` (`newest` by default or `oldest`). Date filters are outside M7.1. Newest orders by createdAt DESC then id DESC; oldest orders by createdAt ASC then id ASC. Unknown/repeated/malformed parameters return 422; pagination offsets must fit Prisma's integer skip representation rather than overflowing it.

List exposes only id, orderNumber, status, createdAt, subtotal, shippingFee, discountTotal, total, currency, paymentMethod, and itemCount, with the standard pagination meta. itemCount follows the existing shopping count convention: the sum of persisted item quantities. Detail reuses the safe checkout order snapshot fields (including address, immutable items, customerNote, placedAt, exact VND monetary strings, and current status), adds createdAt and complete statusHistory. History exposes only fromStatus, toStatus, reason, and createdAt, ordered createdAt ASC then persisted history id ASC. Raw actor IDs, emails, internal actor identity, idempotency keys, and request fingerprints are omitted. No safe persisted actor-source/type exists in the current model, so M7.1 adds none. Reads never substitute current catalog/address data for snapshots or mutate the order.

- `POST /orders/:orderId/cancel` - cancel an owned `PENDING` or `CONFIRMED` order. The strict body accepts only optional `reason`: trim it, allow at most 240 characters after trim, and canonicalize omitted/null/empty/whitespace-only to null. Excess length returns 422. The successful transition persists the normalized reason in cancellation history and the order; actor, status, quantities, and timestamps are server-owned. Return 200 with the existing safe Customer detail response, including current status and complete history. Customer authorization, no-store, and concealed ownership 404 apply. An owned order already CANCELLED returns the current detail as a successful no-op, even with a different valid reason; it never overwrites the original reason or creates history, movements, or additional restoration. Concurrent losers use the same no-op behavior after locking. Other ineligible statuses return 409 INVALID_ORDER_TRANSITION.
- `POST /orders/:orderId/reorder` - add currently available products from an owned order to the active cart.

Reorder is intentionally partial and reports every outcome:

```json
{
  "data": {
    "cartId": "8ae0b1ba-2414-4d55-a0ad-7cc6ab8a4f96",
    "added": [
      {
        "productId": "b2ecb79a-b74a-4748-93dc-f2fc02b93b3d",
        "quantity": 2,
        "currentUnitPrice": "149000"
      }
    ],
    "skipped": [
      {
        "productId": "7846f9c2-a3f4-4145-86d6-118319d06513",
        "reason": "OUT_OF_STOCK"
      }
    ]
  }
}
```

Historical price is never restored. M7.4 reorder uses each persisted OrderItem.quantity unchanged and increments the existing active-cart product row. It accepts no body fields or query options, uses Customer authorization/concealed owned-order 404, returns 200 partial results with no-store, and serializes with existing cart/checkout commands on the owning User row. added.quantity is the quantity added by this command, not the accumulated cart quantity; currentUnitPrice is the current exact VND selling price. Every source product appears once in added or skipped, with deterministic source-item createdAt/id ordering within each list.

The complete skipped reason enum is UNAVAILABLE (archived/hidden product, hidden/archived category ancestry, or missing current price), OUT_OF_STOCK (public current-priced product with zero current stock), and QUANTITY_LIMITED (accumulated cart quantity would exceed 99). Validate current catalog availability before the quantity cap. Skip the entire affected line without clamping or changing existing quantity; other valid lines commit. Reorder requires stock greater than zero, but does not limit the resulting cart quantity to stock or reserve inventory; checkout revalidates authoritative stock. An all-skipped command preserves an existing active cart or returns cartId null without creating an empty cart. Successful repeated commands increment again according to cart-add semantics and may subsequently skip at the cap; there is no reorder idempotency-key contract. Expected per-line skips are partial success, while unexpected persistence failures roll back the command's cart writes together.

## Admin endpoints

All endpoints below require `ADMIN`. Responses use `Cache-Control: no-store`, and every mutation is audited.

### Admin mutation audit contract

Each successfully committed Admin command creates exactly one `AdminAuditLog` row using the request correlation ID and database-authoritative Admin actor. Database mutations and the audit insert share one transaction; if either fails, neither commits. Failed or rejected commands and idempotent commands that make no state change do not create generalized audit rows. Media-signature issuance is the exception to the database-mutation description: successful issuance is audited as a sensitive capability grant, while the signature and credential material are never stored.

Actions use this stable command vocabulary: `CATEGORY_CREATE`, `CATEGORY_UPDATE`, `CATEGORY_ARCHIVE`; `PRODUCT_CREATE`, `PRODUCT_UPDATE`, `PRODUCT_PUBLISH`, `PRODUCT_ARCHIVE`; `PRODUCT_MEDIA_SIGNATURE`, `PRODUCT_MEDIA_REGISTER`, `PRODUCT_MEDIA_UPDATE`, `PRODUCT_MEDIA_REMOVE`; `PRICE_CREATE`; `INVENTORY_ADJUST`; `PROMOTION_CREATE`, `PROMOTION_UPDATE`, `PROMOTION_PUBLISH`, `PROMOTION_ARCHIVE`; `PROMOTION_MEDIA_SIGNATURE`, `PROMOTION_MEDIA_REGISTER`, `PROMOTION_MEDIA_REMOVE`; and `ORDER_STATUS_TRANSITION`. Category and Product commands target their entity IDs; Product media signature targets Product while registration/update/removal target ProductImage; price creation targets ProductPriceHistory; inventory adjustment targets Inventory; Promotion and its single-media association target Promotion; order status transition targets Order. Product-media removal uses the removed ProductImage snapshot followed by JSON null; Promotion-media removal uses the safe owning-Promotion state before and after association removal. Order-transition snapshots contain only order number, status, and cancellation reason when relevant. Snapshots use server-side business-field allowlists and never contain raw request bodies, request headers, authentication material, Cloudinary signatures/secrets, full address/item snapshots, idempotency/request fingerprints, inventory internals, or raw provider responses. Domain histories remain authoritative for price intervals, inventory movements, order status, and provider cleanup attempts.

The generalized audit vocabulary additionally includes M8.3 `USER_STATUS_CHANGE`, targeting the persisted User ID with entity type `USER`. Its operational allowlist is defined in the Users contract below.

### Shell authorization

- `GET /admin` - validate the current database-backed Admin role and return the safe identity used to enter the admin shell.

### Users

- `GET /admin/users` - search and paginate users.
- `GET /admin/users/:userId` - retrieve allowed profile and operational data.
- `PATCH /admin/users/:userId/status` - suspend, reactivate, or archive according to policy.

Admin user responses never include password hashes, refresh token hashes, or raw authentication secrets.

M8.3 uses the authoritative `SUSPENDED` enum for the owner's DISABLED state. List query keys are exactly `q`, `role`, `status`, `sort`, `page`, `perPage`; unknown/repeated/invalid options return 422. q trims and collapses whitespace, empty means omitted, maximum 100 normalized characters, case-insensitive contains over email/firstName/lastName only, without fuzzy matching. Single role CUSTOMER|ADMIN and single UserStatus filters default to all. Positive integer page defaults to 1; perPage defaults to 20 with maximum 50; offsets must fit the existing Prisma integer range. Sort defaults to newest (createdAt DESC,id DESC), with oldest (both ASC) and email (normalized email ASC,id ASC). Standard pagination metadata applies. List and detail expose only id, email, firstName, lastName, role, status, createdAt, updatedAt, archivedAt. No phone, auth metadata, sessions/tokens, addresses, commerce relations/counts, or audit history is projected. Detail accepts no query options.

PATCH status accepts only required expectedStatus/toStatus and a reason required for targets SUSPENDED or ARCHIVED (trimmed nonblank 1-240 characters); reason on reactivation to ACTIVE is rejected with 422. Customer transitions: ACTIVE -> SUSPENDED|ARCHIVED, SUSPENDED -> ACTIVE|ARCHIVED; ARCHIVED is terminal. Other Admin accounts allow ACTIVE -> SUSPENDED and SUSPENDED -> ACTIVE only; Admin archive and role changes are prohibited. Self-status commands return 409 ADMIN_SELF_STATUS_CHANGE_FORBIDDEN. A disabling Admin command must leave at least one ACTIVE non-archived Admin or return 409 LAST_ACTIVE_ADMIN_REQUIRED. Locked current status equal to target returns HTTP 200 no-op, preserving timestamps/reason and adding no revocation or audit. Other expected-status mismatches return 409 USER_STATUS_CONFLICT with details [{currentStatus,expectedStatus}]. Invalid matrix returns 409 INVALID_USER_STATUS_TRANSITION. Success returns the authoritative safe detail under data. SUSPENDED/ARCHIVED revokes all unrevoked target sessions atomically; reactivation requires fresh login and does not revive sessions. Existing database-authoritative middleware rejects subsequent requests immediately.

Actual status changes create one USER_STATUS_CHANGE/USER audit with actor/request/target attribution, safe before/after userId, role, status, archivedAt and reason when relevant. No full profile/email, raw request, secret, session or commerce content is audited. Status, archivedAt, revocations and audit commit together; rejected, rolled-back and no-op commands create no audit.

### Categories

- `GET /admin/categories` - list all categories including archived records.
- `POST /admin/categories` - create a category.
- `GET /admin/categories/:categoryId` - retrieve one category.
- `PATCH /admin/categories/:categoryId` - update allowed fields.
- `POST /admin/categories/:categoryId/archive` - archive a category after dependency validation.
- `POST /admin/categories/:categoryId/restore` - restore when its parent state permits.
  Category creation accepts a globally unique lowercase slug, optional active top-level parent, bounded plain-text content, and a non-negative sortOrder. PATCH may change name, description, parent placement, and ordering; the public slug is immutable. The tree is limited to top-level categories and one child level. Self-parenting, ancestor cycles, third-level placement, and active parents beneath archived records are rejected. Archiving is idempotent but requires active children to be archived first; products assigned to an archived category remain stored and become unavailable through the established public catalog rules.

### Products, images, and prices

- `GET /admin/products` - search, filter, and paginate all product states.
- `POST /admin/products` - create a draft product.
- `GET /admin/products/:productId` - retrieve complete administration detail.
- `PATCH /admin/products/:productId` - update allowed catalog fields.
- `POST /admin/products/:productId/publish` - activate a valid product.
- `POST /admin/products/:productId/archive` - archive a product.
- `POST /admin/products/:productId/images/signature` - issue a short-lived signed Cloudinary upload contract.
- `POST /admin/products/:productId/images` - register uploaded media after server verification.
- `PATCH /admin/products/:productId/images/:imageId` - update order, alt text, or primary status.
- `DELETE /admin/products/:productId/images/:imageId` - remove a database association and schedule or perform controlled provider cleanup.
  The signature endpoint accepts no client-controlled provider parameters. It assigns a product-scoped public ID, persists an expiry-dated cleanup intent, and returns a product-folder-bound JPEG/PNG/WebP upload contract with a 4 MB maximum, a five-minute application expiry, the Cloudinary cloud name/API key, upload URL, and signed parameters; it never returns the API secret. Registration accepts the returned upload timestamp/signature plus `publicId`, alt text, order, and primary intent. The API recomputes the fixed signature, rejects expired contracts, verifies the provider resource belongs to the product folder, and uses provider-reported format, bytes, dimensions, and secure URL. Invalid or unattached uploads enter durable cleanup rather than being silently orphaned.

Image PATCH accepts only `altText`, `sortOrder`, and `isPrimary`. Ordering is unique per product and setting one image primary atomically clears the previous primary. DELETE atomically removes the association and creates a `MediaCleanup` task before the provider call. Its response reports `COMPLETED`, `PENDING`, or `FAILED`; a provider failure never returns a false completed result. Repeating DELETE for the same product/image resumes or returns the existing cleanup task. The bounded `media:cleanup` command processes due PostgreSQL tasks after restarts, stops automatic retries after five failed attempts, and supports an explicit operator restart after the provider issue is corrected.

- `GET /admin/products/:productId/prices` - list price history.
- `POST /admin/products/:productId/prices` - atomically create the next non-overlapping price interval. The request supplies positive whole-VND `price`, optional greater `compareAtPrice`, and the successor `startsAt`; the successor is open-ended. The service serializes changes per product, requires `startsAt` after the latest interval start, rejects insertion before or into an existing scheduled timeline, sets only the latest open-ended predecessor's `endsAt` to exactly `startsAt`, and inserts the actor-attributed successor in one transaction. Existing price, compare-at, start, actor, and creation fields cannot be edited, no generic price-history PATCH exists, and a closed interval cannot be reopened. The response returns the created interval and the ordered history remains available through GET.
  Product creation always produces a private `DRAFT`, requires an active category, a globally unique stable SKU and slug, and an initial positive whole-VND price. An optional compare-at price must exceed the selling price. Creation also establishes the product's single zero-quantity inventory row. PATCH allows only catalog content, category assignment, selling unit, and curated flags; SKU, slug, price, inventory, and status are immutable or use their dedicated commands. Publishing requires a non-archived product, an active category, and its valid initial price. Archiving is idempotent and hides the product from every public catalog response without deleting it. Admin list queries support bounded `q`, `status`, `categoryId`, `page`, and `perPage` values.

### Inventory

- `GET /admin/inventory` - filter inventory and low-stock products.
- `GET /admin/inventory/:productId/movements` - paginate immutable movement history.
- `POST /admin/inventory/:productId/adjustments` - apply a signed quantity delta with a required reason.

Inventory adjustment accepts a delta, not an unguarded absolute overwrite. The response includes `quantityBefore` and `quantityAfter`.

Inventory list filtering uses an optional caller-supplied inclusive `maxQuantity` ceiling for low-stock views; omitting it lists all quantities. Inventory and movement results use stable pagination. Adjustment input is a non-zero signed integer delta plus a required bounded plain-text reason; before/after values, movement type, and actor are server-owned. Adjustments serialize on the product's inventory row and commit the quantity change and append-only movement together. Archived products remain adjustable so stock can be reconciled and future order cancellation can restore inventory without reopening the catalog item.

### Promotions

- `GET /admin/promotions` - list promotions by status, placement, and schedule.
- `POST /admin/promotions` - create a draft promotion.
- `GET /admin/promotions/:promotionId` - retrieve one promotion.
- `PATCH /admin/promotions/:promotionId` - update content, placement, schedule, or sort order.
- `POST /admin/promotions/:promotionId/publish` - activate a valid promotion.
- `POST /admin/promotions/:promotionId/archive` - archive a promotion.
- `POST /admin/promotions/:promotionId/media/signature` - issue a short-lived signed upload contract where needed.
- POST /admin/promotions/:promotionId/media - register a verified promotion-scoped upload, replacing the existing single image through durable cleanup when present.
- DELETE /admin/promotions/:promotionId/media - remove the current image association and run or schedule durable provider cleanup.

Promotion links accept validated MartHub-internal paths only. Content and media must use MartHub branding and may not reuse reference-brand assets.

Creation always produces a DRAFT. PATCH manages only content, placement, internal destination, half-open schedule, and non-negative sort order. Publish activates a non-archived valid row. Archive is idempotent, hides the row publicly, retains its image association, and enqueues no cleanup. Public eligibility remains ACTIVE, non-archived, startsAt less than or equal to database time, and endsAt null or greater than database time, ordered by placement, sort order, newest start, and ID.

Promotion media uses the M4.4 JPEG/PNG/WebP, exact 4 MB, five-minute, server-secret, provider-verification, optimized-delivery, and durable bounded-cleanup policy under a server-controlled marthub/promotions/:promotionId path. Registration consumes the upload intent only after provider verification. Replacement atomically attaches the new source and records cleanup truth for the old source; removal atomically clears the association and records cleanup truth.

### Orders and statistics

- `GET /admin/orders` - search, filter, sort, and paginate orders.
- `GET /admin/orders/:orderId` - retrieve order detail and status history.
- `POST /admin/orders/:orderId/transitions` - apply one allowed stale-protected transition; cancellation requires a reason and forward transitions reject one.
- `GET /admin/statistics/overview` - delivered-sales and created-order KPIs for a bounded calendar-date range.
- `GET /admin/statistics/top-products` - bounded historical sales ranking for the same range.
- `GET /admin/statistics/low-stock` - bounded current operational stock projection.

M8.1 Admin order reads are Admin-only and no-store. `GET /admin/orders` accepts only `q`, `status`, `sort`, `page`, and `perPage`; unknown or repeated parameters return 422. Search text is trimmed, consecutive whitespace collapses to one space, matching is case-insensitive contains, and normalized empty text is treated as omitted. Nonempty `q` is limited to 100 characters and searches only order number, the Customer's current email, and the persisted recipient-name snapshot; item/product data is not searched. `status` is one optional value from the six existing order statuses and omission means all statuses. Date range filters are outside M8.1. `page` defaults to 1 and `perPage` to 20, both must be positive integers, and `perPage` is capped at 50. `sort` accepts `newest` (default: `createdAt DESC, id DESC`) or `oldest` (`createdAt ASC, id ASC`). The standard pagination metadata is returned.

Each queue row exposes only `id`, `orderNumber`, `status`, `createdAt`, exact-string `subtotal`, `shippingFee`, `discountTotal`, `total`, `currency`, `paymentMethod`, summed persisted-quantity `itemCount`, and `customer` with `userId` and current `email`. It omits the full delivery snapshot, authentication/session/password data, idempotency key, request fingerprint, and internal inventory/audit metadata.

`GET /admin/orders/:orderId` accepts no query options and returns the persisted order ID/number, status, createdAt, payment method/currency, immutable monetary totals, normalized customer note, immutable delivery/address snapshot, and immutable OrderItem identity/image/selling-unit/quantity/price/line-total snapshots. It also returns `customer` with userId, current email, and only the safe User profile fields already allowed by existing Admin/User projections. Complete status history is ordered by `createdAt ASC, id ASC` and exposes only `id`, `status` (the persisted `toStatus`), `reason`, `createdAt`, and `actorUserId`; actor email/name is not joined and no actor type is inferred. Reads never substitute current User address or Product/catalog fields for persisted order snapshots. Passwords, session/refresh data, auth secrets, idempotency keys, request fingerprints, and unrelated internal metadata are omitted.

Transition requests name the intended target; the server validates the current state and actor permission:

```json
{
  "expectedStatus": "CONFIRMED",
  "toStatus": "PACKING"
}
```

The strict request requires `expectedStatus` and `toStatus`. It accepts `reason` only when `toStatus` is `CANCELLED`; every Admin cancellation from `PENDING`, `CONFIRMED`, or `PACKING` requires a trimmed nonblank reason of at most 240 characters. Blank or overlong cancellation reasons and any reason supplied for a non-cancellation transition return 422. No successful Admin cancellation stores a null reason.

The transaction locks the authoritative Order row. If its current status differs from `expectedStatus`, current status equal to `toStatus` is a successful retry/no-op; otherwise the response is `409 ORDER_STATUS_CONFLICT` with safe details containing `currentStatus` and `expectedStatus`, and no mutation occurs. A same-target no-op returns the current projection without adding history, inventory effects, movements, or generalized audit and never overwrites an existing cancellation reason. This includes a repeated cancellation carrying a different valid reason. When current status equals `expectedStatus`, only the explicit matrix in DATABASE.md is permitted; invalid jumps, reversals, and terminal-state mutations return `409 INVALID_ORDER_TRANSITION`.

Successful mutations and no-ops return HTTP 200 with the refreshed M8.1 Admin order detail/history projection. A committed mutation appends exactly one actor-attributed status-history row. Cancellation restores stock exactly once and commits the Order update, history, inventory changes, movements, and one `ORDER_STATUS_TRANSITION`/`ORDER` generalized audit row together. Forward transitions have no inventory effect. Validation, authorization, conflict, rollback, and successful no-op outcomes create no generalized audit row.

### M8.4 statistics contract

Exactly these three GET endpoints reuse Admin RBAC/no-store and return a strict `data` envelope. Unknown, repeated or invalid query values return 422. No statistics UI or other financial metric is included.

Overview accepts only `from`, `to`, `timezone`; top-products additionally accepts `limit`. Dates are real `YYYY-MM-DD` calendar dates (years 0001-9999), supplied together or both omitted. Only `Asia/Ho_Chi_Minh` is accepted and is the default timezone. PostgreSQL transaction time determines today's local date; omitted dates select today minus 29 days through today (30 days inclusive). Reversed/partial/future dates or more than 366 inclusive calendar days return 422. There are no presets. Range metadata is exactly `from`, `to`, `timezone`, `startInclusive`, `endExclusive`, with UTC timestamps for local midnight of from and local midnight after to: `[startInclusive,endExclusive)`.

Overview data is exactly `range`, `revenue`, `deliveredOrderCount`, `unitsSold`, `createdOrderCount`, `statusCounts`. Delivered metrics require current status DELIVERED and Order.deliveredAt in range: revenue sums immutable Order.total (shipping included, discount already reflected); unitsSold sums eligible OrderItem.quantity. Created metrics use Order.createdAt in range regardless of status; statusCounts groups that population by CURRENT PENDING/CONFIRMED/PACKING/SHIPPING/DELIVERED/CANCELLED, with all six keys always present. Cancelled/non-delivered orders contribute only to created metrics, never sales. No current-price recomputation or history-derived delivery time is used.

Top-products data is exactly `range`, `limit`, `totalProducts`, `items`. Eligible delivered OrderItems group by productId; `soldQuantity` sums snapshot quantity and `revenue` sums snapshot lineTotal, ranked soldQuantity DESC, revenue DESC, productId ASC. Each row exposes productId, sku, productName, imageUrl, sellingUnit, soldQuantity, revenue only. Identification uses the eligible snapshot with deliveredAt DESC, orderId DESC; current archived/hidden/unavailable catalog state never removes or replaces historical identity. Limit defaults to 10, positive integer maximum 50; no pagination. totalProducts counts the entire distinct eligible product population before limit.

Low-stock accepts only `threshold` (integer 0-1000, default 5) and `limit` (positive integer maximum 50, default 10), with no date/timezone or pagination. It reads current single-location Inventory: quantity <= threshold includes zero. Current Product must be ACTIVE and non-archived with public active category ancestry and a price valid at transaction DB time, using existing catalog rules. Sort is quantity ASC, product name ASC, productId ASC. Data is exactly threshold, limit, totalProducts, items; each row exposes productId, sku, name, quantity, currentPrice, availability (the existing catalog availability object). totalProducts counts all matching eligible products before limit. No movements/audit metadata is exposed.

All unbounded aggregate money/count/quantity values, including totalProducts and every status count, are nonnegative exact decimal strings without a BIGINT ceiling on sums; never JavaScript Number. Current bounded Inventory quantity, limit and threshold are JSON integers; currentPrice retains the existing integer-VND contract. Empty aggregates/counts return "0", all six status counts return "0" and lists return []. Each endpoint reads a consistent repeatable-read snapshot; relative range/current-price time is the same PostgreSQL transaction time.

## Validation and authorization rules

- Shared Zod schemas in the contracts package define request and response shapes used by web and API; OpenAPI is generated from or checked against the same source where practical.
- IDs, slugs, emails, phone numbers, string lengths, enum values, money strings, quantities, and date ranges are validated before service execution.
- HTML is not accepted for product, promotion, address, or note fields in the MVP. Output encoding remains the frontend's responsibility.
- Ownership queries include the authenticated user constraint rather than loading a record first and checking afterward.
- Admin endpoints use explicit allowlists for writable fields. Role, price, inventory, order status, and media identifiers have dedicated commands.
- CORS permits only configured origins. JSON body and upload sizes are bounded. Cloudinary signatures constrain folder, file type, and expiry.

## Idempotency and concurrency

- Checkout requires `Idempotency-Key` and persists it with a request fingerprint.
- Wishlist `PUT` and `DELETE` are naturally idempotent.
- Cart add is not idempotent because repeated calls increment quantity; clients disable duplicate submission or use the set-quantity endpoint after reading state.
- Inventory adjustments use database transactions. Admin order transitions additionally require `expectedStatus`; the locked authoritative state decides same-target no-op versus `ORDER_STATUS_CONFLICT`, without a version column.
- Provider retries are limited to safe operations with bounded exponential backoff. The API does not retry an ambiguous checkout transaction at the HTTP layer; the client repeats the same idempotency key.

## Caching and HTTP behavior

Public category, product detail, and homepage responses may use short private or CDN-safe cache policies once invalidation behavior is verified. Customer and admin responses use `Cache-Control: no-store`. Authentication responses and any response carrying session state are never cached.

The MVP does not require Redis. Conditional requests with `ETag` may be added for read-heavy public resources without changing their JSON schema. Catalog mutations must invalidate or expire affected public representations.

## Contract governance

- OpenAPI 3.1 is the machine-readable contract and must include operation IDs, security requirements, schemas, examples, stable errors, and rate-limit responses.
- Additive response fields are backward compatible. Removing or changing field meaning requires a new API version or a documented deprecation window.
- Contract tests verify implementation responses against the schema for authentication, catalog, cart, checkout, orders, My Items, and admin operations.
- Postman collections are generated from or reconciled with OpenAPI rather than maintained as a competing contract.
- Request IDs, structured logs, latency metrics, error-rate metrics, and database timing provide the initial observability baseline. User-impacting endpoints should target a documented p95 latency budget after representative data and deployment measurements exist.
