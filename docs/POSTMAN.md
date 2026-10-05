# Postman portfolio rehearsal

Import [the collection](../postman/MartHub.postman_collection.json) and
[local-test environment](../postman/local-test.postman_environment.json).
The collection represents current [OpenAPI](../packages/contracts/openapi.json),
not a second API contract. It contains 76 core requests and four manual media
examples. Run folders 01–04 sequentially against a NEW isolated seeded test DB;
mutations are real and repeat runs need a new baseline. Never point these examples
at production/shared data. The machine runner refuses non-loopback/non-M10.7 DBs
and existing schema objects, never truncates/reset/drops a database.

## Automated deterministic run

Prerequisites: repository `npm ci` + `npm run db:generate`, PostgreSQL 18 running
on a known exclusively owned loopback test instance, and npm registry access.
Create a NEW empty database from template0 with the explicitly selected test
host/port/owner. Never infer credentials from a production shell/default.

```powershell
# Select your OWN disposable test instance; these are example local coordinates.
$env:PGHOST='127.0.0.1'
$env:PGPORT='15432'
$env:PGUSER='marthub'
createdb --no-password --template=template0 marthub_m107_run1_test
$env:NODE_ENV='test'
$env:MARTHUB_POSTMAN_REHEARSAL='1'
$env:DATABASE_URL='postgresql://marthub@127.0.0.1:15432/marthub_m107_run1_test'
node --test scripts/test/postman.test.js
npm run test:postman
```

Use installed PostgreSQL tools on PATH (or their installed absolute path locally).
On POSIX export the equivalent env variables. Supply test-only authentication
securely when required by your test instance. The runner applies all current
migrations, verifies the approved ten-product/zero-user seed, creates one Admin
fixture with ephemeral Argon2id credentials and registers the Customer through
the API. It binds a temporary local API port, runs REAL Newman 6.2.2 scripts and
cookie jar, and checks two orders (cancelled and delivered) and zero unexpected
server errors. No fake bearer token, mocked order transition or direct order
mutation is used. Customer cancellation/reorder/checkout and Admin four-step
delivery processing use real endpoints. Connection timestamps are explicitly
UTC; statistics still resolve the Asia/Ho_Chi_Minh business calendar.

Newman is pinned as a **separate local tool** under ignored `.cache/postman-tools`,
installed with `npm ci --ignore-scripts` from the dedicated
[tool manifest/lockfile](../postman/runner/package.json); it is not an application
dependency. The root lockfile and production graph are unchanged. Only the committed trusted
collection and local synthetic fixtures are supported—do not execute arbitrary
third-party collections/scripts through this harness. Runtime credentials, tokens
and cookie jar remain in memory; no Newman JSON report, environment export or raw
request/response log is written. Output is safe counts/results and fixed test
names. DBs are retained for inspection; choose a new name to repeat, not a reset.

