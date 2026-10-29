// Solver: optimal (cross-checked against plain breadth-first search), legal
// solutions, admissible heuristic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game, applyMove, decodeStart, encodeState, isSolved, moveIds, stateKey } from '../js/engine.js';
import { solve, heuristic } from '../js/solver.js';

function rng(seed) {
  return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

const LEVELS = [
  { seats: 6, docks: [{ at: 0, cap: 3, kind: 'tower' }, { at: 2, cap: 3, kind: 'tower' }, { at: 4, cap: 3, kind: 'tower' }] },
  { seats: 6, docks: [{ at: 0, cap: 3, kind: 'pier' }, { at: 3, cap: 3, kind: 'tower' }, { at: 4, cap: 3, kind: 'pier' }] },
  { seats: 6, oneway: true, docks: [{ at: 0, cap: 3, kind: 'tower' }, { at: 2, cap: 3, kind: 'pier' }, { at: 4, cap: 3, kind: 'tower', gate: 1 }] },
];

/** Exact distance-to-goal for every state reachable from `start` (plain BFS + reverse sweep). */
function exactDistances(level, start) {
  const ids = moveIds(level);
  const states = new Map([[stateKey(start), start]]);
  const edges = new Map();
  const queue = [start];
  while (queue.length) {
    const s = queue.shift();
    const k = stateKey(s);
    const out = [];
    for (const id of ids) {
      const n = applyMove(level, s, id);
      if (!n) continue;
      const nk = stateKey(n);
      out.push(nk);
      if (!states.has(nk)) {
        states.set(nk, n);
        queue.push(n);
      }
    }
    edges.set(k, out);
  }
  // reverse BFS from all goals
  const rev = new Map();
  for (const [k, out] of edges) for (const t of out) rev.set(t, [...(rev.get(t) || []), k]);
  const dist = new Map();
  const q = [];
  for (const [k, s] of states) if (isSolved(level, s)) {
    dist.set(k, 0);
    q.push(k);
  }
  while (q.length) {
    const k = q.shift();
    for (const p of rev.get(k) || []) if (!dist.has(p)) {
      dist.set(p, dist.get(k) + 1);
      q.push(p);
    }
  }
  return { states, dist };
}

LEVELS.forEach((base, li) => {
  test(`solver is optimal and the heuristic admissible (board ${li + 1})`, () => {
    const r = rng(li + 11);
    const colors = [0, 0, 0, 1, 1, 2];
    const wheel = new Array(6).fill('.');
    const docks = [[], [], []];
    for (const c of colors) {
      const d = Math.floor(r() * 3);
      if (docks[d].length < 3 && !(base.docks[d].gate !== undefined && base.docks[d].gate !== c)) docks[d].push(c);
      else wheel[wheel.indexOf('.')] = String(c);
    }
    const level = { ...base, start: { wheel: wheel.join(''), docks: docks.map((d) => d.join('')) } };
    const start = decodeStart(level);
    const { states, dist } = exactDistances(level, start);
    let checked = 0;
    for (const [k, s] of states) {
      const d = dist.get(k);
      if (d === undefined) continue; // dead end: unsolvable from here
      assert.ok(heuristic(level, s) <= d, `heuristic overestimates at ${k}`);
      if (checked++ < 60) {
        const res = solve(level, s);
        assert.equal(res.length, d, `not optimal at ${k}`);
        const g = new Game({ ...level, start: encodeState(s) });
        if (res.length) assert.ok(g.play(res.path));
        assert.ok(g.solved);
      }
    }
    assert.ok(checked > 20, 'enough states were checked');
  });
});

test('unsolvable boards return null, budget exhaustion returns null', () => {
  // a single lantern of color 0 sits in a full tower under two 1s, every other dock is gated to 2
  const level = {
    seats: 4,
    docks: [{ at: 0, cap: 3, kind: 'tower' }, { at: 2, cap: 1, kind: 'tower', gate: 2 }],
    start: { wheel: '....', docks: ['011', ''] },
  };
  // the wheel can park the 1s, but there is nowhere to put both colors apart: still solvable? check via BFS
  const { dist } = exactDistances(level, decodeStart(level));
  const truth = dist.get(stateKey(decodeStart(level)));
  const res = solve(level, decodeStart(level));
  assert.equal(res ? res.length : undefined, truth);
  const big = { ...LEVELS[0], start: { wheel: '......', docks: ['012', '120', '201'] } };
  assert.equal(solve(big, decodeStart(big), { maxNodes: 3 }), null);
});
