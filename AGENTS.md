# MartHub Agent Instructions

This repository contains MartHub, a portfolio-quality single-vendor e-commerce application. Read this file and `docs/PLAN.md` before making changes.

## Source of truth

- `docs/PLAN.md` owns roadmap, task status, dependencies, acceptance criteria, required tests, and Definition of Done.
- `docs/ARCHITECTURE.md` owns system and module boundaries.
- `docs/DATABASE.md` owns the domain model, persistence rules, and transaction invariants.
- `docs/API.md` owns REST conventions and endpoint contracts.
- `docs/UX.md` owns information architecture, interaction contracts, responsive behavior, and reference analysis.
- Do not duplicate detailed material across these documents. Link to the owning document.

## Required workflow

1. Inspect Git status and current files.
2. Read the active task in `docs/PLAN.md` and its linked detailed documentation.
3. Mark exactly one task `[-] IN PROGRESS` before implementation.
4. Do not start a task whose dependencies are incomplete.
5. Keep changes inside the active task's scope.
6. Run the task's required checks and tests.
7. Record concise verification evidence in `docs/PLAN.md`.
8. Mark `[x] COMPLETED` only when every acceptance criterion passes.
9. Use `[!] BLOCKED` with a concrete reason when work cannot continue safely.
10. Do not automatically start the next milestone.

Status markers:

- `[ ]` NOT STARTED
- `[-]` IN PROGRESS
- `[x]` COMPLETED
- `[!]` BLOCKED

## Approved technology constraints

- Use JavaScript. Do not convert any part of the project to TypeScript.
- Frontend: Next.js App Router, React, and Tailwind CSS.
- Backend: Node.js and Express REST under `/api/v1`.
- Database: PostgreSQL with Prisma ORM.
- Authentication: short-lived JWT access tokens and rotated opaque refresh tokens.
- Media: Cloudinary through a server-controlled adapter or signed upload flow.
- Currency: VND stored as integer `BIGINT`; never use floating point for money.
- Target architecture: npm workspaces with `apps/web`, `apps/api`, and `packages/contracts`.

## Approved product constraints

- MartHub is a single-vendor store with one inventory location.
- One Product is one sellable SKU in the MVP; product variants are out of scope.
- Cart and wishlist require authentication.
- COD is the only MVP payment method.
- Ratings, reviews, coupons, online payments, returns, refunds, multi-warehouse, and marketplace sellers are out of scope.
- The MVP uses a light visual theme.
- Web and API should be exposed under the same origin in production.
- Stock is decremented when a COD order is created and restored exactly once when an eligible order is cancelled.

## Engineering rules

- Preserve existing changes and never revert work you did not create.
- Prefer established local patterns and keep edits scoped.
- Use validation at every API boundary; frontend validation is not authoritative.
- Never trust client-provided prices, totals, user IDs, roles, stock, or order status.
- Never store access tokens in local storage.
- Never log passwords, tokens, cookies, or full delivery addresses.
- Keep Cloudinary secrets and JWT/database secrets in environment variables.
- Update Prisma migrations, OpenAPI contracts, and tests together when a contract changes.
- Use real PostgreSQL integration tests for transaction and concurrency behavior.

## UX and brand rules

- MartHub must have its own branding, content, assets, and visual language.
- The images under `docs/references` are information-architecture references only. Do not copy Walmart branding, product imagery, text, logo, colors, or proprietary assets.
- Treat search as the primary storefront action.
- Preserve the approved two-level header, merchandising module rhythm, reusable ProductCard contract, and My Items behavior documented in `docs/UX.md`.
- Do not display ratings, shipping promises, sale claims, countdowns, or personalized labels without real supporting data.
- Support keyboard navigation, visible focus, reduced motion, and WCAG 2.1 AA contrast on critical flows.
- Verify responsive behavior at 360, 768, 1024, and 1440 pixels.

## Specialized agents

Use specialized agents only when their expertise materially helps the active task:

- UX Architect: information architecture, flows, responsive contracts.
- UI Designer: design tokens, component specification, MartHub visual identity.
- Frontend Developer: Next.js, React, Tailwind, accessibility, and frontend tests.
- Backend Architect: domain modeling, APIs, security, transactions, and PostgreSQL.
- UX Researcher: focused usability review at planned UX gates.
- UI Finish-Gate Reviewer: evidence-based desktop/mobile review before M9 or M10 completion.

Agents working concurrently must have disjoint file ownership, must not edit `docs/PLAN.md` unless explicitly assigned, and must not revert other agents' changes.

## Continuation checklist

After a session interruption:

1. Read this file and `docs/PLAN.md`.
2. Inspect `git status --short --branch`.
3. Locate any `[-]` or `[!]` task.
4. Compare its acceptance criteria with the current repository and test evidence.
5. Continue the existing task; do not repeat completed work.
6. Stop before beginning another milestone unless the user explicitly authorizes it.