Tool security review (2026-10-05): pinned compatible overrides patch Handlebars,
flatted, lodash, node-forge, underscore, qs and jose. The isolated tool scan still
reports 0 CRITICAL / 6 HIGH / 4 MODERATE package entries (including propagated
parent entries), not zero findings. Two underlying HIGH advisories remain:
[Faker helpers.fake](https://github.com/advisories/GHSA-qxc2-j82w-r537) and
[Forge RSA verification](https://github.com/advisories/GHSA-86w9-cpqp-85rv).
They are non-reachable in this restricted runner: no Faker/template/dynamic-data
input is accepted; the collection uses fixed fixtures and only UUID v4 `$guid`;
auth is noauth/bearer, not ASAP/NTLM/RSA verification. Forge's remaining advisory
has no published patch; the patched Faker major breaks Newman's eager legacy
address-generator initialization and is not forced into the tool.
Remaining MODERATE roots are CSV columns/prototype parsing (no iteration-data
file is accepted) and UUID optional-buffer algorithms (not used by `$guid` v4).
Regression checks constrain the collection's scripts/auth modes. This is a
specific trusted-local-tool classification, not clearance for arbitrary collections,
external hosts, auth plugins or uploaded data; review the graph again before expanding it.

## Manual import / local demo

Start the documented API/web against a dedicated migrated/seeded test DB. Set
baseUrl to `http://127.0.0.1:4000/api/v1` (or the same-origin local Next proxy),
and origin to the exact configured `WEB_ORIGIN` (usually
`http://localhost:3000`). Auth requires the Origin header even in Postman. Keep
the cookie jar enabled. Set local-only Customer credentials, a unique synthetic
`@example.test` email, Admin fixture credentials and a **digits-only** fresh runId
(SKU is uppercase while slugs are lowercase). Empty passwords in the committed
environment are intentional; never export a populated environment/history/cookie
jar to Git or a shared workspace.
The collection's prerequest guard skips/refuses non-loopback base URLs; this
does not prove the selected local database is disposable. The operator must
still select the explicitly owned test API/database.

For a local Admin fixture only, after migrations/seed use:

```powershell
$env:NODE_ENV='test'
$env:MARTHUB_POSTMAN_REHEARSAL='1'
# DATABASE_URL must match the guarded marthub_m107_<name>_test convention.
$env:MARTHUB_DEMO_ADMIN_EMAIL='admin@example.test'
# Set MARTHUB_DEMO_ADMIN_PASSWORD locally: unique 15–128 characters, never committed.
npm run demo:admin
```

This helper creates only a NEW test Admin identity; it refuses unsafe DBs,
existing identities, real-domain email and invalid credentials. It never promotes
a registered Customer or bootstraps production. Clear the password env variable
after entering it into your local test environment. Creating a real production
Admin remains operator-owned, not authorized by this portfolio helper.

Access tokens are captured with `pm.variables.set` in local collection-run scope,
not environment exports, browser localStorage or a persisted refresh variable.
The HttpOnly `mh_refresh` cookie stays in Postman's cookie jar and is automatically
sent only on `/api/v1/auth`; refresh rotates it, logout clears it, suspension
revokes sessions and reactivation requires a fresh login. Registration is followed
by logout/login, and the final Customer run logs out all sessions. Postman's cookie
jar is a client tool, not proof that frontend JavaScript can read HttpOnly cookies.
Production uses Secure cookies and HTTPS; the automated run is explicitly local
test HTTP, not a production deployment or TLS certification.

Assertions cover status, JSON envelope, request ID, no-store on private responses,
internal-field redaction, exact integer-string money, checkout quote/replay,
authoritative status/history and truthful recommendation labels. Full security,
transaction/concurrency and UI coverage remain in the automated suites; the
collection deliberately does not duplicate them.

## Manual-only media (four intentional skips)

Folder 05 is excluded by the automated runner, with skip count/reason reported.
Its prerequest scripts also skip unless `allowExternalMedia=true`. Signature
issuance requires real server media configuration and an audited capability;
registration verifies provider metadata. Do not invent successful uploads or use
production Cloudinary credentials. After a fresh Admin login, choose an owned
original image and a non-production Cloudinary account. Request the product or
promotion scoped signature; upload using the returned URL and exact signed
parameters per [the media contract](API.md#products-images-and-prices), then fill
mediaPublicId/uploadTimestamp/uploadSignature locally and register it. Timestamp
is a JSON integer; signature/public ID must match the scoped upload and expiry.
Do not reuse a product signature for a promotion. No signing secret belongs in
Postman. Do not export signatures, API credentials, cookies or tokens.

These examples are safe manual documentation, not executed/provider-certified
steps in M10.7. Existing adapter/integration evidence owns provider validation
and durable cleanup; [the recovery runbook](BACKUP_RESTORE.md) explains external
media limits and cleanup review before a recovery cutover.

## Clean-copy walkthrough

After local installation/generation, create another NEW empty guarded M10.7 DB,
set NODE_ENV=test, MARTHUB_POSTMAN_REHEARSAL=1 and DATABASE_URL as above, then:

```sh
# Explicit test-only opt-in; use $env:...='1' in PowerShell.
export MARTHUB_CLEAN_HANDOFF=1
npm run test:handoff
```

The helper snapshots tracked and nonignored task files into ignored
`.cache/clean-handoff-*`, excluding .git, node_modules, local config and credentials.
It installs from the repo lockfile, validates/generates/migrates/seeds, runs complete
contracts/API/frontend unit suites (two frontend workers), builds production Next,
starts the actual API entrypoint and production Next and checks readiness/homepage.
Only explicit test env is injected; synthetic non-provider media config supports
startup without any external mutation. It never copies machine secrets or old DB
state. Ports 13710/13711 must be free. Its synthetic local startup check is not
the separately documented HTTPS production smoke; use that gate for TLS/cookies.
Tool logs/report stay ignored locally. No automatic cleanup deletes DBs or folders;
inspect and remove only explicitly verified disposable artifacts when finished.
