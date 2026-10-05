# MartHub

JavaScript npm workspaces for the Next.js storefront, Express API, and shared contracts.
Roadmap and task evidence: [docs/PLAN.md](docs/PLAN.md). Architecture: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Local foundation

Use Node.js 24 LTS or newer and npm 11. Install with `npm ci`.
Set the API environment from `apps/api/.env.example` in your shell; the API currently reads process environment.
Set the server-only web API origin using `apps/web/.env.local` when the default localhost port differs.
Never commit local environment files.

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
npm run dev --workspace @marthub/api
# In another terminal:
npm run dev --workspace @marthub/web
```

The storefront runs at http://localhost:3000. Express defaults to 127.0.0.1:4000.
Browser API requests use `/api/v1` through Next.js. Liveness is `/api/v1/health/live`;
readiness is `/api/v1/health/ready` and returns 503 when PostgreSQL is unavailable.
SIGINT/SIGTERM drain requests for up to ten seconds and disconnect Prisma.

The baseline migration creates only the public namespace. Domain tables are introduced in their owning milestones.
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
| `npm run test:integration` | Isolated real-PostgreSQL integration suites                                           |
| `npm run build`            | Shared/API syntax checks and Next.js production build                                 |
| `npm run test:e2e`         | Production web + API proxy, keyboard, axe, 404 recovery, and 360/768/1024/1440 checks |

E2E starts its own API on port 4000 and production web on port 13000. Keep those
ports free and build with the default `API_INTERNAL_ORIGIN=http://127.0.0.1:4000`.
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
