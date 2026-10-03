# MartHub Architecture

**Status:** Approved baseline  
**Approved:** 2026-09-12  
**Scope:** Portfolio-quality single-vendor e-commerce MVP

This document defines MartHub's system boundaries and the architectural decisions that implementation must preserve. The roadmap and delivery status live in [PLAN.md](PLAN.md). Detailed data constraints, endpoint contracts, and interaction specifications live in [DATABASE.md](DATABASE.md), [API.md](API.md), and [UX.md](UX.md).

## Architecture Goals

- Deliver a credible, secure e-commerce experience without operational complexity that the MVP does not need.
- Keep frontend and backend independently testable while presenting a same-origin browser experience.
- Make price, stock, checkout, and order state authoritative on the server.
- Keep domain boundaries explicit enough to support future extraction without adopting microservices prematurely.
- Optimize public catalog pages for discoverability and performance, and authenticated workflows for clear feedback and recovery.
- Use JavaScript throughout application and shared contract code. Do not introduce TypeScript.

## System Context

```text
Customer/Admin browser
        |
        | HTTPS, same origin
        v
Next.js web application
        |
        | /api/v1/* rewrite/proxy
        v
Express REST API
   |              |
   | Prisma       | signed media operations
   v              v
PostgreSQL     Cloudinary
```

The Next.js application renders the storefront, account area, and admin interface. It never connects directly to PostgreSQL or Cloudinary's privileged APIs. Express is the sole application security boundary and owns authentication, authorization, validation, pricing, stock, checkout, and order transitions.

PostgreSQL is the source of truth for commercial and identity data. Cloudinary stores media binaries; MartHub stores stable media identifiers and delivery metadata in PostgreSQL. A media upload succeeding does not by itself make a product image part of the catalog.

## Target Repository Layout

The target is an npm-workspaces repository:

```text
MartHub/
|-- apps/
|   |-- web/                 # Next.js App Router, React, Tailwind CSS
|   `-- api/                 # Express REST API and Prisma integration
|-- packages/
|   `-- contracts/           # Shared JavaScript schemas and constants
|-- docs/                    # Plan and architecture specifications
|-- AGENTS.md                # Repository workflow and continuation rules
`-- package.json             # Workspace commands and supported runtime
```

Workspaces share development tooling and contracts, but each application owns its runtime configuration and dependency boundary. `packages/contracts` contains runtime-safe JavaScript artifacts such as Zod schemas, enum-like constants, pagination conventions, and serializable DTO rules. It must not import server-only code, Prisma clients, browser globals, or framework internals.

## Backend Architecture

The API is a modular monolith. Modules expose routes through `/api/v1`, keep business rules in services, and isolate persistence in repositories or narrowly scoped Prisma queries. Controllers translate HTTP concerns; they do not contain checkout, authorization, inventory, or state-transition logic.

Target modules:

| Module          | Responsibility                                                                           |
| --------------- | ---------------------------------------------------------------------------------------- |
| `auth`          | Registration, login, access-token issuance, refresh rotation, logout, session revocation |
| `users`         | Profile, role-aware user access, customer account operations                             |
| `addresses`     | Customer-owned addresses and default delivery address                                    |
| `catalog`       | Categories, products, prices, images, public search/filter/sort                          |
| `promotions`    | Scheduled homepage merchandising placements                                              |
| `inventory`     | Stock availability, adjustments, movement history                                        |
| `cart`          | Active cart, item quantity, availability reconciliation                                  |
| `wishlist`      | Customer wishlist membership                                                             |
| `checkout`      | Server-priced COD order creation and idempotency                                         |
| `orders`        | Customer history, cancellation, status timeline, reorder data                            |
| `admin`         | Admin-only orchestration, user/catalog/order operations, statistics                      |
| `media`         | Cloudinary signatures/uploads/deletions behind an adapter                                |
| `observability` | Request IDs, structured logging, health/readiness endpoints                              |

Cross-cutting middleware handles request IDs, secure headers, CORS/origin policy, authentication, role checks, validation, rate limits, and normalized errors. Route-level role checks are necessary but not sufficient: services must also enforce ownership and legal domain transitions.

Checkout and inventory mutations execute in PostgreSQL transactions. The detailed locking, idempotency, stock restoration, and immutable snapshot rules are defined in [DATABASE.md](DATABASE.md).

## Frontend Architecture

The web application uses the Next.js App Router. Route groups separate public commerce, authenticated account, authentication, and admin concerns without changing public URL semantics.

Target route areas:

```text
app/
|-- (store)/                 # Homepage, categories, search, product detail
|-- (auth)/                  # Login and registration
|-- account/                 # Profile, addresses, My Items, orders
|-- cart/
|-- checkout/
`-- admin/                   # Protected operational interface
```

