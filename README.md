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
| `npm run test:integration` | Real PostgreSQL migration/readiness checks                                            |
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

Individual workspace commands also remain available:

```sh
npm run lint --workspace @marthub/web
npm run build --workspace @marthub/web
npm test --workspace @marthub/api
# DATABASE_URL must identify a dedicated migrated test database:
npm run test:integration --workspace @marthub/api
```
