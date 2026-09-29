# MartHub Database Design

This document defines the approved PostgreSQL and Prisma data model for the MartHub MVP. It is the source of truth for data ownership, relational constraints, indexes, monetary representation, archival rules, and transactional behavior. Roadmap status and task acceptance criteria belong in `docs/PLAN.md`.

## Design principles

- PostgreSQL is the system of record; Prisma is the application ORM and migration tool.
- The MVP is single-vendor, uses one inventory location, and treats each product as one sellable SKU.
- Internal identifiers are UUIDs. Public order numbers are separate, human-readable identifiers.
- All timestamps use timezone-aware PostgreSQL timestamps and are exposed as ISO 8601 UTC strings.
- Referential actions are explicit. Business records are archived or made immutable when deletion would damage history.
- Checkout, cancellation, and inventory changes are database transactions; frontend state is never authoritative.

## Shared conventions

Most mutable entities contain `id`, `createdAt`, and `updatedAt`. Prisma maps field names to snake_case database columns. User-facing slugs are normalized lowercase strings and are unique among records that can be addressed publicly.

### Money

All VND amounts are integer dong stored as PostgreSQL `BIGINT` and Prisma `BigInt`. Floating-point and database decimal fractions are not used for money. Values must be non-negative unless a field explicitly models an adjustment. The REST API serializes money as base-10 integer strings, for example `"149000"`, because JavaScript numbers cannot safely represent every 64-bit integer.

Line totals and order totals are stored snapshots. The checkout service performs integer arithmetic and verifies:

`subtotal + shippingFee - discountTotal = total`

The MVP does not include tax, coupons, or online payment. Fields such as `discountTotal` remain useful for product markdowns or future-compatible totals, but the backend alone calculates them.

### Enumerations

- `UserRole`: `CUSTOMER`, `ADMIN`
- `UserStatus`: `ACTIVE`, `SUSPENDED`, `ARCHIVED`
- `ProductStatus`: `DRAFT`, `ACTIVE`, `ARCHIVED`
- `CategoryStatus`: `ACTIVE`, `ARCHIVED`
- `PromotionStatus`: `DRAFT`, `ACTIVE`, `ARCHIVED`
- `PromotionPlacement`: `HERO_PRIMARY`, `HERO_SECONDARY`, `EDITORIAL`
- `OrderStatus`: `PENDING`, `CONFIRMED`, `PACKING`, `SHIPPING`, `DELIVERED`, `CANCELLED`
- `InventoryMovementType`: `INITIAL`, `ADJUSTMENT`, `ORDER_DEBIT`, `ORDER_CANCEL_RESTORE`

## Domain model

### User

Fields: `id`, `email`, `passwordHash`, `firstName`, `lastName`, `phone`, `role`, `status`, `lastLoginAt`, `createdAt`, `updatedAt`, `archivedAt`.

- `email` is trimmed, normalized to lowercase, and unique.
- Password hashes are never selected by default in application projections.
- `role` defaults to `CUSTOMER`; public registration cannot choose a role.
- Archiving or suspension prevents new sessions without erasing order history.
- A user owns refresh sessions, addresses, one active cart, one wishlist, and orders.

Indexes: unique normalized email; `(status, createdAt)` for administration.

### RefreshSession

Fields: `id`, `userId`, `tokenHash`, `familyId`, `parentSessionId`, `userAgent`, `ipAddress`, `expiresAt`, `lastUsedAt`, `revokedAt`, `revokeReason`, `createdAt`.

- Only a SHA-256 hash of the opaque refresh token is stored.
- `tokenHash` is unique. `familyId` groups rotated tokens for reuse detection.
- `parentSessionId` is an optional self-reference that records rotation lineage.
- A revoked or expired session cannot be refreshed. Reuse revokes the whole family.
- Deleting a user may cascade sessions only when the user itself is legally and operationally safe to delete; the normal operation is archival.

Indexes: unique `tokenHash`; `(userId, revokedAt)`; `(familyId, revokedAt)`; `expiresAt` for cleanup.

### AuthThrottle (operational)

