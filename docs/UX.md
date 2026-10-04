# MartHub UX and Interface Specification

## Purpose

This document defines MartHub's information architecture, reusable commerce patterns, responsive behavior, and interface quality gates. Milestone ownership, task status, dependencies, acceptance criteria, and test requirements remain authoritative in [`PLAN.md`](./PLAN.md).

The visual references are:

- [`homepage-reference.png`](./references/homepage-reference.png), a long desktop commerce homepage reference.
- [`my-items-reference.png`](./references/my-items-reference.png), a desktop account-shopping reference focused on reorder.

They are used only to study information architecture, content density, and interaction patterns. MartHub must not reproduce Walmart's name, logo, color system, copy, product photography, membership programs, proprietary services, or other brand assets.

## Product Experience Principles

1. Search is the primary global action; category navigation, account actions, and cart remain immediately available.
2. Shopping pages favor scanability and repeated actions over decorative presentation.
3. Homepage content alternates product-led and editorial modules so the page does not become a uniform wall of cards.
4. Price, availability, fulfillment, and personalization claims appear only when supported by current backend data.
5. The same product has a consistent card anatomy across discovery, search, wishlist, and reorder contexts.
6. Account shopping features reduce the work required to buy again without obscuring order history.
7. The MVP uses a MartHub-specific light visual system. A theme toggle and dark theme are outside the approved MVP scope.

## Reference Pattern Extraction

### Homepage Reference

The reference establishes a dense but orderly desktop rhythm:

```text
Two-tier global header
-> asymmetric promotional mosaic
-> product rail
-> category shortcuts
-> editorial promotion
-> product rail
-> seasonal or thematic modules
-> utility-rich footer
```

Patterns to adapt:

- The search field occupies the visual center of the main header and is wider than surrounding utilities.
- Departments, account shopping, account identity, and cart are persistent top-level destinations.
- Delivery or location context is visible near the commercial navigation.
- The first promotional region combines one dominant story with smaller secondary stories instead of presenting a generic full-height hero.
- Product rails place several comparable products in one scan line; desktop navigation controls are explicit and mobile overflow is horizontal.
- Individual product items rely primarily on spacing and alignment, not a bordered card around every item.
- Category shortcuts and editorial promotions interrupt product rails to improve orientation and merchandising rhythm.
- Recommendation labels communicate their source or intent, such as popular, recent, or selected for the customer.
- The footer is a full information layer, not only a copyright line.

Patterns not to carry into MartHub:

- Reference-specific membership, healthcare, registry, corporate-program, or brand-value modules.
- Its brand palette, copywriting, iconography, imagery, product data, or promotional campaigns.
- Any implied delivery promise that MartHub cannot calculate.

### My Items Reference

The supplied image shows an empty Reorder view rather than a populated purchase-history grid. Its hierarchy is:

```text
Account header context
-> page title
-> compact tab navigation
-> restrained empty state
-> recommendation rail as recovery path
```

Patterns to adapt:

- Reorder is an account-shopping workspace, separate from order-history administration.
- Tabs switch between closely related shopping collections without forcing separate mental models.
- An empty state is concise; recommendations keep the page useful without pretending the user has purchase history.
- Recommended cards retain quick Add to Cart behavior.

The populated Reorder design below is a MartHub extension derived from product requirements, not a copied state from the reference.

## Information Architecture

### Public Routes

| Route | Purpose |
| --- | --- |
| `/` | Homepage discovery and merchandising |
| `/categories` | Browse all departments and categories |
| `/category/[slug]` | Category product listing |
| `/search?q=` | Search results with filters and sorting |
| `/products/[slug]` | Product detail |
| `/login` | Customer and admin sign-in entry |
| `/register` | Customer account creation |

### Customer Routes

| Route | Purpose |
| --- | --- |
| `/account` | Account overview and shortcuts |
| `/account/profile` | Personal information |
| `/account/addresses` | Delivery addresses and default address |
| `/account/orders` | Order history |
| `/account/orders/[orderNumber]` | Order detail, tracking, cancellation, and whole-order reorder |
| `/account/my-items?tab=reorder` | Previously purchased product aggregation |
| `/account/my-items?tab=wishlist` | Saved products |
| `/wishlist` | Redirect to the My Items wishlist tab |
| `/cart` | Cart review and quantity management |
| `/checkout` | Address selection and COD order review |
| `/checkout/success/[orderNumber]` | Confirmed submission result |

