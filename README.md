# MartHub

MartHub is a single-vendor COD commerce portfolio: an original responsive storefront,
Customer account/shopping flows and Admin catalog/order operations with statistics.
It is verified locally and in CI—not claimed to be publicly production-deployed.
JavaScript npm workspaces contain Next.js/React/Tailwind, Express, PostgreSQL/Prisma
and shared runtime contracts; Cloudinary is accessed through a server-controlled adapter.
Roadmap and task evidence: [docs/PLAN.md](docs/PLAN.md). Architecture: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Capabilities and engineering highlights

- Guest: search/browse active catalog, exact VND product detail and scheduled homepage content.
- Customer: rotating refresh sessions, owned profile/addresses, cart/wishlist, server-priced
  idempotent COD checkout, immutable order history/cancellation, My Items/reorder and
  truthfully labeled recommendations.
- Admin: safe catalog/media/price/inventory management, order queue/detail and explicit
  transition commands, protected user-status management and delivered-only statistics.
  Order-processing commands are API-backed; the current Admin detail UI is read-only,
  not an unimplemented control disguised as a portfolio capability.
- Security/data: database-authoritative RBAC/ownership, memory access tokens and HttpOnly
  rotated cookies; BIGINT money; PostgreSQL transactions/locking, no oversell, exactly-once
  cancellation restoration, inventory ledger and append-only generalized Admin audit.
- UX/operations: MartHub-owned teal/orange identity, keyboard/reduced-motion/responsive
  checks at 360/768/1024/1440; nonce CSP, SEO/performance baseline evidence, safe logs,
  guarded production-like TLS smoke and reconciled native backup/restore rehearsal.

Evidence and limitations are in PLAN; these are tested implementation claims, not
hosting/SLA/Cloudinary-asset recovery guarantees. COD only; no variants, marketplace,
ratings/reviews, coupons, online payments, returns/refunds or multi-warehouse features.

## Repository map and demo entry points

`apps/web` owns storefront/account/Admin UI; `apps/api` owns REST/services/transactions
and Prisma migrations; `packages/contracts` owns shared schemas/OpenAPI; `e2e` and
`scripts` own browser/rehearsal checks; `postman` holds safe portfolio artifacts.
See [API/OpenAPI contracts](docs/API.md), [domain invariants](docs/DATABASE.md),
[UX/brand contracts](docs/UX.md), [Postman import/run guide](docs/POSTMAN.md) and
[operational recovery](docs/BACKUP_RESTORE.md).

Suggested demo: `/` → `/search?q=mug` → product → authenticated `/cart` → owned address
→ COD checkout → `/account/orders`; Admin `/admin/products` → inventory → order
queue/detail, with the existing transition API → `/admin` statistics. The Postman
rehearsal demonstrates the command portion without inventing UI controls.

## Local setup

Use Node.js 24 LTS or newer, npm 11, PostgreSQL 18 and a separately owned local DB.
Install with `npm ci` from the cloned repository root; there is no root .env template.
Set the API environment from `apps/api/.env.example` in your shell; the API currently reads process environment.
Set the server-only web API origin using `apps/web/.env.local` when the default localhost port differs.
Never commit local environment files.

The API does not auto-load .env files: export the workspace template values into
its shell (or use a local Node `--env-file` invocation explicitly). Cloudinary
configuration is required for API startup even for read-only browsing. Use your
non-production account for actual uploads; a read-only local/test demo can use
synthetic `marthub-local-test` / `local-test-key` and a locally generated 32-byte
secret, but cannot claim provider upload success. Never use those values in deployment.
Application DB connections explicitly use UTC; business statistics use the approved
Asia/Ho_Chi_Minh calendar independently of PostgreSQL's server display timezone.

