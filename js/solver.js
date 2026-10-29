// Lantern Wheel: optimal solver (A* search).
//
// Heuristic (admissible, so solutions are shortest):
//   - every lantern riding the wheel needs at least one unload;
//   - in a tower, every lantern above the bottom single-color run must be
//     loaded and unloaded again (2 moves);
//   - in a pier, every lantern that is not of the color the pier keeps must
//     leave (2 moves), minimised over the color the pier could keep.
//   - spins: the wheel must turn at least far enough to bring the farthest
//     riding lantern to a dock, and (if any lantern must be moved between
//     docks) at least the smallest gap between two docks.
// Dock moves and spins are counted separately, so their sum stays a lower bound.
//
// Used by the level generator (par), the tests (solvability, optimality)
// and the in-game hint button (with a small budget).

import { EMPTY, applyMove, isSolved, moveIds, stateKey } from './engine.js';

/** Precomputed spin distances: dist[p] = spins needed before position p faces some dock. */
function spinTables(level) {
  const n = level.seats;
  const at = level.docks.map((d) => d.at);
  const gap = (from, to) => {
    const cw = (((to - from) % n) + n) % n;
    return level.oneway ? cw : Math.min(cw, n - cw);
  };
  const toDock = Array.from({ length: n }, (_, p) => Math.min(...at.map((a) => gap(p, a))));
  // a lantern lifted from dock i must reach a different dock
  let minGap = Infinity;
  for (const a of at) for (const b of at) if (a !== b) minGap = Math.min(minGap, gap(a, b));
  return { toDock, minGap: minGap === Infinity ? 0 : minGap };
}

const tables = new WeakMap();

export function heuristic(level, state) {
  let t = tables.get(level);
  if (!t) tables.set(level, (t = spinTables(level)));
  let h = 0;
  let spin = 0;
  state.wheel.forEach((c, p) => {
    if (c === EMPTY) return;
    h++;
    if (t.toDock[p] > spin) spin = t.toDock[p];
  });
  let relocate = false;
  state.docks.forEach((d, i) => {
    if (!d.length) return;
    let extra;
    if (level.docks[i].kind === 'tower') {
      let run = 1;
      while (run < d.length && d[run] === d[0]) run++;
      extra = d.length - run;
    } else {
      const count = new Map();
      for (const c of d) count.set(c, (count.get(c) || 0) + 1);
      extra = d.length - Math.max(...count.values());
    }
    if (extra) relocate = true;
    h += 2 * extra;
  });
  if (relocate && t.minGap > spin) spin = t.minGap;
  // dock moves and spins are separate moves, so their bounds add up
  return h + spin;
}

/** Binary min-heap keyed on (f, -g). */
class Heap {
  constructor() {
    this.a = [];
  }
  get size() {
    return this.a.length;
  }
  less(x, y) {
    return x.f < y.f || (x.f === y.f && x.g > y.g);
  }
  push(n) {
    const a = this.a;
    a.push(n);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.less(a[i], a[p])) break;
      [a[i], a[p]] = [a[p], a[i]];
      i = p;
    }
  }
  pop() {
    const a = this.a;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && this.less(a[l], a[m])) m = l;
        if (r < a.length && this.less(a[r], a[m])) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m], a[i]];
        i = m;
      }
    }
    return top;
  }
}

/**
 * Shortest solution from `state`.
 * @returns {{length:number, path:string[], nodes:number}|null} null if the
 *   node budget ran out or the board is unsolvable.
 */
export function solve(level, state, { maxNodes = 2_000_000 } = {}) {
  const ids = moveIds(level);
  const startKey = stateKey(state);
  const best = new Map([[startKey, 0]]); // key -> best g
  const parent = new Map([[startKey, null]]); // key -> [prevKey, move]
  const heap = new Heap();
  heap.push({ state, key: startKey, g: 0, f: heuristic(level, state) });
  let expanded = 0;
  while (heap.size) {
    const node = heap.pop();
    if (node.g !== best.get(node.key)) continue; // stale entry
    if (isSolved(level, node.state)) {
      const path = [];
      let k = node.key;
      while (parent.get(k)) {
        const [pk, mv] = parent.get(k);
        path.push(mv);
        k = pk;
      }
      path.reverse();
      return { length: path.length, path, nodes: best.size };
    }
    if (++expanded > maxNodes || best.size > maxNodes * 2) return null;
    const g = node.g + 1;
    for (const id of ids) {
      const next = applyMove(level, node.state, id);
      if (!next) continue;
      const key = stateKey(next);
      const old = best.get(key);
      if (old !== undefined && old <= g) continue;
      best.set(key, g);
      parent.set(key, [node.key, id]);
      heap.push({ state: next, key, g, f: g + heuristic(level, next) });
    }
  }
  return null;
}