### Admin Routes

| Route | Purpose |
| --- | --- |
| `/admin` | Operational dashboard |
| `/admin/users` | User management |
| `/admin/users/[userId]` | Safe user identity/status and permitted status actions |
| `/admin/categories` | Category management |
| `/admin/products` | Product, price, and image management |
| `/admin/inventory` | Stock levels and inventory movements |
| `/admin/promotions` | Homepage promotional content |
| `/admin/orders` | Order queue and status operations |
| `/admin/orders/[orderId]` | Immutable order detail and complete operational history |

Admin pages use a compact application shell and tables/forms optimized for repetitive operational work. They do not reuse the homepage merchandising composition.

M8.3 user list URL owns q/role/status/sort/page/perPage; defaults newest/1/20 and absent filters are omitted. Search/filter/sort/page-size changes reset page; pagination preserves filters; refresh/share/back-forward restores URL state. List links to canonical userId detail; browser history returns to the prior queue. Invalid query state offers reset. Narrow screens use stacked rows. Detail shows only API-approved identity/status timestamps. SUSPENDED is labeled Disabled, mapping the existing enum. Status actions follow the DATABASE matrix; destructive disable/archive requires confirmation and a required reason. Reactivation has no reason. Self-management shows explicit forbidden feedback, server last-Admin rejection is actionable, and pending actions prevent duplicate submission. Success replaces detail with authoritative data; stale conflict states currentStatus and offers refresh/retry. Loading/empty/error/retry/accessibility behavior follows the global contract. Role changes, commerce/address browsing, counts, audit-history UI and statistics are absent.

M8.1 order queue state is URL-owned through `q`, `status`, `sort`, `page`, and `perPage`. Defaults are omitted from the canonical URL (`q` and `status` absent, `sort=newest`, `page=1`, `perPage=20`). Changing search, status, sort, or page size resets page to 1; changing page preserves the other options. Refresh, shared links, and browser back/forward restore the queue from the URL. Invalid URL options show a recoverable reset state rather than silently changing meaning. Selecting an order navigates to `/admin/orders/[orderId]`; ordinary browser history returns to the prior queue URL without custom persisted filter state. On narrow screens, queue rows use an operable card/stacked alternative instead of forcing an unreadable table. Loading, empty, error/retry, populated, filter, and pagination states follow the global interaction and accessibility contract. M8.1 detail is read-only; transition controls and statistics are not introduced.

### M8.5 Admin statistics dashboard

The canonical dashboard is `/admin` inside the existing protected Admin shell. It consumes only the three M8.4 statistics APIs; KPI definitions and historical/current populations remain owned by API.md and DATABASE.md. No charts, new drill-down, stock adjustments or backend statistics are added.

Range controls offer Last 7 days, Last 30 days (default), Last 90 days and Custom. Relative ranges include backend-authoritative today and the preceding 6/29/89 days, never browser-clock business dates. The default statistics response supplies the authoritative calendar anchor; a default top-products response can supply it when overview fails. Presets apply immediately. Custom dates are labeled required calendar inputs with local draft state; only Apply changes the applied URL. Validate paired real dates, order, maximum 366 inclusive days and future dates when the backend anchor is available; backend validation remains authoritative. Reset applies Last 30 days.

URL state uses only `range`, `from`, `to`: `/admin` is default 30d, `?range=7d` and `?range=90d` select presets, and `?range=custom&from=YYYY-MM-DD&to=YYYY-MM-DD` selects custom. Defaults are omitted. Refresh/share/back-forward restore applied state naturally without custom persistence. Invalid range or invalid/missing custom dates recover to the canonical default URL with visible recovery feedback, including backend-rejected ranges. Draft inputs do not alter the URL.

Display the selected calendar range and `Asia/Ho_Chi_Minh`. Overview and top-products request the same applied dates/timezone; explicit dates derived from the default response avoid independent default-range rollover. Low-stock is independent of range, uses fixed threshold 5/limit 10 and reuses its query cache during range changes. Top-products uses fixed limit 10. Settings are not editable.

Overview presents Revenue, Delivered orders, Units sold and Created orders cards plus every current status count (PENDING, CONFIRMED, PACKING, SHIPPING, DELIVERED, CANCELLED). Explain deliveredAt-based delivered sales (immutable total including shipping/discount) versus createdAt-based created orders/current-status counts. Zero is a value, not missing data. Format exact VND using the existing BigInt-compatible formatter and exact aggregate counts without Number conversion.

