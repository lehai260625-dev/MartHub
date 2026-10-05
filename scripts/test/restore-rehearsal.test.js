import assert from 'node:assert/strict';
import test from 'node:test';
import { basename, dirname } from 'node:path';
import {
  rehearsalTargets,
  nativeEnvironment,
  digestRows,
  requireEmpty,
  expectSqlFailure,
  canonicalConstraint,
  runNative,
} from '../lib/restore-rehearsal.js';

test('native failure and diagnostic do not expose raw secret-like output', () => {
  const [target] = rehearsalTargets(env);
  const tool = basename(process.execPath);
  const nativeEnv = {
    ...process.env,
    MARTHUB_PG_BIN: dirname(process.execPath),
  };
  for (const code of [
    "process.stderr.write('private-output-fixture');process.exit(1)",
    "process.stderr.write('private-output-fixture')",
  ]) {
    assert.throws(
      () => runNative(tool, ['-e', code], target, nativeEnv),
      (error) => {
        assert.ok(!JSON.stringify(error).includes('private-output-fixture'));
        assert.ok(!error.message.includes('private-output-fixture'));
        return true;
      },
    );
  }
});

test('audit CHECK canonicalization preserves allowlist and non-audit expressions', () => {
  const row = {
    conname: 'admin_audit_logs_action_check',
    definition:
      "CHECK (((action)::text = ANY ((ARRAY['ONE'::character varying, 'TWO'::character varying])::text[])))",
  };
  const restored = {
    ...row,
    definition:
      "CHECK (((action)::text = ANY (ARRAY[('ONE'::character varying)::text, ('TWO'::character varying)::text])))",
  };
  assert.deepEqual(canonicalConstraint(row), canonicalConstraint(restored));
  assert.notDeepEqual(
    canonicalConstraint(row),
    canonicalConstraint({
      ...restored,
      definition: restored.definition.replace('TWO', 'THREE'),
    }),
  );
  assert.deepEqual(canonicalConstraint({ ...row, conname: 'another_check' }), {
    ...row,
    conname: 'another_check',
  });
});

const env = {
  NODE_ENV: 'test',
  MARTHUB_RESTORE_REHEARSAL: '1',
  MARTHUB_RESTORE_SOURCE_URL:
    'postgresql://fixture@127.0.0.1:15432/marthub_m106_one_source_test',
  MARTHUB_RESTORE_TARGET_URL:
    'postgresql://fixture@127.0.0.1:15432/marthub_m106_one_target_test',
};

test('guard accepts explicit isolated pair without depending on DATABASE_URL', () => {
  const targets = rehearsalTargets({
    ...env,
    DATABASE_URL: 'postgresql://do-not-use@remote/production',
  });
  assert.equal(targets[0].name, 'marthub_m106_one_source_test');
  assert.equal(targets[1].name, 'marthub_m106_one_target_test');
});
test('guard rejects production, missing opt-in, remote/ambiguous/overridden/aliased targets', () => {
  for (const changed of [
    { NODE_ENV: 'production' },
    { NODE_ENV: 'development' },
    { MARTHUB_RESTORE_REHEARSAL: '0' },
    { MARTHUB_RESTORE_SOURCE_URL: undefined },
    ...[
      'postgresql://fixture@remote:15432/marthub_m106_one_source_test',
      'postgresql://fixture@127.0.0.1:15432/marthub_test',
      env.MARTHUB_RESTORE_SOURCE_URL + '?schema=other',
      env.MARTHUB_RESTORE_SOURCE_URL + '#other',
      env.MARTHUB_RESTORE_SOURCE_URL.replace(':15432', ''),
      'postgresql://fixture@127.0.0.1:15432/marthub_m106_%2e%2e_source_test',
      `postgresql://fixture@127.0.0.1:15432/marthub_m106_${'a'.repeat(64)}_source_test`,
    ].map((url) => ({ MARTHUB_RESTORE_SOURCE_URL: url })),
    { MARTHUB_RESTORE_TARGET_URL: env.MARTHUB_RESTORE_SOURCE_URL },
    {
      MARTHUB_RESTORE_TARGET_URL: env.MARTHUB_RESTORE_TARGET_URL.replace(
        '127.0.0.1',
        'localhost',
      ),
    },
    {
      MARTHUB_RESTORE_TARGET_URL: env.MARTHUB_RESTORE_TARGET_URL.replace(
        '15432',
        '5432',
      ),
    },
  ])
    assert.throws(() => rehearsalTargets({ ...env, ...changed }));
});
test('native environment replaces inherited PG overrides and never needs credentials in argv', () => {
  const [target] = rehearsalTargets(env);
  const result = nativeEnvironment(target, {
    PGSERVICE: 'unsafe',
    PGOPTIONS: 'unsafe',
    PGDATABASE: 'production',
    PGHOST: 'remote',
    PGPASSWORD: 'wrong',
    PATH: 'safe',
  });
  assert.equal(result.PGDATABASE, target.name);
  assert.equal(result.PGPASSWORD, '');
  assert.equal(result.PGSERVICE, undefined);
  assert.equal(result.PGOPTIONS, undefined);
  assert.equal(result.PATH, 'safe');
});
test('row digests are order independent and sensitive to exact integers/identity/null', () => {
  const rows = [
    { value: '{"id":"one","price":9007199254740993,"reason":null}' },
    { value: '{"id":"two"}' },
  ];
  assert.equal(digestRows(rows), digestRows([...rows].reverse()));
  for (const replacement of ['9007199254740992', '"9007199254740993"'])
    assert.notEqual(
      digestRows(rows),
      digestRows([
        { value: rows[0].value.replace('9007199254740993', replacement) },
        rows[1],
      ]),
    );
  assert.notEqual(
    digestRows(rows),
    digestRows([{ value: rows[0].value.replace('null', '""') }, rows[1]]),
  );
});
test('non-empty restore target is refused; helper never resets it', async () => {
  await requireEmpty({ query: async () => ({ rows: [] }) });
  await assert.rejects(
    requireEmpty({ query: async () => ({ rows: [{ relname: 'users' }] }) }),
    /non-empty/u,
  );
});
test('invariant probe rolls back expected errors and rejects wrong/no rejection', async () => {
  for (const code of ['23514', 'different', undefined]) {
    const calls = [];
    const client = {
      query: async (sql) => {
        calls.push(sql);
        if (sql === 'probe' && code)
          throw Object.assign(new Error('private'), { code });
      },
    };
    const operation = expectSqlFailure(client, 'probe', [], '23514');
    if (code === '23514') await operation;
    else await assert.rejects(operation);
    assert.deepEqual(calls, ['BEGIN', 'probe', 'ROLLBACK']);
  }
});
