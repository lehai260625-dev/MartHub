# PostgreSQL backup, restore and recovery

M10.6 owns this logical restore rehearsal, not a deployed backup service. Domain
invariants and forward-only migration rules remain in [DATABASE.md](DATABASE.md);
the private API, release, TLS, edge and cleanup deployment contracts remain in
[ARCHITECTURE.md](ARCHITECTURE.md) and [README.md](../README.md).

## Scope and responsibilities

Use a PostgreSQL-native custom archive of the **entire MartHub database**, with
schema/data, `_prisma_migrations`, enums, functions, triggers, indexes and
constraints. No table/schema filtering, data-only dump or Prisma pseudo-backup.
The archive is not a cluster backup: global roles, passwords, tablespaces and
host configuration must be provisioned separately. Cloudinary media binaries
are external; restored media IDs/URLs/cleanup state do not prove media recovery.
Do not run the media cleanup worker until the restored metadata and provider
assets have been reviewed for the recovery cutover.

Backups contain password/token **hashes**, session lineage, addresses and order
snapshots: sensitive application data, even though raw JWT, Cloudinary and
database credentials or `.env` files are not included. Never print restored rows,
dump contents, URLs with passwords, cookies or credentials to CI/operator logs.
Never commit/upload an archive as a public build artifact. Restrict filesystem
and storage access to recovery operators; use encrypted storage and transport
under deployment-operator control. Compression is **not encryption**. Verify
encrypted copies can be retrieved/decrypted by authorized recovery operators.
Retention/scheduling are operator-owned; **RPO and RTO are UNDEFINED**. This task
does not authorize a numeric SLA, retention policy, PITR or vendor architecture.

## Before backup

1. Confirm environment, host/port, database name, release SHA, migration state and
   responsible operator. Do not use a shell's accidental default DB. Confirm with
   `psql --no-password -X -v ON_ERROR_STOP=1 -c
'SELECT current_database(), current_user, version();'` using the explicitly
   selected PG connection environment. Store this identification privately.
2. Use trusted PostgreSQL 18 tools for the currently approved PostgreSQL 18 server;
   record `pg_dump --version`, `pg_restore --version`, server version and extension
   versions (`SELECT extname, extversion FROM pg_extension`). `pg_dump` must not be
   older than the source server major. Cross-major recovery needs its own rehearsal;
   this gate establishes same-major recovery only.
3. Use a controlled connection environment: explicitly set PGHOST, PGPORT, PGUSER,
   PGDATABASE, clear accidental PGSERVICE/PGOPTIONS overrides and configure TLS
   verification for non-local connections. Inject credentials via a protected
   passfile/secret mechanism, not command-line URL/password or shell history.
   PG credentials differ from separately injected JWT/Cloudinary/application config.
4. Archive only trusted databases: restore executes SQL/functions from the source.
   Confirm no migration/schema change runs during the backup. Native pg_dump has a
   consistent data snapshot; a separate reconciliation manifest taken during live
   writes is **not** automatically the same snapshot. For exact manifest comparison,
   quiesce writers/schedulers and capture the manifest and backup while quiescent,
   or design/rehearse a coordinated snapshot procedure before relying on it.
5. Prepare a NEW private artifact directory outside source control (POSIX mode
   0700; Windows remove inherited broad ACLs and grant only designated operators).
   Choose a NEW name including environment, release and UTC timestamp, e.g.
   `marthub-<environment>-<release>-<UTC>.dump`; refuse overwrite. Secure temporary
   failure artifacts as sensitively as successful backups.

## Backup command (operator template)

The following POSIX template assumes the explicit source PG environment and
protected authentication from the previous checklist. Substitute only verified
paths; do not put credentials in command arguments.

```sh
umask 077
backup_file='/private/recovery/marthub-ENV-SHA-UTC.dump'
test ! -e "$backup_file" || exit 1
pg_dump --no-password --format=custom --no-owner --no-acl \
  --file="$backup_file" || exit 1
test -s "$backup_file" || exit 1
pg_restore --list "$backup_file" > "$backup_file.toc" || exit 1
sha256sum "$backup_file" > "$backup_file.sha256" || exit 1
```