Authentication rate limits use shared PostgreSQL counters rather than process-local memory. `auth_throttles` stores a SHA-256 key for operation plus IP/account identity, an integer attempt count, and a timezone-aware expiry. Atomic upserts use the database clock; expired counters reset on reuse. An expiry index supports bounded cleanup. Counters contain no passwords, tokens, raw emails, or raw IP addresses.

### Address

Fields: `id`, `userId`, `label`, `recipientName`, `phone`, `line1`, `line2`, `ward`, `district`, `province`, `postalCode`, `isDefault`, `createdAt`, `updatedAt`, `archivedAt`.

- Addresses belong to one user and are never readable or writable by another customer.
- At most one non-archived default address exists per user. This is enforced with a partial unique index in SQL.
- Removing an address archives it. Existing orders are unaffected because they store an address snapshot.

Indexes: `(userId, archivedAt)` and partial unique `(userId) WHERE is_default = true AND archived_at IS NULL`.

### Category

Fields: `id`, `parentId`, `name`, `slug`, `description`, `imagePublicId`, `imageUrl`, `status`, `sortOrder`, `createdAt`, `updatedAt`, `archivedAt`.

- `parentId` is an optional self-reference. The MVP supports a shallow department/category tree; the application prevents cycles.
- `slug` is globally unique and immutable once public unless an explicit redirect strategy is added.
- Categories with products or children are archived, not deleted.

Indexes: unique `slug`; `(parentId, status, sortOrder)`; `(status, sortOrder)`.

### Product

Fields: `id`, `categoryId`, `sku`, `name`, `slug`, `shortDescription`, `description`, `brand`, `sellingUnit`, `status`, `isFeatured`, `isNew`, `isPopular`, `publishedAt`, `createdAt`, `updatedAt`, `archivedAt`.

- One product represents one sellable SKU in the MVP; variants are outside scope.
- `sku` and `slug` are unique. SKU is treated as stable business identity.
- A product belongs to one category. Public queries require both the product and its category to be active.
- `isFeatured`, `isNew`, and `isPopular` support curated rails. They are not inferred badges unless the merchandising rules say so.
- Products referenced by orders, inventory movements, cart items, or wishlist items are archived rather than deleted.

Indexes: unique `sku`; unique `slug`; `(categoryId, status, createdAt)`; `(status, isFeatured)`; `(status, isNew, publishedAt)`; `(status, isPopular)`; `(status, createdAt)`. Search begins with PostgreSQL full-text or trigram indexes on normalized `name`, `brand`, and SKU; the exact index is introduced with the search implementation and verified with query plans.

### ProductImage

Fields: `id`, `productId`, `cloudinaryPublicId`, `url`, `altText`, `width`, `height`, `sortOrder`, `isPrimary`, `createdAt`, `updatedAt`.

- `cloudinaryPublicId` is unique and is used for managed deletion or replacement.
- At most one primary image exists per product, enforced by a partial unique index.
- Image order is deterministic. Product deletion does not silently delete Cloudinary assets; media cleanup is an explicit operation.

Indexes: unique `cloudinaryPublicId`; unique `(productId, sortOrder)`; partial unique `(productId) WHERE is_primary = true`.

### MediaCleanup

Media cleanup ownership is explicit: ownerType is PRODUCT_IMAGE or PROMOTION_MEDIA. A database check requires exactly the matching product fields or promotion field, so one task cannot ambiguously belong to both. Product removal, promotion removal/replacement, and abandoned signed uploads use the same PENDING/FAILED/COMPLETED retry lifecycle.

Fields: `id`, `ownerType`, nullable `productId`, nullable `productImageId`, nullable `promotionId`, `cloudinaryPublicId`, `status`, `attemptCount`, `nextAttemptAt`, `lastErrorCode`, `createdAt`, `updatedAt`, `completedAt`.

- Status is `PENDING`, `FAILED`, or `COMPLETED`; the row is durable provider-deletion truth for removed Product or Promotion media, or a signed upload intent that has not been registered. Successful registration atomically consumes its intent; abandoned intents become eligible for cleanup after signature expiry.
- Product image removal and Promotion media removal/replacement commit their database association change and cleanup-task creation atomically. Cloudinary deletion starts only after that commit.
- A provider `not found` result is successful and makes retries idempotent. Other failures increment `attemptCount`, preserve a bounded safe error code, and schedule another attempt. Five failed attempts end the automatic retry cycle as `FAILED` until an operator explicitly restarts it.
- `productImageId` (when present) and `cloudinaryPublicId` are unique. Repeated Product or Promotion media removal returns or resumes the existing cleanup outcome without ambiguous provider work.