Top-products is a read-only ranked table/list using only returned immutable product identity/image/selling-unit fields, soldQuantity and revenue in API order. Low-stock is a read-only current operational table/list with name, SKU, quantity, current price and availability; show the applied threshold and label zero explicitly OUT_OF_STOCK. Show returned full population counts separately from the maximum ten rows. Never substitute current catalog identity for historical sales.

Each of overview/top-products/low-stock has its own layout-matched loading, error and retry. One failed or pending section does not block others. Retain previous dated data only when safely associated with its range and explicitly pending; mismatched previous data must not appear as a final synchronized result. Replace successful data with authoritative responses, and retry only the failed section. Empty top-products and no low-stock products have explicit messages; partial empty is valid and all zero overview/status values stay visible.

Use native keyboard-operable presets with pressed state, semantic section headings/lists, labeled custom date inputs, connected validation feedback, visible focus and the global accessibility baseline. Narrow rows stack rather than widening the page; verify keyboard, axe and no horizontal page overflow at 360/768/1024/1440. No page-level loading/error replaces otherwise usable sections.

M8.5 verification on 2026-10-04: approved dashboard controls, zero/empty/partial/error/loading states and natural URL/history behavior pass component and browser coverage. Dashboard and existing Admin navigation pass keyboard activation, axe WCAG A/AA and no page overflow at 360/768/1024/1440. State screenshots are saved in ignored test-results; desktop/mobile populated screenshots were visually inspected. Detailed check counts and completion evidence are owned by PLAN.md.

## Global Header and Navigation

### Desktop: Two Tiers

The primary row contains, in order:

1. MartHub wordmark linking home.
2. Departments trigger opening a categorized menu.
3. Large search form with visible label or accessible name, query input, and search icon button.
4. My Items shortcut.
5. Account entry showing a neutral signed-out label or the authenticated customer's name.
6. Cart control with item-count badge and VND subtotal when space permits.

The secondary row contains:

- Delivery context: `Chọn khu vực giao hàng` for guests, or a shortened default-address area for signed-in customers.
- Deals, Categories, New Products, Popular Products, and only other destinations backed by real content.

Delivery context may affect shipping eligibility or configured shipping fees. Under the approved single-warehouse model it does not imply location-specific inventory. No exact delivery date is shown unless calculated by the backend.

### Tablet and Mobile

- Preserve logo, account, and cart in the top row; move search to a dedicated full-width row.
- Replace the desktop departments menu and secondary navigation with one accessible navigation drawer.
- Keep delivery context visible as a compact row below search rather than hiding it in account settings.
- Keep cart count stable in width as values change.
- Search submission, navigation drawer, account menu, and cart must be usable with keyboard and touch.

Sticky behavior is allowed only when it does not consume excessive mobile viewport height. Search and purchase actions take precedence over secondary promotional navigation.

## Homepage Composition

Homepage modules follow this order:

1. Two-tier header and search.
2. MartHub promotional mosaic with one primary and up to two secondary promotions.
3. Featured category shortcuts.
4. Deals product rail.
5. Signed-in Reorder rail; guests and customers without delivered purchases receive an accurately labeled popular-products fallback.
6. Seasonal editorial promotion band.
7. New Products rail.
8. Popular Products rail.
9. At most one trust or service band, shown only for policies MartHub actually offers.
10. Full footer.

Module rules:

- Promotions come from the approved minimal Promotion model; the frontend does not hard-code campaign content.
- A promo tile has a heading, optional supporting copy, one clear destination, owned or licensed bitmap media, and readable text contrast.
- Primary imagery shows relevant products or shopping occasions instead of purely atmospheric decoration.
- Rails do not autoplay. Desktop uses visible previous/next icon controls with tooltips and disabled states. Mobile uses horizontal scroll with snap while retaining natural touch scrolling.
- Section headings describe the actual dataset. A popular fallback must not be labeled personalized.
- Empty datasets remove the module cleanly; they do not leave an empty framed section.
- Footer groups customer help, shopping information, account links, and legal information with a clear mobile accordion or stacked treatment.

## Product Card Contract

Every product card uses a stable media area and reserves space for variable content so a rail does not shift when price or loading state changes.

Information priority:

