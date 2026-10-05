import assert from 'node:assert/strict';
import test from 'node:test';
import { upstreamFailure } from '../lib/smoke-proxy.js';

test('test edge errors return 503 before headers, terminate streams, and never write twice', () => {
  for (const state of [
    {},
    { headersSent: true },
    { writableEnded: true },
    { destroyed: true },
  ]) {
    const calls = [];
    const response = {
      ...state,
      writeHead: (code) => calls.push(code),
      end: () => calls.push('end'),
      destroy: () => calls.push('destroy'),
    };
    upstreamFailure(response);
    assert.deepEqual(
      calls,
      state.headersSent
        ? ['destroy']
        : state.writableEnded || state.destroyed
          ? []
          : [503, 'end'],
    );
  }
});
