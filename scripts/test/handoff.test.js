import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, readdir, access } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const root = fileURLToPath(new URL('../../', import.meta.url));
test('handoff/docs relative links and documented npm commands resolve', async () => {
  const files = [
    'README.md',
    ...(await readdir(join(root, 'docs')))
      .filter((name) => name.endsWith('.md'))
      .map((name) => 'docs/' + name),
  ];
  const scripts = new Set();
  for (const path of [
    'package.json',
    'apps/api/package.json',
    'apps/web/package.json',
    'packages/contracts/package.json',
  ]) {
    const pkg = JSON.parse(await readFile(join(root, path), 'utf8'));
    for (const name of Object.keys(pkg.scripts)) scripts.add(name);
  }
  for (const path of files) {
    const source = await readFile(join(root, path), 'utf8');
    for (const [, raw] of source.matchAll(/\[[^\]]+\]\(([^)]+)\)/gu)) {
      if (/^(?:https?:|mailto:|#)/u.test(raw)) continue;
      const target = raw.replace(/^<|>$/gu, '').split('#')[0];
      const resolved = resolve(
        dirname(join(root, path)),
        decodeURIComponent(target),
      );
      await access(resolved);
      const anchor = raw.split('#')[1];
      if (
        anchor &&
        ['README.md', 'docs/POSTMAN.md'].includes(path) &&
        resolved.endsWith('.md')
      ) {
        const linked = await readFile(resolved, 'utf8');
        const headings = [...linked.matchAll(/^#{1,6} (.+)$/gmu)].map(
          ([, title]) =>
            title
              .toLowerCase()
              .replace(/[^\p{L}\p{N}_ -]/gu, '')
              .trim()
              .replace(/ /gu, '-'),
        );
        assert.ok(headings.includes(anchor), 'Missing handoff anchor: ' + raw);
      }
    }
    if (['README.md', 'docs/POSTMAN.md'].includes(path))
      for (const [, command] of source.matchAll(/npm run ([a-z][a-z0-9:-]*)/gu))
        assert.ok(scripts.has(command), 'Missing npm command: ' + command);
  }
});
test('collection rejects external API before sending and permits owned loopback APIs', async () => {
  const collection = JSON.parse(
    await readFile(
      join(root, 'postman/MartHub.postman_collection.json'),
      'utf8',
    ),
  );
  const script = collection.event[0].script.exec.join('\n');
  for (const baseUrl of [
    'http://127.0.0.1:4000/api/v1',
    'https://localhost:13002/api/v1',
    'http://[::1]:4000/api/v1',
    'https://example.com/api/v1',
    'http://localhost.evil/api/v1',
    'http://localhost:4000/api/v1@evil',
    '',
  ]) {
    let skipped = false;
    const pm = {
      variables: { get: () => baseUrl },
      execution: {
        skipRequest: () => {
          skipped = true;
        },
      },
    };
    const safe = [
      'http://127.0.0.1:4000/api/v1',
      'https://localhost:13002/api/v1',
      'http://[::1]:4000/api/v1',
    ].includes(baseUrl);
    if (safe) runInNewContext(script, { pm });
    else assert.throws(() => runInNewContext(script, { pm }));
    assert.equal(skipped, !safe);
  }
});