Indexes: unique nullable `productImageId`; unique `cloudinaryPublicId`; `(status, nextAttemptAt)`; `(productId, createdAt)`; `(promotionId, createdAt)`.

### ProductPriceHistory

Fields: `id`, `productId`, `price`, `compareAtPrice`, `startsAt`, `endsAt`, `createdByUserId`, `createdAt`.

- `price` is required and positive. `compareAtPrice`, when present, must exceed `price`.
- Active price intervals for one product must not overlap. The service validates this and a PostgreSQL exclusion constraint should enforce it when range support is introduced in the migration.
- `endsAt` is exclusive. The current price is the row whose interval contains the database transaction time.
- Price rows are immutable after creation except for one successor transition: in the same transaction that inserts the direct successor, the service may set the predecessor's `endsAt` to exactly the successor's `startsAt`. Price, compare-at price, start time, actor, and creation time never change; closed intervals cannot be reopened or otherwise edited.
- Successor creation locks the product to serialize Admin changes, rejects insertion into the middle of an existing or scheduled timeline, closes only the latest open-ended predecessor, and inserts the actor-attributed successor atomically. The exclusion constraint remains authoritative; any validation, insert, or actor-persistence failure rolls back the predecessor closure.
- The successor `ProductPriceHistory` row is the M4.5 audit record. General cross-domain `AdminAuditLog` coverage remains owned by M4.8.

Indexes: `(productId, startsAt DESC)` and `(productId, endsAt)`.

### Inventory

Fields: `id`, `productId`, `quantityOnHand`, `updatedAt`.

- There is exactly one inventory row per product because the MVP has one warehouse.
- `quantityOnHand` is a non-negative integer and `productId` is unique.
- Checkout locks or conditionally updates this row. Inventory is never accepted from a customer request.

Indexes: unique `productId`; `quantityOnHand` for low-stock administration where query plans justify it.

### InventoryMovement

Fields: `id`, `productId`, `type`, `quantityDelta`, `quantityAfter`, `orderId`, `actorUserId`, `reason`, `idempotencyKey`, `createdAt`.

- Movements are append-only. `quantityDelta` may be positive or negative, while `quantityAfter` must be non-negative.
- The authoritative quantity before a movement is derived as `quantityAfter - quantityDelta`; clients never supply either boundary. Each adjustment locks the product inventory row and updates inventory plus inserts its movement in one PostgreSQL transaction.
- Order debit and cancellation restore movements reference the related order. The nullable UUID is present for M4.6; M6 adds its foreign key when the Order table is introduced.
- A unique business key prevents the same order effect from being applied twice, for example `(orderId, productId, type)`.
- Manual adjustments require an admin actor and reason.
- Same-product adjustments serialize on the inventory row. A failed validation, inventory update, or movement insert rolls back the whole transaction, so stock and history cannot diverge.

Indexes: `(productId, createdAt DESC)`; `(orderId, type)`; unique `(orderId, productId, type)` where `orderId` is not null.

### Cart and CartItem

`Cart` fields: `id`, `userId`, `createdAt`, `updatedAt`, `checkedOutAt`, `archivedAt`.

`CartItem` fields: `id`, `cartId`, `productId`, `quantity`, `createdAt`, `updatedAt`.

- A user has at most one active cart. A partial unique index enforces `(userId) WHERE checked_out_at IS NULL AND archived_at IS NULL`.
- `(cartId, productId)` is unique, so adding the same product changes quantity instead of creating a duplicate row.
- Quantity is a positive integer and is capped by an application constant to protect inventory and payloads.
- Cart items do not snapshot price. Every read reconciles current product status, price, and availability.
- Successful checkout marks the cart checked out and removes its items within the order transaction. A later add creates a new active cart.

Indexes: active-cart partial unique index; unique `(cartId, productId)`; `(productId)` for reconciliation and archival checks.

### Wishlist and WishlistItem

`Wishlist` fields: `id`, `userId`, `createdAt`, `updatedAt`.