1. Optional `Sale` or `New` badge supported by catalog data.
2. Wishlist icon button at the media corner.
3. Product image with fixed aspect ratio and meaningful alternative text.
4. Quick Add to Cart action.
5. Current price in VND and optional compare-at price.
6. Optional selling-unit information.
7. Product name clamped to two lines.
8. Current availability or fulfillment metadata when reliable.

Behavior and states:

- The product name and image link to product detail; the whole card must not become an ambiguous nested interactive target.
- Quick Add immediately adds a simple in-stock SKU, shows a pending state, prevents duplicate submission, and confirms success without changing card dimensions.
- Out-of-stock, archived, or otherwise unavailable products replace Add with a clear unavailable state.
- An API failure restores the prior state and presents an actionable retry message.
- Wishlist toggles expose pressed state and require authentication. After login, the customer returns to the prior page.
- Compare-at price appears only when greater than current price. Discount presentation does not fabricate savings.
- Rating UI is omitted in MVP because ratings are outside scope.
- Options/variant controls are omitted because each MVP Product is one sellable SKU.
- Skeletons match the final card footprint and do not announce decorative repetition to assistive technology.

Context may change card width or supporting metadata, but not the core anatomy. Search/listing grids may include more fulfillment detail; Reorder may include last-purchased information below the core card.

## My Items and Reorder

The canonical workspace is `/account/my-items` with two tabs: `Mua lại` and `Yêu thích`. Tabs are links or a correctly implemented tab pattern, preserve deep linking through the query string, and expose the active state programmatically.

### Empty Reorder

- Show a restrained MartHub-owned icon or illustration, one clear title, and a short explanation that delivered purchases will appear here.
- Do not show misleading reorder actions.
- Follow with `Sản phẩm phổ biến` or another label matching the fallback data source.
- If recommendations also fail or are empty, show a simple category-browsing link rather than an empty rail.

### Populated Reorder

- Include products only from the customer's `DELIVERED` orders.
- Deduplicate by current product identity and rank by purchase recency and frequency.
- Show last purchase date, purchase count when useful, current price, and current availability.
- Link purchase provenance to the relevant order detail.
- M7.5 provenance resolves the existing owned source orderId detail to its orderNumber, then links to canonical `/account/orders/[orderNumber]`. That destination uses the approved owned by-number lookup and shows immutable order/address/item money snapshots plus the complete redacted timeline; it never substitutes current catalog data. Failed provenance reads offer retry. Whole-order reorder reuses the existing partial-result API and refreshes the active cart.
- Owner-approved M7 milestone remediation: `/account/orders` is accessible from the account page and lists only the owned API safe summaries. URL state owns page (default 1), perPage (default 20, maximum 50), status and newest/oldest sort; filter/sort/page-size changes reset page to 1. Invalid options offer reset; loading, empty and failed reads have distinct states and retry. Every summary links to its canonical orderNumber detail.
- Order detail offers cancellation only for PENDING/CONFIRMED, with an explicit confirmation form and optional reason validated through the existing shared contract (trim, maximum 240 characters, blank becomes null). Pending submissions are locked. Success, including an already-CANCELLED no-op, refetches authoritative detail/history; failed or lost responses offer retry/refresh. The frontend never restores inventory, authors history or exposes internal actor identity. PACKING/SHIPPING/DELIVERED/CANCELLED have no Cancel order action.
- Reorder tabs default to `reorder` when tab is absent or unrecognized; Wishlist uses the existing `wishlist` link. Purchase sort (`recent`/`frequent`) and page are URL state, reset to page 1 when sorting, and use M7.3 pagination. Historical identity/count/date remain visible alongside current cards; unavailable entries have no current product link/price and disabled Add. Empty purchases reuse the existing homepage popular data, with category browsing on fallback failure/empty; no personalized recommendation rules are added.
- Quick Add uses current catalog price and current stock, never the historical order price.
- Archived or out-of-stock items remain recognizable but cannot be added; their status is explicit.
- Pagination or progressive loading preserves deterministic ordering and does not duplicate products.

### Reorder Versus Whole-Order Reorder

- My Items aggregates individual products across delivered orders and supports item-by-item Quick Add.
- Order Detail provides `Mua lại đơn này`, which attempts to add all eligible lines from one historical order.
- Whole-order reorder returns and displays separate `added` and `skipped` results. Reasons are UNAVAILABLE, OUT_OF_STOCK, or QUANTITY_LIMITED as defined in API.md. Positive stock permits the full historical quantity without stock capping; checkout performs the final stock validation.
- Reorder never silently substitutes a product, quantity, price, or unavailable line.

