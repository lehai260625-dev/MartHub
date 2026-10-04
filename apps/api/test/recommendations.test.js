import assert from 'node:assert/strict';
import test from 'node:test';
import { affinityGroups } from '../src/modules/orders/recommendations.js';

test('quantity affinity groups sum product quantities, merge ties and preserve exact large integers', () => {
  assert.deepEqual(
    affinityGroups([
      { categoryId: 'b', quantity: 2n },
      { categoryId: 'a', quantity: 1n },
      { categoryId: 'b', quantity: 3n },
      { categoryId: 'c', quantity: 5n },
    ]),
    [['b', 'c'], ['a']],
  );
  assert.deepEqual(
    affinityGroups([
      { categoryId: 'smaller', quantity: 9007199254740992n },
      { categoryId: 'larger', quantity: 9007199254740993n },
    ]),
    [['larger'], ['smaller']],
  );
});
test('empty history yields no personalized category groups', () =>
  assert.deepEqual(affinityGroups([]), []));