Server Components are the default for public catalog discovery, metadata, and the initial read-only render. Client Components are used at explicit interaction boundaries such as search suggestions, filters, carousels, cart controls, wishlist controls, forms, and admin mutations.

Frontend responsibilities are divided as follows:

- Next.js layouts own navigation shell, route composition, metadata, and loading/error boundaries.
- Feature folders own route-specific components and API hooks.
- Shared UI primitives own accessible interaction and stable responsive dimensions, not domain rules.
- TanStack Query owns authenticated server state, invalidation, and optimistic mutations with rollback.
- React Hook Form plus shared Zod schemas owns form state and client-side feedback.
- URL search parameters are the durable state for catalog query, filters, sorting, and pagination.

The browser treats API responses as authoritative. Optimistic cart and wishlist feedback must reconcile with server results. Prices, checkout totals, roles, availability, delivery eligibility, and order transitions are never derived as trusted client state.

The detailed page map, responsive behavior, product-card contract, homepage modules, and My Items states are specified in [UX.md](UX.md).

## Same-Origin API Boundary

The browser calls `/api/v1/*` on the MartHub origin. The deployment layer or Next.js rewrite forwards these requests to Express while preserving the path, request ID, method, headers required by the contract, and secure cookie behavior.

This boundary provides:

- a single public origin for web and API traffic;
- simpler secure refresh-cookie semantics;
- a narrow production CORS policy;
- freedom to deploy web and API as separate processes behind one edge entry point.

Express remains the API owner. Next.js route handlers must not duplicate domain endpoints, mint tokens, access Prisma, or become an alternative backend. Development configuration must reproduce the `/api/v1` browser contract even when the two processes use different local ports.

## Authentication and Data Flow

### Session flow

1. The browser submits credentials to the Express auth API through the same-origin path.
2. Express verifies the password and creates a server-tracked refresh session.
3. Express returns a short-lived JWT access token and sets an opaque refresh token in an `HttpOnly`, `Secure`, `SameSite=Lax` cookie.
4. The web application keeps the access token in memory and sends it as a bearer token. It does not persist access or refresh tokens in browser storage.
5. Refresh rotates the opaque token. Replay detection revokes the affected token family.
6. Express validates role and resource ownership for every protected operation.

JWT claims stay minimal and contain no sensitive profile, address, cart, or commercial data. Password hashing, token lifetimes, cookie attributes, origin checks, and auth rate limits are detailed in [API.md](API.md).

### Commerce read flow

Public pages request a server-shaped view from the catalog or homepage API. The API joins only the data needed for that view and serializes monetary values using the contract defined in [DATABASE.md](DATABASE.md). Next.js may cache public reads according to their freshness requirements; authenticated account, cart, stock-sensitive, and admin data must not leak through shared caches.

### Commerce mutation flow

The browser sends intent, such as a product identifier and desired quantity. Express validates the request, reloads authoritative product/price/stock data, applies domain rules, commits the mutation, and returns the reconciled representation. Checkout additionally requires an idempotency key and completes order creation, inventory mutation, history creation, and cart clearing atomically.

## Cloudinary Boundary

Cloudinary is accessed only through the API's `media` adapter for privileged actions. Admin authorization is required before generating a signed upload or changing product-media associations.

The boundary must:

- validate supported media type, byte size, and catalog ownership;
- store Cloudinary `publicId`, delivery URL, dimensions, ordering, and alt-text metadata;
- distinguish uploaded media from media attached to a product;
- make deletion/archive behavior explicit so failed multi-system operations can be retried safely;
- use responsive delivery transformations while retaining a stable source asset.

Cloudinary credentials remain server-side environment secrets. The browser never receives an API secret or unrestricted upload capability.
Product image upload contracts allow JPEG, PNG, and WebP source files up to 4 MB, bind the upload to the product-specific MartHub folder, and expire after five minutes. The API assigns the product-scoped public ID and persists a cleanup intent when signing. Registration revalidates the signed contract, atomically consumes that intent, and reads authoritative resource metadata through the adapter before attaching the asset; abandoned uploads remain recoverable after expiry. Public image URLs use Cloudinary automatic format/quality and bounded-width delivery transformations while the provider retains the stable source asset.

Removal commits the product-image association change and a durable PostgreSQL `MediaCleanup` task in one transaction before calling Cloudinary. Provider success or an already-missing asset completes the task. Provider failures retain pending or failed state without claiming provider deletion; a database-driven cleanup command applies at most five attempts per retry cycle and can be rerun after process restarts. This MVP uses no in-memory queue, Redis, or external broker.

Promotion uploads use the same boundary and policy under a promotion-specific folder. The generalized PostgreSQL cleanup record has one constrained owner type for either ProductImage or Promotion media. Promotion replacement/removal uses that durable worker; promotion archive retains media and creates no cleanup task.