Review stderr privately: warnings/errors must be explained before accepting the
backup. Retain a restricted manifest of versions, release, migration checksums,
snapshot/cutoff context, counts/hashes and artifact hash. Verify hash after secure
transfer/decryption. Do not infer integrity just from a nonempty file or TOC.
For custom archives, `--no-owner` is enforced on **restore**; cluster role/ACL
provisioning is intentionally separate. See official [pg_dump](https://www.postgresql.org/docs/18/app-pgdump.html)
and [pg_restore](https://www.postgresql.org/docs/18/app-pgrestore.html) semantics.

## Restore into a NEW empty recovery database

1. Keep the source and affected database untouched. Have an operator provision a
   separate, explicitly named recovery database from `template0` on a trusted
   compatible server. Confirm the target does not already exist before creation:
   `createdb --no-password --template=template0 VERIFIED_NEW_RECOVERY_NAME`.
   Never use `--clean`, restore over the source, or automatically drop/recreate
   any existing database. A failed rehearsal uses new names on the next attempt.
2. Provision the recovery owner/migration role and extension capability
   (`btree_gist`, `pg_trgm`, plus `plpgsql`); same encoding/locale and PostgreSQL
   extension versions as the verified source. The owner needs permission to create
   schema objects/extensions, not the running API's ordinary DML credentials.
   Change PGDATABASE to the NEW target and re-confirm identity/empty state; check
   there are no application tables/views/sequences/custom objects. Prevent other
   writers from connecting during restore/reconciliation.
3. With the target PG environment selected, execute:

   ```sh
   pg_restore --no-password --exit-on-error --single-transaction \
     --no-owner --no-acl --dbname="$PGDATABASE" "$backup_file" || exit 1
   ```

   No trigger disabling or partial restore. Any error rejects the recovery;
   diagnose privately and retry into another NEW target. Never promote a partial
   result. Created objects belong to the restoring role; original ownership/grants
   are not recreated by this portable procedure.

4. Reapply reviewed runtime privileges for the target: CONNECT, USAGE on `public`,
   DML on application tables and sequence USAGE where needed. Do not grant runtime
   CREATE, database ownership, migration role membership or DML on
   `_prisma_migrations`. Use the restoring/migration owner to grant privileges.
   Example psql template (explicit role variables supplied by the operator):

   ```sql
   GRANT CONNECT ON DATABASE :"recovery_db" TO :"runtime_role";
   REVOKE CREATE ON SCHEMA public FROM PUBLIC;
   GRANT USAGE ON SCHEMA public TO :"runtime_role";
   SELECT format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO %I',
                 tablename, :'runtime_role')
     FROM pg_tables WHERE schemaname = 'public'
       AND tablename <> '_prisma_migrations' \gexec
   GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO :"runtime_role";
   ```

   Apply with `psql -X -v ON_ERROR_STOP=1`; no credentials in `-v` values. Check the
   runtime role is not an owner/superuser and test readiness/representative reads
   with it before promotion. New-object default grants are separately reviewed
   in the normal migration/release process; do not broadly grant migration access.

5. Verify all current committed migration names/checksums, completed state, no
   failed/rolled-back rows. Run `npm run db:validate`, then `npm run db:migrate`
   using the recovery **migration** credentials and exact compatible release.
   For a current-schema backup it must report **No pending migrations** and leave
   metadata/data/schema unchanged. Do not edit migration rows or mark unknown
   migrations applied merely to make this pass. An older backup requires a planned
   forward upgrade and a separate tested compatibility/reconciliation plan.
6. Reconcile before promotion: all application table counts + deterministic full
   row hashes (including nullable data, precise BIGINT text, hashes and lineage,
   identities/roles/statuses, prices/stock, immutable order/address/item snapshots,
   ordered history, inventory movement business keys, audit allowlists, media and
   cleanup state). Compare schema columns/defaults, named validated constraints,
   index definitions, trigger enablement/functions, enums and extensions. Exercise
   illegal immutable/append-only writes inside rolled-back probes, uniqueness,
   price exclusion and nonnegative-stock checks. Do not substitute manual totals
   or coerced JavaScript Number values. On live recovery compare against the
   backup's verified snapshot manifest, not the now-changing source DB.
7. With separately injected application config, connect the candidate API to the
   recovered DB. Check `/api/v1/health/ready` and representative catalog/order reads,
   exact money/history, no unexpected errors and no side effects. Verify public
   and authenticated role/ownership paths under the existing release smoke checks
   before traffic. The automated local rehearsal below proves Prisma/readiness
   and one real HTTP public product read; it does not provision production grants,
   edge/TLS, retrieve Cloudinary bytes or run a complete post-disaster user journey.

## Reproducible local test rehearsal

Use a dedicated disposable loopback PostgreSQL cluster, never the developer/user
or production instance. The explicit opt-in asserts exclusive test-cluster
ownership. Both named databases must be NEW; no drop/truncate/reset helper exists.
The harness creates them only after checking both absent; it rechecks empty source
and target, applies current migrations, uses the approved original catalog seed,
and creates a deterministic test-only fixture. A fixture failure rolls back its
transaction. Leave failed DBs intact for inspection; choose a new pair to rerun.

```powershell
$env:NODE_ENV='test'
$env:MARTHUB_RESTORE_REHEARSAL='1'
$env:MARTHUB_PG_BIN='C:/Program Files/PostgreSQL/18/bin'
$env:MARTHUB_RESTORE_SOURCE_URL='postgresql://marthub@127.0.0.1:15432/marthub_m106_run1_source_test'
$env:MARTHUB_RESTORE_TARGET_URL='postgresql://marthub@127.0.0.1:15432/marthub_m106_run1_target_test'
node --test scripts/test/restore-rehearsal.test.js
npm run test:restore-rehearsal
```

On POSIX, export the same variables and use installed tools on PATH (omit
MARTHUB_PG_BIN). `DATABASE_URL` is not used to infer either destination. Production,
remote hosts, missing opt-in, URL query/hash overrides, unexpected names, different
cluster/owner, existing databases and nonempty targets are refused. Native child
PG settings explicitly replace inherited PG overrides, with credentials in the
child environment rather than argv. Local test credentials only. The harness
does not deploy/configure/start PostgreSQL; start only an identified owned test
cluster before running it.

Artifacts are under NEW ignored `.cache/restore-rehearsal-*` directories: private
0700/0600 on POSIX; current-user-only inherited ACL on Windows. `marthub.dump` and
`report.json` are never tracked. The report contains versions, counts and hashes,
not row data/secrets. Native failures suppress raw diagnostic output; the named
failed stage identifies where to investigate privately. A safe mismatch report
lists table/schema group names only. Source/target DBs and artifacts are retained
for operator inspection; no automatic deletion/promotion occurs. Delete only
explicitly verified disposable targets/artifacts when no longer needed.

The comparison narrowly canonicalizes PG18's equivalent whole-varchar-array versus
per-element text casts in the two Admin audit allowlist CHECK definitions. It
preserves every allowlist member/operator/constraint name and validation flag;
all other definitions compare directly. Dedicated tests prove changed allowlists
still differ. Reconciliation and invariant probes run again after migration no-op
and the read-only smoke, ensuring no test-probe residue.

## Recovery / rollback decision path

**Failed application deployment, compatible schema:** stop the failed rollout,
restore the previous known-good app artifact/config using the deployment
operator's release mechanism, keep the DB, then run readiness and critical-flow
smokes. Check expand-and-contract compatibility before rollback. Do not restore
an old database merely because app deployment failed: that would lose valid writes.

**Bad migration or data corruption:** stop writes using the operator's supported
maintenance/traffic control (including API instances, workers and cleanup jobs).
Preserve the affected DB with a separately named restricted diagnostic backup
where feasible. Select and verify a trusted known-good backup/cutoff; acknowledge
any missing later writes explicitly, with owner approval for recovery/promotion.
Restore into a separate NEW recovery DB, reconcile, test compatibility/grants,
inject independent config and smoke the candidate application. Only after operator
and owner sign-off switch connection configuration/traffic to the verified DB;
retain the old DB/diagnostic backup. Observe readiness/logs and verify representative
customer/admin state before resuming writes/schedulers. If validation fails, keep
maintenance and the old DB preserved; do not partially promote or repeatedly reset it.

Prisma migrations are **forward-only**. There is no approved down-migration
procedure; reversing migration SQL or `migrate resolve` is not a data rollback.
Use a reviewed forward repair when appropriate or the separate validated recovery
DB path. This runbook provides the sequence, not an automated infrastructure
cutover or guaranteed recovery time.
