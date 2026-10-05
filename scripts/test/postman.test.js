import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { postmanDatabaseUrl, assertCollectionPaths } from '../lib/postman.js';

const env = {
  NODE_ENV: 'test',
  MARTHUB_POSTMAN_REHEARSAL: '1',
  DATABASE_URL: 'postgresql://fixture@127.0.0.1:15432/marthub_m107_one_test',
};
test('Postman guard requires explicit isolated DB and refuses overrides/production', () => {
  assert.equal(postmanDatabaseUrl(env), env.DATABASE_URL);
  for (const changed of [
    { NODE_ENV: 'production' },
    { MARTHUB_POSTMAN_REHEARSAL: '0' },
    ...[
      'postgresql://fixture@remote:5432/marthub_m107_one_test',
      'postgresql://fixture@127.0.0.1:15432/marthub',
      env.DATABASE_URL + '?schema=other',
      env.DATABASE_URL + '#other',
    ].map((DATABASE_URL) => ({ DATABASE_URL })),
  ])
    assert.throws(() => postmanDatabaseUrl({ ...env, ...changed }));
});
test('every collection operation is implemented OpenAPI; environment has no credentials', async () => {
  const read = async (path) =>
    JSON.parse(
      await readFile(new URL('../../' + path, import.meta.url), 'utf8'),
    );
  const collection = await read('postman/MartHub.postman_collection.json');
  assert.equal(
    assertCollectionPaths(
      collection,
      await read('packages/contracts/openapi.json'),
    ),
    80,
  );
  const environment = await read('postman/local-test.postman_environment.json');
  for (const entry of environment.values)
    if (/Password|Signature|Token|Secret|DATABASE_URL/iu.test(entry.key))
      assert.equal(entry.value, '');
  assert.equal(
    collection.variable.find((v) => v.key === 'accessToken').value,
    '',
  );
  const raw = JSON.stringify(collection);
  assert.ok(!raw.includes('pm.environment.set'));
  assert.ok(!raw.includes('console.log'));
  // $guid uses UUID v4 without a caller-supplied buffer, not Faker templates.
  assert.ok(
    !/faker|helpers\.fake|\{\{\$/iu.test(raw.replaceAll('{{$guid}}', '')),
  );
  for (const folder of collection.item)
    for (const item of folder.item)
      assert.ok(['noauth', 'bearer'].includes(item.request.auth.type));
  assert.ok(
    collection.item
      .at(-1)
      .item.every((item) =>
        item.event[0].script.exec[0].includes('skipRequest'),
      ),
  );
});