## Deployment and Runtime Model

MartHub runs as two stateless Node.js processes plus managed PostgreSQL and Cloudinary:

- `web`: Next.js production server;
- `api`: Express server with one Prisma client per process;
- `database`: PostgreSQL with migrations executed as an explicit release step;
- `edge/reverse proxy`: TLS termination and same-origin routing.

Horizontal scaling must not depend on in-memory sessions, carts, rate-limit truth, or job state. The MVP may begin with a single API instance, but refresh sessions, checkout idempotency, inventory, and order state live in PostgreSQL from the outset.

Runtime configuration is validated at process startup. Production separates migration credentials from least-privilege application credentials where the hosting platform permits it. Secrets are injected through environment configuration and never committed. Deployments run schema migration before exposing code that depends on it and include a rollback/recovery procedure in the production-readiness milestone.

## Observability and Operations

The API emits structured logs with a request ID propagated through web-to-API calls. Logs include route, method, status, latency, authenticated subject ID when appropriate, and stable error code. Passwords, tokens, cookies, secrets, and full address data are redacted.

Required operational surfaces:

- liveness endpoint for process health;
- readiness endpoint that verifies required dependencies without exposing credentials;
- centralized normalized error responses with request IDs;
- audit records for admin mutations;
- security-relevant events for login throttling, refresh reuse, and denied admin access;
- metrics or deploy-platform telemetry for request rate, latency, error rate, checkout failures, and database health.

Observability must not change customer-visible outcomes. A logging or metrics failure must not partially commit checkout or inventory work.

Generalized Admin audit is part of the mutation consistency boundary rather than best-effort observability: each committed database command and its single allowlisted audit record share one PostgreSQL transaction. Request/security logs cover rejected attempts and operational failures. `MediaCleanup` continues to own post-commit Cloudinary retry outcomes; background cleanup attempts do not create generalized Admin audit events.

## Approved Decision Log

These entries summarize the approved architecture baseline in lightweight ADR form. They are accepted as of 2026-09-12. If a decision changes, record its replacement and update the affected specialist document before implementation proceeds.

### AD-001: Modular monolith and npm workspaces

**Context:** The portfolio needs real frontend/backend separation and strong domain boundaries without microservice deployment overhead.  
**Decision:** Use npm workspaces with separate Next.js and Express applications, a shared JavaScript contracts package, and a modular Express monolith.  
**Alternatives considered:** A single Next.js full-stack application would conflict with the required Express boundary; microservices would add operational cost without MVP scale requirements.  
**Consequences:** Modules can evolve independently, but cross-module ownership and dependency direction must be enforced in code review.

### AD-002: JavaScript-only application code

**Context:** JavaScript is an explicit product constraint.  
**Decision:** Use JavaScript for Next.js, Express, Prisma integration, configuration, tests, and shared contracts.  
**Alternatives considered:** TypeScript provides compile-time checks but is outside the approved stack.  
**Consequences:** Runtime schemas, focused tests, linting, and clear module contracts carry more correctness responsibility.

### AD-003: Same-origin REST API under `/api/v1`

**Context:** The web and API remain separate applications while refresh cookies need predictable browser behavior.  
**Decision:** Present Express through the web origin at `/api/v1` using a rewrite or reverse proxy.  
**Alternatives considered:** Cross-origin browser calls add CORS and cookie complexity; Next.js route handlers would create a second backend boundary.  
**Consequences:** Deployment requires correct proxy configuration, while browser security policy and local-to-production parity become simpler.

### AD-004: PostgreSQL and Prisma as commercial source of truth

**Context:** Orders, money, inventory, idempotency, and relationships require transactions and constraints.  
**Decision:** Use PostgreSQL with Prisma ORM; use integer minor units for VND and never floating point.  
**Alternatives considered:** Document databases weaken relational guarantees for this domain; floating-point money risks rounding errors.  
**Consequences:** Schema migrations and transaction design are release-critical. See [DATABASE.md](DATABASE.md).

### AD-005: Single vendor, single warehouse, one product per SKU

**Context:** Seller settlement, multi-location allocation, and variants would materially expand the MVP.  
**Decision:** Model one MartHub-operated catalog, one inventory location, and one directly sellable SKU per Product.  
**Alternatives considered:** Marketplace, multi-warehouse, and variant matrices are deferred because they require new domain and operational workflows.  
**Consequences:** Catalog and checkout stay focused; future expansion will require explicit schema and UX decisions rather than hidden assumptions.

### AD-006: Authenticated cart and wishlist

**Context:** The approved guest scope covers discovery and authentication, while persistent shopping state belongs to customer accounts.  
**Decision:** Require authentication for cart and wishlist mutations and storage.  
**Alternatives considered:** Guest carts need anonymous identity, merge rules, and additional security/expiry behavior.  
**Consequences:** Protected-action prompts must preserve the customer's intended return location.