### Wishlist

- Uses the same ProductCard contract and current catalog state.
- Removing an item provides immediate feedback and a recoverable optimistic update when practical.
- An empty wishlist offers a direct route to categories or popular products without presenting purchase history.

## Listing, Product, Cart, and Checkout UX

- Category and search pages keep query, filters, sort, page, and other reproducible discovery state in the URL.
- Desktop filters may use a sidebar; tablet/mobile use a labeled filter drawer with applied-count indicator and clear-all action.
- Product detail prioritizes inspectable imagery, product identity, current price, stock, quantity, and Add to Cart. A mobile sticky purchase area must not cover content or system controls.
- Cart quantity changes announce result, preserve the last valid quantity after failure, and clearly separate removal from decrement.
- Checkout is a focused sequence: delivery address, item review, backend-derived totals, COD confirmation, and result. A pending submit prevents double-click but does not imply success before the API responds.
- Price changes or stock conflicts returned by checkout are shown at affected items and summarized before resubmission.
- The implemented checkout selects an owned saved address and renders the quote's exact item amounts, shipping, and totals without calculating them in the browser. An expired summary is refreshed for another review. The quote does not lock prices; order creation uses the current server prices, and the success summary displays the committed amounts. Stock/unavailable failures identify affected items and offer cart review and summary refresh.
- Checkout locks submission immediately and freezes its canonical intent and UUID key. Network, server, or unreadable-response failures retain that attempt in the existing auth-scoped in-memory query cache; retry sends the identical intent/key, even if the current cart or address read fails. A definitive rejection releases the attempt for correction. Successful creation/replay refreshes the active cart rather than clearing it from the browser, so a new cart is preserved.
- `/checkout/success/[orderNumber]` renders only the authenticated session's confirmed API result: order number, status, COD, immutable line amounts, and totals. Without that in-memory result (including after a full reload), it shows an unconfirmed-result recovery state, never fabricates success from the URL, and links to checkout. This submission result does not implement the later order-history/detail routes. Auth cache clearing removes checkout attempts and results alongside other Customer data.

## Responsive Rules

The references are desktop screenshots, so mobile and tablet behavior below is an approved MartHub derivation rather than a claim about the reference implementation.

| Viewport | Layout behavior |
| --- | --- |
| `360px+` | 16px page gutter; full-row search; drawer navigation and filters; horizontal product rails; stacked promo mosaic; cart totals and checkout actions remain visible without overlap |
| `768px+` | 24px gutter; two-column promotional composition where content permits; wider rails; account layouts may introduce a compact sidebar |
| `1024px+` | Full two-tier header; persistent departments and commercial navigation; product listing sidebar; three-part promotional mosaic |
| `1440px+` | Constrained content container with approximately 5-6 visible product cards per rail; space increases between modules, not through viewport-scaled typography |

Fixed-format elements use explicit responsive constraints: aspect ratios for imagery, minimum button hit areas, consistent card tracks, and reserved count/price space. Text never scales directly with viewport width and letter spacing remains zero.

## Interaction, State, and Feedback Contract

Every data-backed page or module defines:

- **Loading:** layout-matched skeletons for initial content; localized pending indicators for mutations.
- **Empty:** a concise explanation and one relevant recovery route; empty modules may be omitted when no user decision is required.
- **Error:** human-readable message, retained user input where safe, and retry for recoverable requests.
- **Success:** immediate confirmation near the initiating control; cart and wishlist counts synchronize globally.
- **Unavailable:** actions are disabled or replaced with a reason, while previously purchased or saved items remain identifiable.
- **Unauthorized:** protected actions route to login and preserve a safe return URL.

Loading, success, and error labels must not resize controls. Toasts supplement rather than replace field-level or item-level feedback for consequential actions.

## Accessibility Baseline

- Meet WCAG 2.1 AA contrast and interaction requirements across critical shopping flows.
- Use semantic landmarks, heading order, lists for product collections, and native controls wherever possible.
- All icon-only controls have accessible names and visible tooltips when the icon's function is not universally clear.
- Interactive targets are at least 44 by 44 CSS pixels on touch layouts.
- Visible focus indicators are not removed; focus order follows visual order.
- Drawers and dialogs trap focus, close with Escape, restore focus to their trigger, and prevent background interaction.
- Product rail controls have unique accessible names tied to their section. The rail remains operable without drag gestures.
- Price changes, cart quantity results, and reorder outcomes use appropriately scoped live regions.
- Images use purposeful alternative text; decorative promotion details use empty alt text when adjacent copy already conveys the destination.
- Motion respects `prefers-reduced-motion`; no commerce content depends on animation.
- Form errors connect to fields, are summarized when appropriate, and are never communicated by color alone.

