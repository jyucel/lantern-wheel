// The naive greedy player used to reject levels that need no planning.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeStart } from '../js/engine.js';
import { naivePlay } from '../tools/naive-player.mjs';

const docks = [{ at: 0, cap: 3, kind: 'tower' }, { at: 2, cap: 3, kind: 'tower' }, { at: 4, cap: 3, kind: 'tower' }];

test('naive play solves an obvious board', () => {
  const lv = { seats: 6, docks, start: { wheel: '.....1', docks: ['000', '11', ''] } };
  assert.ok(naivePlay(lv, decodeStart(lv)) <= 3);
});

test('naive play reports Infinity when greedy moves dead-end', () => {
  // the only way forward is to lift a correct-looking lantern first
  const lv = { seats: 6, docks: [{ at: 0, cap: 2, kind: 'tower' }, { at: 2, cap: 2, kind: 'tower' }, { at: 4, cap: 2, kind: 'tower' }], start: { wheel: '......', docks: ['01', '10', ''] } };
  const n = naivePlay(lv, decodeStart(lv));
  assert.ok(n === Infinity || n >= 6);
});