`WishlistItem` fields: `id`, `wishlistId`, `productId`, `createdAt`.

- The MVP has one wishlist per user; `Wishlist.userId` is unique.
- `(wishlistId, productId)` is unique and mutations are idempotent.
- Archived or unavailable products may remain visible with a clear unavailable state, but cannot be added to cart.

Indexes: unique `userId`; unique `(wishlistId, productId)`; `(productId)`.

### Order

Fields: `id`, `orderNumber`, `userId`, `status`, `paymentMethod`, `currency`, `subtotal`, `shippingFee`, `discountTotal`, `total`, `recipientName`, `recipientPhone`, `addressLine1`, `addressLine2`, `ward`, `district`, `province`, `postalCode`, `customerNote`, `cancellationReason`, `idempotencyKey`, `requestFingerprint`, `placedAt`, `cancelledAt`, `deliveredAt`, `createdAt`, `updatedAt`.

- `paymentMethod` is fixed to `COD` and `currency` to `VND` for the MVP.
- `orderNumber` is unique and non-sequential enough not to expose order volume.
- `(userId, idempotencyKey)` is unique. `requestFingerprint` detects reuse of a key with a different request.
- Address fields are an immutable snapshot copied from a validated customer address or checkout input.
- Money totals are immutable after creation. Status changes occur only through the approved transition service.
- Orders are never hard-deleted.

Indexes: unique `orderNumber`; unique `(userId, idempotencyKey)`; `(userId, createdAt DESC)`; `(status, createdAt)`; `(deliveredAt)` for statistics.

### OrderItem

Fields: `id`, `orderId`, `productId`, `sku`, `productName`, `imageUrl`, `sellingUnit`, `unitPrice`, `compareAtPrice`, `quantity`, `lineTotal`, `createdAt`.

- SKU, name, representative image, selling unit, and prices are snapshots and remain stable if the product later changes.
- `productId` is retained for navigation and My Items aggregation but can be nullable only if a future retention policy requires anonymized product removal.
- Quantity is positive and `lineTotal = unitPrice * quantity`.
- An order contains at most one row per product in the MVP.

Indexes: unique `(orderId, productId)`; `(productId, createdAt DESC)` for purchased-item aggregation.

### OrderStatusHistory

Fields: `id`, `orderId`, `fromStatus`, `toStatus`, `actorUserId`, `reason`, `createdAt`.

- History is append-only and records every transition, including initial creation where `fromStatus` is null.
- `actorUserId` identifies customer or admin actions; system-created events may leave it null with a system reason.
- The order status update and history insert occur in the same transaction.

Indexes: `(orderId, createdAt)`; `(actorUserId, createdAt DESC)`.

### Promotion

Fields: `id`, `title`, `subtitle`, `imagePublicId`, `imageUrl`, `internalHref`, `placement`, `status`, `sortOrder`, `startsAt`, `endsAt`, `createdByUserId`, `createdAt`, `updatedAt`, `archivedAt`.

- Promotions are a deliberately small merchandising model, not a page builder.
- Links must be validated internal paths; arbitrary JavaScript or untrusted external destinations are rejected.
- Active-window queries require `status = ACTIVE`, `startsAt <= now`, and either no `endsAt` or `endsAt > now`.
- Assets use MartHub-owned Cloudinary media. Reference-brand text, logos, products, and imagery are not valid content.
- A promotion has at most the single image association represented by imagePublicId and imageUrl. Registration verifies a promotion-scoped signed upload and authoritative provider metadata. Explicit replacement/removal records durable generalized cleanup for the old asset. Archiving retains the association and does not enqueue cleanup.

Indexes: `(placement, status, startsAt, endsAt)`; `(status, sortOrder)`; unique `imagePublicId` when present.

### AdminAuditLog

Fields: `id`, `actorUserId`, `action`, `entityType`, `entityId`, `requestId`, `beforeJson`, `afterJson`, `createdAt`.

- Logs cover admin mutations to users, categories, products, media, prices, inventory, promotions, and orders.
- Sensitive values such as password hashes, tokens, cookies, and complete secrets are never stored.
- Audit rows are append-only and do not cascade-delete with the affected entity.

Indexes: `(actorUserId, createdAt DESC)`; `(entityType, entityId, createdAt DESC)`; `requestId`.

