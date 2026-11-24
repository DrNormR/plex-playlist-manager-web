import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planMoves, simulate } from './reorder.ts';

function shuffle<T>(a: T[]): T[] {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
}

test('no-op needs no moves', () => {
  const l = ['a', 'b', 'c'];
  assert.deepEqual(planMoves(l, l), []);
});

test('moving last item to top is one move', () => {
  const moves = planMoves(['a', 'b', 'c', 'd'], ['d', 'a', 'b', 'c']);
  assert.deepEqual(moves, [{ id: 'd', after: null }]);
});

test('moving first item to bottom is one move', () => {
  const moves = planMoves(['a', 'b', 'c', 'd'], ['b', 'c', 'd', 'a']);
  assert.equal(moves.length, 1);
  assert.deepEqual(simulate(['a', 'b', 'c', 'd'], moves), ['b', 'c', 'd', 'a']);
});

test('random permutations always produce the target', () => {
  for (let n = 1; n < 60; n++) {
    const cur = Array.from({ length: n }, (_, i) => String(i));
    for (let k = 0; k < 20; k++) {
      const target = shuffle(cur);
      const moves = planMoves(cur, target);
      assert.deepEqual(simulate(cur, moves), target);
      assert.ok(moves.length < n);
    }
  }
});