Authentication requires `AUTH_JWT_SECRET`: generate a unique 32-byte secret with
`node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`
and place it only in your API process environment. Set `WEB_ORIGIN` to the exact
browser origin (locally `http://localhost:3000`). Production requires HTTPS and
secure cookies; see [auth policy](docs/API.md#authentication-classes). Changing
the signing secret invalidates existing access tokens. Test fixtures generate
isolated keys; never reuse their values in deployed environments.

Provide a PostgreSQL database and set `DATABASE_URL` before running:

```sh
npm run db:validate --workspace @marthub/api
npm run db:generate --workspace @marthub/api
npm run db:migrate --workspace @marthub/api
npm run db:seed --workspace @marthub/api
npm run dev --workspace @marthub/api
# In another terminal:
npm run dev --workspace @marthub/web
```

The storefront runs at http://localhost:3000. Express defaults to 127.0.0.1:4000.
Browser API requests use `/api/v1` through Next.js. Liveness is `/api/v1/health/live`;
readiness is `/api/v1/health/ready` and returns 503 when PostgreSQL is unavailable.
SIGINT/SIGTERM drain requests for up to ten seconds and disconnect Prisma.

Current migrations create the complete MVP domain. The original seed is optional
for development and never automatically applied to production.
Prisma uses `prisma-client-js` to preserve JavaScript output. The root pins patched
`deepmerge-ts` and `mysql2` transitive tooling dependencies; recheck those overrides when upgrading Prisma.

## Production configuration and release checks

Local env examples are development-only, not deployable credentials/defaults.
Set NODE_ENV=production explicitly. API requires HOST, PORT, DATABASE_URL,
HTTPS WEB_ORIGIN, a unique 64-hex-character AUTH_JWT_SECRET, all three Cloudinary
credentials and explicit SHIPPING_FIXED_FEE_VND / SHIPPING_FREE_THRESHOLD_VND
(approved policy: 30000 / 500000). Missing/invalid config fails before listen with
a safe bounded event, never the supplied value. Next build/start requires HTTPS
WEB_ORIGIN and explicit server-only API_INTERNAL_ORIGIN. Keep the same public and
private origins for build/start: rewrites are part of the production build.

Deploy Internet -> TLS edge -> Next -> private Express. Restrict the API
listener/service via networking/firewall to the web tier; expose no public API
port/alternate hostname. Do not enable broad trust proxy or accept client-provided
forwarded IP identity. Configure authoritative per-client limits at the chosen
edge, including auth-sensitive routes and its 429/Retry-After behavior. API peer
limits are additional aggregate defense, not original-client protection. Provider
rule values and proof of deployed bypass prevention remain the deployment
operator's responsibility, not hard-coded application cloud-vendor logic.

Release order: install from lockfile (`npm ci`); validate/generate Prisma;
`npm run db:migrate` (migrate deploy, never migrate dev/reset); `npm run build`
with explicit web origins; start the API and web with their production env.
Do not seed production automatically. Run migrations with release credentials
and runtime with least-privilege credentials where supported. Health checks may
reach the private API or same-origin proxy: live confirms app/process, ready
confirms DB SELECT 1. Keep traffic gated on readiness, not merely liveness.
SIGINT/SIGTERM use the same ten-second request drain and database disconnect.

Nonce HTML is dynamically rendered and private/no-store; do not shared-cache it.
The [CSP/telemetry contract](docs/API.md#production-browser-security-and-telemetry)
defines exact Cloudinary hosts, script nonces and safe JSON fields. Ingest API
stdout/stderr with operational-only access. Group HTTP records by bounded route,
method/status/code for counts/latency/error rates; requestId is correlation only.
Correlate db_readiness_failed/503 against startup/config/shutdown events when
diagnosing DB or private-service failures. No public metrics endpoint is added.

Schedule daily `npm run sessions:cleanup --workspace @marthub/api` with DB env only.
The [family retention rule](docs/DATABASE.md#refresh-session-retention-and-cleanup)
preserves replay lineage and 30-day grace. Steps delete at most 500 rows; each
invocation runs at most 20 steps. Check the safe JSON summary and rerun while
batchLimitReached is true; never manually prune rotated ancestors or active
sessions. Scheduler/log collection/network policy are deployment-owned.

Production-like TLS smoke (test-only, never a shared or production database):
create an empty, exclusively owned loopback database with `test` in its name;
set DATABASE_URL and MARTHUB_E2E_RESET_DATABASE=1 in a non-production shell,
build with API_INTERNAL_ORIGIN=http://127.0.0.1:4000 and explicit HTTPS WEB_ORIGIN,
then run `npm run test:production-smoke`. It requires OpenSSL on PATH (or
MARTHUB_TEST_OPENSSL), Chromium, and free ports 4000/13000/13002. The harness
applies fresh migrations then verifies no-op, seeds only the approved test
baseline, uses ephemeral test TLS, production API/Next and verifies secure auth
cookies, CSP/hydration, health, safe telemetry and shutdown. It does not truncate
an existing DB or prove a real deployed firewall/edge rule. Certificate exception
is scoped to its local test clients, never NODE_TLS_REJECT_UNAUTHORIZED globally.
Use separate databases for concurrent integration/E2E/smoke invocations.

## Media cleanup recovery

Set the server-only Cloudinary variables from `apps/api/.env.example`. The API
keeps Product and Promotion provider cleanup truth in PostgreSQL; a Cloudinary failure leaves the task
pending or failed and never reports that the asset was deleted. Run due cleanup
tasks from one operational process after migrations and whenever monitoring reports
pending work:

```sh
npm run media:cleanup --workspace @marthub/api
```

The command prints a JSON summary and safely treats an already-missing provider
asset as completed. Each automatic cycle is bounded at five attempts. After fixing
the provider or credential issue, explicitly restart failed orphan cleanup with:

```sh
npm run media:cleanup --workspace @marthub/api -- --retry-failed
```

Run the command again without `--retry-failed` for later due attempts. Signed
uploads that were never registered become eligible after their five-minute expiry,
so this same procedure removes abandoned provider assets. Investigate remaining
`FAILED` rows and the command's safe error codes; never delete those rows to hide
unresolved provider state.

## Verification

Run each check from the repository root. Set `DATABASE_URL` to a dedicated PostgreSQL
test database, then run `npm run db:generate` and `npm run db:migrate` before tests.
Install the browser once with `npx playwright install chromium`.

| Command                    | Purpose                                                                               |
| -------------------------- | ------------------------------------------------------------------------------------- |
| `npm run lint`             | JavaScript and React lint checks                                                      |
| `npm run format:check`     | Implementation formatting                                                             |
| `npm test`                 | Contracts, API unit/process, and frontend component tests                             |
| `npm run test:harness`     | Test DB guards, documentation/collection safety and recovery/smoke helper units       |
| `npm run test:integration` | Isolated real-PostgreSQL integration suites                                           |
| `npm run build`            | Shared/API syntax checks and Next.js production build                                 |
| `npm run test:e2e`         | Production web + API proxy, keyboard, axe, 404 recovery, and 360/768/1024/1440 checks |

E2E starts its own API on port 4000 and production web on port 13000. Keep those
ports free and build with the default `API_INTERNAL_ORIGIN=http://127.0.0.1:4000`.
For a local production build set `WEB_ORIGIN=https://127.0.0.1:13000` explicitly
(development's HTTP value is deliberately rejected by the production guard).
Before `npm run test:e2e`, select an exclusively owned loopback DB whose name
contains the separate word `test`, set `NODE_ENV=test` and
`MARTHUB_E2E_RESET_DATABASE=1`. The browser harness resets that dedicated DB
between viewport projects; never opt in with shared/developer data. Its local
HTTP browser setup is separate from the HTTPS production smoke above.
It checks database readiness before running and shuts down its servers afterward.
Screenshots and traces are written to ignored `test-results/`; the HTML report is
in `playwright-report/`. `npm run format` formats implementation files without
rewriting approved planning documents.

GitHub Actions uses PostgreSQL 18 and Node.js 24, installs from the lockfile, and
runs the same checks. Database credentials in that workflow are disposable test
credentials only. Configure a separate database and credentials for normal use.

PowerShell environment setup example for an existing dedicated local test database:

```powershell
$env:DATABASE_URL='postgresql://marthub@127.0.0.1:15432/marthub_test'
npm run db:generate
npm run db:migrate
npm run db:seed --workspace @marthub/api
```

The optional catalog seed adds original MartHub demo categories, products, exact VND prices, stock, and promotions. Repeated runs leave existing rows unchanged. Demo media remains empty until original assets are managed through the approved media flow.

Backup/recovery: [the operational runbook](docs/BACKUP_RESTORE.md) documents native
PostgreSQL logical backup, NEW-target restore/reconciliation, credential/grant
handling and app-first rollback. `npm run test:restore-rehearsal` requires explicit
guarded source/target test URLs; it never uses your normal `DATABASE_URL`, resets
an existing DB or performs a production cutover. Backup artifacts remain ignored.

The integration command is destructive only to the configured dedicated test
database: its database name must contain the word `test`. It runs test files
sequentially and restores the migrated deterministic seed baseline before each
file so fixtures cannot leak between suites.

Individual workspace commands also remain available:

```sh
npm run lint --workspace @marthub/web
npm run build --workspace @marthub/web
npm test --workspace @marthub/api
# DATABASE_URL must identify a dedicated migrated test database:
npm run test:integration --workspace @marthub/api
```