## Visual Identity Guardrails

MartHub requires its own wordmark, voice, imagery, icons, and balanced multi-hue palette. The interface must not read as a recolored Walmart clone.

- Use a compact, work-focused commerce aesthetic with clear typography and restrained elevation.
- Cards use at most an 8px radius unless a later approved design token specifies less.
- Avoid a palette dominated by purple, purple-blue gradients, beige, dark slate-blue, or brown/orange.
- Avoid decorative gradient orbs, nested cards, oversized marketing typography inside compact commerce surfaces, and generic stock-like hero imagery.
- Promotions use MartHub-created copy and owned, licensed, or generated assets.
- Reference brand names and products do not appear in fixtures, production content, screenshots, or portfolio captures.

## Finalized M9.1 Visual System

Owner decisions approved on 2026-10-05 supersede the pre-implementation blocker below. MartHub uses a light teal + warm-orange identity, not a retail-reference blue/yellow pairing. Implementation lives in `apps/web/app/visual-tokens.css`, imported by `globals.css`; `--mh-*` custom properties and semantic Tailwind utilities share the same source. Existing Admin-specific utility styling is not redesigned.

### Colors and accessible pairings

| Token | Value | Usage |
| --- | --- | --- |
| primary / hover / active | `#0F766E` / `#115E59` / `#134E4A` | Links, wordmark, white-label primary actions |
| accent / hover | `#C2410C` / `#9A3412` | Restrained brand accent; white labels when used as an action/badge |
| background / surface / surfaceSubtle | `#F8FAFC` / `#FFFFFF` / `#F1F5F9` | Page / content / quiet media and supporting surfaces |
| textPrimary / textMuted | `#0F172A` / `#475569` | Body/headings and supporting text |
| border / borderStrong | `#CBD5E1` / `#94A3B8` | Decorative separators and inactive boundaries, not the sole indicator of an enabled control |
| success / successSubtle / stockIn | `#15803D` / `#F0FDF4` / success | Explicit success or In stock labels |
| warning / warningSubtle | `#A16207` / `#FEFCE8` | Explicit warning labels on white, page background or warningSubtle |
| error / errorSubtle / stockOut | `#B91C1C` / `#FEF2F2` / error | Field errors, explicit error or Out of stock labels |
| disabledBackground / disabledText | `#E2E8F0` / `#64748B` | Truly inactive native controls; no opacity blending |
| focusRing | primary | Visible 2px outline with 2px offset on light surfaces |

Normal-size body, muted, primary/accent links and white-label action/badge colors pass 4.5:1 on their supported surfaces. Success/error/stock text uses an explicit label, not color alone. Enabled input/control outlines use textMuted or primary where a recognizable boundary is required; the lighter border tokens are decorative only. Focus uses an offset so teal is compared against the surrounding light surface, not the teal button fill.

Do not use warning-colored normal-size text on generic surfaceSubtle: the exact ratio is 4.4939:1 and must not be rounded to PASS. Use warningSubtle/white, or ordinary textPrimary with a warning label. The owner-specified disabled pair has approximately 3.86:1 contrast and is reserved for actually inactive controls, which are exempt from WCAG text/non-text contrast requirements; explanations and actionable recovery links remain normal AA text. Decorative orange accents against teal are not text or functional indicators. No additional brand colors are introduced.

### Typography, geometry and motion

- System font only: `system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`. No external font/network dependency. Weights: 400 / 500 / 600 / 700. Body is 16/24; labels/actions normally 14-16px; no text below 12px.
- Type size/line-height in px: xs 12/16; sm 14/20; base 16/24; lg 18/28; xl 20/28; 2xl 24/32; 3xl 30/36; 4xl 36/40. Headings use semibold/bold according to hierarchy, never viewport-scaled typography.
- Spacing in px: 4, 8, 12, 16, 24, 32, 48, 64. Fixed geometry such as existing 44px targets, media sizes and container tracks remains explicit; this is not a layout redesign.
- Radii: xs 4px, sm 6px, md 8px. Affected storefront cards/panels/inputs/buttons, including former 12px catalog surfaces and round wishlist buttons, are bounded at 8px. No unrelated Admin-radius cleanup.
- Shadows: sm `0 1px 2px rgba(15,23,42,0.08)`; md `0 4px 12px rgba(15,23,42,0.10)`. Border-first cards; shadows reserved for elevated layers such as the existing menu.
- Motion: 120/180/240ms, ease-out. Existing action color feedback may transition; no autoplay or decorative animation. Reduced motion disables animations/transitions and sets duration tokens to zero.