### AD-007: Short-lived access JWT and rotating opaque refresh session

**Context:** The application needs stateless API authorization with revocable long-lived sessions.  
**Decision:** Keep access JWTs short-lived and in memory; store an opaque refresh token in a secure cookie and rotate it against a hashed server-side session record.  
**Alternatives considered:** Browser-storage tokens increase theft exposure; fully stateless refresh JWTs make revocation and reuse detection weaker.  
**Consequences:** Refresh endpoints require cookie/origin protection and transactional rotation semantics.

### AD-008: COD checkout reserves stock at order creation

**Context:** The MVP supports COD and must prevent overselling and duplicate orders.  
**Decision:** Reprice and validate the cart on the server, atomically decrement stock when creating the order, require idempotency, and restore stock exactly once on a legal cancellation.  
**Alternatives considered:** Reserving only after admin confirmation can oversell; trusting frontend totals violates the security boundary.  
**Consequences:** Checkout and cancellation are concurrency-sensitive database transactions with dedicated integration tests.

### AD-009: Fixed shipping policy with configurable free-shipping threshold

**Context:** A realistic total is needed without integrating carrier quotation systems.  
**Decision:** Compute shipping on the backend from a configured fixed fee and free-shipping threshold. The approved policy is 30,000 VND, waived at merchandise subtotal >= 500,000 VND using current selling prices before shipping. All active valid Customer-owned addresses are eligible without geographic restrictions in the MVP. Monetary accounting and quote validity are owned by DATABASE.md; configuration and the quote contract are owned by API.md.
**Alternatives considered:** Carrier APIs and zone matrices are outside MVP scope; frontend calculation is not authoritative.  
**Consequences:** The policy remains simple and testable but does not represent live carrier pricing.

### AD-010: Minimal promotion model

**Context:** The reference-informed homepage needs scheduled merchandising without hard-coded content or a page-builder project.  
**Decision:** Store a small set of typed promotion placements with schedule, order, internal destination, and Cloudinary media.  
**Alternatives considered:** Hard-coding blocks admin ownership; a flexible CMS/page builder is disproportionate to the MVP.  
**Consequences:** Homepage composition is controlled and extensible only through approved placement types.

### AD-011: Delivery context does not drive inventory

**Context:** The header benefits from a delivery location cue, but the approved inventory model has one warehouse.  
**Decision:** Use delivery context for selected/default address, eligibility, and shipping policy only; do not imply location-specific stock or delivery promises without supporting data.  
**Alternatives considered:** Per-location inventory contradicts the single-warehouse decision.  
**Consequences:** UI copy must remain honest about availability and delivery estimates.

### AD-012: My Items unifies reorder discovery and wishlist

**Context:** Separate My Items and Wishlist interfaces would duplicate account shopping navigation.  
**Decision:** Use `/account/my-items` with `reorder` and `wishlist` tabs; keep order history separate and allow any legacy `/wishlist` route to redirect to the wishlist tab.  
**Alternatives considered:** Separate surfaces increase navigation and component duplication.  
**Consequences:** My Items requires explicit empty, populated, unavailable, and recommendation-fallback states. See [UX.md](UX.md).

### AD-013: Light theme for MVP

**Context:** A second color theme expands visual QA and accessibility work without adding core commerce capability.  
**Decision:** Deliver one accessible MartHub light theme for the MVP.  
**Alternatives considered:** Dark mode is useful but not required for the approved portfolio scope.  
**Consequences:** Design tokens should remain theme-ready, but no dark-mode behavior is accepted implicitly.

## Deliberate Exclusions

The approved MVP does not include:

- marketplace sellers, commissions, payouts, or seller administration;
- multiple warehouses or location-specific stock allocation;
- product variants such as size/color matrices;
- guest cart or guest wishlist persistence;
- product ratings and reviews;
- coupons, loyalty, memberships, or paid service programs;
- online payment gateways;
- returns, refunds, or exchanges;
- carrier-rate integrations or guaranteed delivery-time promises;
- automated recommendation engines; recommendations are transparent rule-based fallbacks;
- a general-purpose CMS or drag-and-drop homepage builder;
- dark mode.

These exclusions are architectural boundaries, not placeholders to implement opportunistically. Adding one requires a reviewed plan change, acceptance criteria, and updates to the affected architecture documents.

## Change Governance

[PLAN.md](PLAN.md) is the source of truth for task order, status, dependencies, acceptance criteria, test requirements, and Definition of Done. This document changes only when an approved task changes a system boundary or an accepted decision. Implementation must not silently diverge from an accepted decision; record the rationale, alternatives, consequences, and affected documents before proceeding.
