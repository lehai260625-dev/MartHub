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

The API validates product status and quantity, but checkout remains the final price and stock authority. Clients may use optimistic UI and must roll back on error.

### Wishlist and My Items

- `GET /wishlist` - list wishlist items with current product state.
- `PUT /wishlist/items/:productId` - idempotently add a product.
- `DELETE /wishlist/items/:productId` - idempotently remove a product.
- `GET /users/me/items` - aggregate products from delivered orders, most recent first by default.
- `GET /users/me/recommendations` - return history-based recommendations or an explicitly labeled popular fallback.

My Items entries include `lastPurchasedAt`, `purchaseCount`, a recent source `orderId`, current product card data, and availability. Empty purchase history returns an empty `data` list, not an error.

### Checkout

- `POST /checkout/quote` - validate the current cart and address choice and return a short-lived server-calculated summary for display; it does not reserve stock.
- `POST /checkout/orders` - atomically create a COD order from the active cart.

Order creation requires `Idempotency-Key: <uuid>`. The key is scoped to the authenticated user and retained with the order. Repeating the same key and request fingerprint returns the original order response. Reusing the key for a different request returns `400 IDEMPOTENCY_KEY_REUSED`. A quote ID or frontend total is never trusted as price authority.

```json
{
  "addressId": "ab60db36-8b4d-4a91-bf42-a17ad33db0a2",
  "customerNote": "Giao trong gio hanh chinh"
}
```

The address may alternatively be an inline validated address if the OpenAPI contract explicitly selects that mutually exclusive shape. In either case, the order stores an immutable snapshot. Checkout behavior, inventory locking, and rollback are defined in `docs/DATABASE.md`.

### Orders and reorder

- `GET /orders` - paginate the current customer's orders.
- `GET /orders/:orderId` - return an owned order, snapshots, and timeline.
- `POST /orders/:orderId/cancel` - cancel an owned `PENDING` or `CONFIRMED` order with a reason.
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

Historical price is never restored. Supported skip reasons are stable codes such as `PRODUCT_ARCHIVED`, `OUT_OF_STOCK`, and `QUANTITY_LIMITED`.

## Admin endpoints

All endpoints below require `ADMIN`. Responses use `Cache-Control: no-store`, and every mutation is audited.

### Admin mutation audit contract

Each successfully committed Admin command creates exactly one `AdminAuditLog` row using the request correlation ID and database-authoritative Admin actor. Database mutations and the audit insert share one transaction; if either fails, neither commits. Failed or rejected commands and idempotent commands that make no state change do not create generalized audit rows. Media-signature issuance is the exception to the database-mutation description: successful issuance is audited as a sensitive capability grant, while the signature and credential material are never stored.

Actions use this stable command vocabulary: `CATEGORY_CREATE`, `CATEGORY_UPDATE`, `CATEGORY_ARCHIVE`; `PRODUCT_CREATE`, `PRODUCT_UPDATE`, `PRODUCT_PUBLISH`, `PRODUCT_ARCHIVE`; `PRODUCT_MEDIA_SIGNATURE`, `PRODUCT_MEDIA_REGISTER`, `PRODUCT_MEDIA_UPDATE`, `PRODUCT_MEDIA_REMOVE`; `PRICE_CREATE`; `INVENTORY_ADJUST`; `PROMOTION_CREATE`, `PROMOTION_UPDATE`, `PROMOTION_PUBLISH`, `PROMOTION_ARCHIVE`; and `PROMOTION_MEDIA_SIGNATURE`, `PROMOTION_MEDIA_REGISTER`, `PROMOTION_MEDIA_REMOVE`. Category and Product commands target their entity IDs; Product media signature targets Product while registration/update/removal target ProductImage; price creation targets ProductPriceHistory; inventory adjustment targets Inventory; Promotion and its single-media association target Promotion. Product-media removal uses the removed ProductImage snapshot followed by JSON null; Promotion-media removal uses the safe owning-Promotion state before and after association removal. Snapshots use server-side business-field allowlists and never contain raw request bodies, request headers, authentication material, Cloudinary signatures/secrets, or raw provider responses. Domain histories remain authoritative for price intervals, inventory movements, and provider cleanup attempts.

### Shell authorization

- `GET /admin` - validate the current database-backed Admin role and return the safe identity used to enter the admin shell.

### Users

- `GET /admin/users` - search and paginate users.
- `GET /admin/users/:userId` - retrieve allowed profile and operational data.
- `PATCH /admin/users/:userId/status` - suspend, reactivate, or archive according to policy.

Admin user responses never include password hashes, refresh token hashes, or raw authentication secrets.

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
- `POST /admin/orders/:orderId/transitions` - apply one allowed transition with an optional or required reason.
- `GET /admin/statistics/overview` - delivered-sales totals, order counts, top products, and low-stock counts for a bounded date range.

Transition requests name the intended target; the server validates the current state and actor permission:

```json
{
  "toStatus": "PACKING",
  "reason": null
}
```

Invalid jumps, reversals, and terminal-state mutations return `409 INVALID_ORDER_TRANSITION`. Cancellation through `PACKING` requires a reason and restores stock exactly once in the same transaction.

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
- Inventory adjustments and order transitions use database transactions and should accept an optional expected version or current state when the implementation introduces optimistic concurrency.
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
