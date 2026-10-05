import assert from 'node:assert/strict';
import { validateDatabaseUrl } from '../../apps/api/src/config/env.js';

export const coreFolders = [
  '01 Public',
  '02 Customer',
  '03 Admin',
  '04 Delivered Customer',
];
export function postmanDatabaseUrl(env = process.env) {
  assert.ok(
    env.NODE_ENV === 'test' && env.MARTHUB_POSTMAN_REHEARSAL === '1',
    'Explicit isolated Postman test opt-in required.',
  );
  const value = validateDatabaseUrl(env.DATABASE_URL),
    url = new URL(value);
  assert.ok(
    ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) &&
      !url.search &&
      !url.hash &&
      url.port &&
      /^marthub_m107_[a-z0-9]{1,32}_test$/u.test(url.pathname.slice(1)),
    'Dedicated loopback M10.7 test DB required.',
  );
  return value;
}
export function assertCollectionPaths(collection, openapi) {
  let count = 0;
  for (const folder of collection.item)
    for (const item of folder.item) {
      const route = item.request.url
        .replace('{{baseUrl}}', '')
        .split('?')[0]
        .replace(/\{\{[^}]+\}\}/gu, '{}');
      const match = Object.keys(openapi.paths).find((path) => {
        const expected = path.split('/'),
          actual = route.split('/');
        return (
          expected.length === actual.length &&
          expected.every(
            (part, index) =>
              /^\{[^}]+\}$/u.test(part) || part === actual[index],
          )
        );
      });
      assert.ok(
        match && openapi.paths[match][item.request.method.toLowerCase()],
        `Collection operation missing in OpenAPI: ${item.name}`,
      );
      count++;
    }
  return count;
}
