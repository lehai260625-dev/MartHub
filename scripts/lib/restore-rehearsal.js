import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

// Deliberately narrower than the general integration DB guard. Never infer a
// destination from DATABASE_URL or accept remote/shared/production defaults.
export function rehearsalTargets(env = process.env) {
  const message =
    'Rehearsal requires opt-in, distinct dedicated loopback M10.6 test databases.';
  assert.ok(
    env.MARTHUB_RESTORE_REHEARSAL === '1' && env.NODE_ENV === 'test',
    message,
  );
  const targets = ['SOURCE', 'TARGET'].map((kind) => {
    let url;
    try {
      url = new URL(env[`MARTHUB_RESTORE_${kind}_URL`]);
    } catch {
      throw new Error(message);
    }
    assert.ok(
      ['postgres:', 'postgresql:'].includes(url.protocol) &&
        ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) &&
        !url.search &&
        !url.hash &&
        url.username &&
        url.port,
      message,
    );
    const name = decodeURIComponent(url.pathname.slice(1));
    assert.match(
      name,
      /^marthub_m106_[a-z0-9]{1,32}_(source|target)_test$/u,
      message,
    );
    assert.ok(name.endsWith(`_${kind.toLowerCase()}_test`), message);
    return {
      url: url.href,
      name,
      host: url.hostname.replace(/^\[|\]$/gu, ''),
      port: url.port,
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
    };
  });
  // Require one known isolated cluster/owner and different DB names. Host aliases
  // cannot disguise the same database; no cross-cluster production recovery here.
  assert.ok(
    targets[0].name !== targets[1].name &&
      targets[0].host === targets[1].host &&
      targets[0].port === targets[1].port &&
      targets[0].user === targets[1].user,
    message,
  );
  return targets;
}

export function nativeEnvironment(target, env = process.env) {
  const clean = Object.fromEntries(
    Object.entries(env).filter(([key]) => !/^PG/iu.test(key)),
  );
  return {
    ...clean,
    PGHOST: target.host,
    PGPORT: target.port,
    PGUSER: target.user,
    PGPASSWORD: target.password,
    PGDATABASE: target.name,
    PGCONNECT_TIMEOUT: '5',
  };
}

export function runNative(tool, args, target, env = process.env) {
  const executable = env.MARTHUB_PG_BIN ? join(env.MARTHUB_PG_BIN, tool) : tool;
  const result = spawnSync(executable, args, {
    env: nativeEnvironment(target, env),
    encoding: 'utf8',
    timeout: 120000,
    maxBuffer: 4 * 1024 * 1024,
  });
  assert.equal(
    result.status,
    0,
    `${tool} failed; raw output withheld (may contain sensitive data).`,
  );
  // Native backup/restore warnings must not be silently accepted. Version output
  // is stdout. Successful commands should have no diagnostic stderr.
  assert.ok(
    result.stderr.trim() === '',
    `${tool} reported a diagnostic; review privately before accepting recovery.`,
  );
  return result.stdout;
}

export function digestRows(rows) {
  // Full row serialization stays in memory, never in the report or console.
  return createHash('sha256')
    .update(JSON.stringify(rows.map((row) => JSON.stringify(row)).sort()))
    .digest('hex');
}

// PG18 dump/reparse folds a varchar[] -> text[] constant into per-element
// casts. Normalize only this known, equivalent literal-array representation;
// never discard constraint names, validation, columns, operators or members.
export function canonicalConstraint(row) {
  if (
    ![
      'admin_audit_logs_action_check',
      'admin_audit_logs_entity_type_check',
    ].includes(row.conname)
  )
    return row;
  return {
    ...row,
    definition: row.definition.replace(
      /\(ARRAY\[((?:'[A-Z_]+'::character varying(?:, )?)+)\]\)::text\[\]/gu,
      (_match, members) =>
        `ARRAY[${members.replace(/('[A-Z_]+'::character varying)/gu, '($1)::text')}]`,
    ),
  };
}

export async function requireEmpty(client) {
  const { rows } = await client.query(`SELECT c.relname FROM pg_class c
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%'
    AND c.relkind IN ('r','p','v','m','S','f')
    UNION ALL SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
    UNION ALL SELECT t.typname FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public'
    UNION ALL SELECT nspname FROM pg_namespace WHERE nspname NOT IN ('public','pg_catalog','information_schema') AND nspname NOT LIKE 'pg_%'
    UNION ALL SELECT extname FROM pg_extension WHERE extname <> 'plpgsql'`);
  assert.equal(
    rows.length,
    0,
    'Refusing a non-empty rehearsal database; no reset/clean is performed.',
  );
}

export async function snapshot(client) {
  const { rows: tables } = await client.query(
    `SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`,
  );
  const data = {};
  for (const { tablename } of tables) {
    // Identifier comes exclusively from PostgreSQL metadata and is quoted, not
    // from caller input. JSON preserves BIGINT numeric text without JS coercion.
    const quoted = '"' + tablename.replaceAll('"', '""') + '"';
    const { rows } = await client.query(
      `SELECT row_to_json(t)::text AS value FROM public.${quoted} t`,
    );
    data[tablename] = { count: rows.length, sha256: digestRows(rows) };
  }
  const definitions = [
    `SELECT table_name,column_name,ordinal_position,data_type,udt_name,is_nullable,column_default FROM information_schema.columns WHERE table_schema='public'`,
    `SELECT c.relname,con.conname,con.contype,con.convalidated,pg_get_constraintdef(con.oid) AS definition FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'`,
    `SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public'`,
    `SELECT c.relname,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid) AS definition FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal`,
    `SELECT p.proname,pg_get_functiondef(p.oid) AS definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.deptype='e')`,
    `SELECT t.typname,e.enumlabel,e.enumsortorder FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public'`,
    `SELECT extname,extversion FROM pg_extension`,
  ];
  const schema = [];
  for (const [index, sql] of definitions.entries()) {
    const { rows } = await client.query(sql);
    schema.push({
      count: rows.length,
      sha256: digestRows(index === 1 ? rows.map(canonicalConstraint) : rows),
    });
  }
  return { data, schema };
}

export async function expectSqlFailure(client, sql, values, code) {
  await client.query('BEGIN');
  try {
    let failure;
    try {
      await client.query(sql, values);
    } catch (error) {
      failure = error;
    }
    assert.ok(
      failure && failure.code === code,
      'Restored invariant did not reject the prohibited write with the expected PostgreSQL code.',
    );
  } finally {
    await client.query('ROLLBACK');
  }
}
