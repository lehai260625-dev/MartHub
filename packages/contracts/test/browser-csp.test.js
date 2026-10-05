import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('browser contracts validate strictly without Function/JIT under nonce CSP', () => {
  const result = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
    globalThis.window = {};
    let probes = 0;
    globalThis.Function = function () { probes += 1; throw new Error('CSP forbids eval'); };
    const { healthSchema, requestIdSchema } = await import('./src/index.js');
    if (!healthSchema.safeParse({ data: { status: 'ready', version: 'v1' } }).success) process.exit(1);
    if (healthSchema.safeParse({ data: { status: 'invalid', version: 'v1' } }).success) process.exit(1);
    if (requestIdSchema.safeParse('bad id').success) process.exit(1);
    if (probes !== 0) process.exit(1);
  `,
    ],
    { cwd: new URL('..', import.meta.url), encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
});