## Relationship summary

- User `1:N` RefreshSession, Address, Order, InventoryMovement actor records, OrderStatusHistory actor records, and AdminAuditLog actor records.
- User `1:1` active Cart and `1:1` Wishlist.
- Category `1:N` child Category and Product.
- Product `1:N` ProductImage, ProductPriceHistory, InventoryMovement, CartItem, WishlistItem, and OrderItem; Product `1:1` Inventory.
- Cart `1:N` CartItem; Wishlist `1:N` WishlistItem.
- Order `1:N` OrderItem, OrderStatusHistory, and order-linked InventoryMovement.

## Deletion and archival policy

- Refresh sessions may be deleted after a documented retention window once expired or revoked.
- Cart items and obsolete empty carts may be cleaned up after a retention window.
- Users, addresses, categories, products, and promotions use status or `archivedAt` for normal removal.
- Orders, order items, status history, inventory movements, price history, and admin audit logs are retained and not hard-deleted through product APIs.
- Cloudinary asset deletion is explicit. Product-image removal atomically deletes the association and creates a durable `MediaCleanup` row; only then may the provider call run. Pending or failed rows prove that provider deletion has not succeeded, survive process restart, and are retried by the bounded cleanup command. Completed rows and provider `not found` results make repeated cleanup safe.
- Promotion-media removal or replacement atomically changes the association and creates an explicitly owned durable cleanup row before provider deletion. Promotion archive retains media.

## Checkout transaction and concurrency

Checkout uses a client-generated UUID in the `Idempotency-Key` header. The backend derives a stable request fingerprint from the selected address/input and current cart identity.

Within one PostgreSQL transaction, the service:

1. Looks up `(userId, idempotencyKey)`. It returns the existing order for the same fingerprint and rejects a mismatched fingerprint.
2. Loads the active cart and items, then resolves active products and current price intervals.
3. Locks inventory rows in stable product-ID order with `SELECT ... FOR UPDATE`, or performs equivalent conditional updates whose affected-row counts are verified.
4. Rejects unavailable products, invalid quantities, missing prices, or insufficient stock.
5. Calculates all totals on the server using `BigInt` arithmetic.
6. Creates the order and immutable order items, address snapshot, initial status history, inventory movements, and inventory decrements.
7. Clears items and marks the cart checked out.
8. Commits all changes together. Any failure rolls back the entire operation.

The unique checkout key handles double-clicks and network retries. Row locking or atomic conditional decrement prevents overselling across different customers. External Cloudinary calls are never made inside the checkout transaction.

## Order transitions and stock restoration

Allowed transitions are:

- `PENDING -> CONFIRMED` or `CANCELLED`
- `CONFIRMED -> PACKING` or `CANCELLED`
- `PACKING -> SHIPPING` or admin-initiated `CANCELLED` with a reason
- `SHIPPING -> DELIVERED`
- `DELIVERED` and `CANCELLED` are terminal

Customers may cancel only `PENDING` or `CONFIRMED` orders. Admins may cancel through `PACKING`. Cancellation locks the order and relevant inventory rows, validates the transition, restores each order quantity, inserts one `ORDER_CANCEL_RESTORE` movement per product, inserts status history, and updates the order in one transaction. The unique inventory movement key and terminal state make restoration exactly once.

## My Items and reorder queries

My Items derives purchased products from `DELIVERED` orders rather than duplicating them in another table. Results group by product, expose the most recent purchase date and purchase count, and join current product, price, image, and inventory state. Archived or out-of-stock products remain visible as unavailable.

Reordering an order reads its snapshots for identification but adds current products at current prices and availability. It returns per-item `added` and `skipped` outcomes; it never silently substitutes or restore historical prices.

## Prisma and migration notes

Prisma schema constraints should be used where supported. PostgreSQL-specific partial unique indexes, check constraints, exclusion constraints, and full-text or trigram indexes belong in reviewed SQL migrations because Prisma may not express all of them directly.

Production migrations follow expand-and-contract: add compatible structures, deploy code that can use them, backfill and reconcile if needed, then remove obsolete structures in a later release. Runtime database credentials receive only application DML privileges; migration credentials are separate and are never used by the running API.
