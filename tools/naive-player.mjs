// Lantern Wheel: a "naive player" used to reject levels that need no thought.
//
// Strategy: at every step, consider each dock, spin the wheel the shortest
// way so that dock faces the right gondola, and tap it. Keep the option that
// improves the board the most per move (measured by the dock/wheel part of
// the solver heuristic). Never make a move that does not immediately help.
// Levels this strategy cannot finish within the move limit need real
// planning: a deliberate detour, parking lanterns, or the right order.

import { applyMove, isSolved, stateKey } from '../js/engine.js';
import { heuristic } from '../js/solver.js';

function spinSeqs(level) {
  const n = level.seats;
  const out = [[]];
  for (let k = 1; k < n; k++) {
    if (level.oneway || k <= n - k) out.push(new Array(k).fill('cw'));
    else out.push(new Array(n - k).fill('ccw'));
  }
  return out;
}

export function naivePlay(level, start, cap = 80) {
  const macros = [];
  for (const spins of spinSeqs(level)) level.docks.forEach((_, i) => macros.push([...spins, `d${i}`]));
  const run = (s, ids) => {
    for (const id of ids) {
      s = applyMove(level, s, id);
      if (!s) return null;
    }
    return s;
  };
  let state = start;
  let used = 0;
  const seen = new Set([stateKey(state)]);
  while (!isSolved(level, state)) {
    const h = heuristic(level, state);
    let best = null;
    for (const m of macros) {
      const next = run(state, m);
      if (!next) continue;
      const key = stateKey(next);
      if (seen.has(key)) continue;
      const solved = isSolved(level, next);
      const gain = h - heuristic(level, next);
      if (gain <= 0 && !solved) continue;
      const score = (solved ? 1000 : gain) / m.length;
      if (!best || score > best.score || (score === best.score && m.length < best.m.length)) best = { score, m, next, key };
    }
    if (!best) return Infinity;
    state = best.next;
    seen.add(best.key);
    used += best.m.length;
    if (used > cap) return Infinity;
  }
  return used;
}