### Asset policy and provenance register

All tracked storefront assets below were authored locally for MartHub on 2026-10-05, using text/simple geometric paths only. No downloaded logo pack, external font, retailer shape, spark/star/sunburst or reference artwork was used. Standalone SVG wordmark uses the approved system font; the monogram uses original path geometry. Next.js's existing metadata-file convention serves `app/icon.svg` as the browser/app icon. The existing text header wordmark is normalized with tokenized typography and a small original orange underline, without changing header composition.

| Path | Purpose | Source | Ownership/license |
| --- | --- | --- | --- |
| `apps/web/public/brand/wordmark.svg` | Reusable MartHub text wordmark | PROJECT_ORIGINAL | Project-created original; no third-party asset license required |
| `apps/web/public/brand/monogram.svg` | Reusable compact MH mark | PROJECT_ORIGINAL | Project-created original path geometry |
| `apps/web/app/icon.svg` | Favicon/app icon; same MH source geometry | PROJECT_ORIGINAL | Project-created original; kept identical to monogram |
| `apps/web/features/shopping/shopping-header.jsx`, `apps/web/app/globals.css` | Existing text wordmark with tokenized original underline | PROJECT_ORIGINAL | Project-authored text/CSS; existing header layout retained |
| `features/catalog/product-card.jsx`, `product-gallery.jsx`, `features/shopping/cart-manager.jsx` under `apps/web` | Existing HTML/CSS MH missing-media fallbacks | PROJECT_ORIGINAL | Existing project-authored text/geometry, retained |
| `apps/web/features/shopping/shopping-actions.jsx` | Existing text/symbol action controls | PROJECT_ORIGINAL | Project-authored controls; no installed third-party icon family found |

No new icon package or mixed icon family is introduced. Product media remains authoritative through ProductImage/Cloudinary; promotion media remains authoritative through Promotion/Cloudinary. Only ADMIN_UPLOADED_OWNED, GENERATED_FOR_MARTHUB or LICENSED_WITH_RECORD media with ownership/license evidence may be used. Upload authorization alone is not license evidence; unknown provenance is disallowed in the final storefront. M3.2 demo media remains empty, so this task does not claim to audit unknown production uploads. Future tracked assets must extend this register with path, purpose, source and ownership/license evidence.

No standalone category photos or hero/product/campaign/editorial image library is created in M9.1. Missing product media retains the existing MH fallback. Later composition may use safe product images or original token-based CSS/SVG graphics; raster work must have recorded provenance. The two `docs/references/*.png` files are reference-only, never storefront assets.

M9.1 verification on 2026-10-05: the documented allowed pairings and original-source inventory pass 37 focused checks; all 184 frontend checks and 28 four-viewport production-build browser checks pass. Desktop/mobile storefront and original SVG asset screenshots were inspected, with keyboard focus, reduced motion, stock labels, axe and no page overflow verified. The warning pairing restriction and inactive-control contrast exemption above are intentional and tested; they are not claims that every arbitrary token pairing passes AA. Detailed test/build/lint/format evidence and completion status remain in PLAN.md. Homepage and header/footer composition are unchanged and remain later tasks.

## Visual QA Matrix

### M9.1 pre-implementation visual audit (2026-10-04)

Historical status: BLOCKED pending owner decisions, resolved by the finalized system above on 2026-10-05. Existing implementation values below are observations, not approved final design tokens. The design-system audit found no separate brand specification or approved semantic token table at preflight.

- Current baseline: `apps/web/app/globals.css` uses emerald actions (`#065f46`, hover `#064e3b`), white/neutral surfaces, `#171717` body text, `#525252` muted text, `#991b1b` errors, an Arial/Helvetica/sans-serif stack, a 3px `#047857` focus outline with 4px offset, and reduced-motion overrides. Tailwind utility styling also remains distributed across components. These do not settle a balanced multi-hue palette, complete state semantics, typography/spacing scales, or reusable elevation/motion tokens. Several catalog surfaces use 12px radii, contrary to the already-approved 8px card maximum; that maximum is not reopened by this audit.
- Asset inventory: tracked image/font/icon files contain only the two reference PNGs. Existing storefront branding is text-based MartHub with CSS/HTML `MH` media fallbacks; the homepage is a text placeholder. No dedicated logo, favicon/app icon, product/category photo set, or promotional/editorial asset set is tracked. M3.2 seed content is original MartHub copy and seeds no media, as documented in README.md. Cloudinary upload control alone does not establish authorship/license provenance of runtime uploads. Both reference images were inspected only as references, never copied into storefront assets.
- Static contrast spot-checks using WCAG relative luminance: body on white 17.93:1; muted on white 7.81:1; primary button/link/badge on white 7.68:1; hover action on white 9.72:1; error on white 8.31:1; focus against white 5.48:1; `MH` text on its mint background 6.78:1; disabled pagination text on white 4.74:1. These sampled pairs pass their applicable text/non-text thresholds, but are not a complete rendered contrast review. Opacity-based disabled controls require composited/rendered review; success/warning/stock semantic pairs and all focus adjacencies remain unfinalized. No overall contrast/accessibility PASS is claimed.

Owner decisions required before implementation:

1. Approve the final primary/accent palette and semantic values/pairings for backgrounds, surfaces, text, muted text, borders, success, warning, error, stock and disabled states, including interactive hover/active states. Confirm whether current emerald values are retained rather than treating existing CSS as approval.
2. Approve the font family/fallback and permitted weights, plus the type-size/line-height scale. Confirm whether the existing system Arial stack is final or an explicitly licensed font is required.
3. Approve reusable spacing, radius (within the existing 8px card ceiling), shadow/elevation, focus and normal-motion tokens. The existing reduced-motion and accessibility requirements remain mandatory.
4. Specify the M9.1 brand deliverables and appearance: retain/finalize the text wordmark and `MH` fallback or supply/authorize a new original mark; whether favicon/app icons and an icon family are required, and their approved design/source.
5. Specify the M9.1 media deliverables and visual direction for product/category and promotional/editorial images: keep the original missing-image fallbacks or provide/create an identified asset set, with which subjects and source/license evidence. Owned/generated/licensed-only provenance and the prohibition on reference copying are already settled; no homepage composition is authorized here.

No code/assets were changed at the original preflight and no palette/font was selected then. Owner decisions are now recorded above; task status and verification evidence are owned by [PLAN.md](./PLAN.md).

The UI finish gate must record screenshots and interaction evidence for these cases. Exact automation ownership and milestone status live in `PLAN.md`.

| Surface | `360px` | `768px` | `1024px` | `1440px` | Required checks |
| --- | --- | --- | --- | --- | --- |
| Header/search | Yes | Yes | Yes | Yes | No overlap; search usable; delivery visible; drawer/menu focus behavior; cart count stable |
| Homepage mosaic | Yes | Yes | Yes | Yes | Correct stacking/composition; readable copy; real image crops; next module remains discoverable |
| Product rail | Yes | Yes | Yes | Yes | No clipped controls; natural mobile scroll; disabled boundaries; consistent card heights |
| Product card | Yes | Yes | Yes | Yes | Long name; current/compare price; large VND value; sale/new badge; pending, success, out-of-stock, and error states |
| Search/listing | Yes | Yes | Yes | Yes | URL-restorable state; filter drawer/sidebar; zero results; loading/error; no horizontal page overflow |
| Product detail | Yes | Yes | Yes | Yes | Image framing; quantity; unavailable state; sticky action does not cover content |
| My Items | Yes | Yes | Yes | Yes | Both tabs; empty and populated Reorder; wishlist empty; archived/out-of-stock item; recommendation fallback label |
| Cart/checkout | Yes | Yes | Yes | Yes | Long addresses; price/stock conflict; validation; pending submission; totals and CTA remain visible |
| Account/orders | Yes | Yes | Yes | Yes | Timeline readability; cancellation eligibility; whole-order added/skipped result |
| Admin shell | Yes | Yes | Yes | Yes | Tables remain operable; narrow-screen alternative; validation/error states; no destructive-action ambiguity |

Across all rows, verify keyboard-only operation, focus visibility, accessible names, automated accessibility checks, nonblank rendered media, text truncation, and absence of incoherent overlap. Any failed required check prevents the corresponding implementation task from being marked complete.
