// Lantern Wheel: core puzzle rules.
//
// Pure module (no DOM), shared by the game, the level generator and the tests.
//
// Board
//   The wheel has `seats` gondolas at fixed world positions 0..seats-1
//   (clockwise). Each holds one lantern (a color index) or nothing (-1).
//   Docks stand beside the wheel; dock i faces world position `docks[i].at`.
//     tower  a stack: lanterns are added to and taken from the top.
//     pier   a queue: lanterns join at the back and leave from the front.
//   A dock holds at most `cap` lanterns. A gated dock (`gate`) only accepts
//   lanterns of that one color.
//
// Moves (each costs one move)
//   cw / ccw  spin the wheel one gondola (every lantern on it moves).
//             A one-way wheel (level.oneway) only spins clockwise.
//   d<i>      tap dock i: if its gondola carries a lantern, unload it onto
//             the dock (if there is room and the gate allows it); if the
//             gondola is empty, load the dock's next lantern into it.
//
// Goal
//   The wheel is empty and every dock holds a single color.

export const EMPTY = -1;

/** Parse a level's start into a mutable state {wheel:number[], docks:number[][]}. */
export function decodeStart(level) {
  const wheel = [...level.start.wheel].map((ch) => (ch === '.' ? EMPTY : Number(ch)));
  if (wheel.length !== level.seats) throw new Error(`level ${level.id}: wheel size mismatch`);
  const docks = level.start.docks.map((s) => [...s].map(Number));
  if (docks.length !== level.docks.length) throw new Error(`level ${level.id}: dock count mismatch`);
  return { wheel, docks };
}

export function encodeState(state) {
  return {
    wheel: state.wheel.map((c) => (c === EMPTY ? '.' : String(c))).join(''),
    docks: state.docks.map((d) => d.join('')),
  };
}

/** Compact string key of a state (used for search and equality). */
export function stateKey(state) {
  let s = '';
  for (const c of state.wheel) s += c === EMPTY ? '.' : c;
  for (const d of state.docks) s += '|' + d.join('');
  return s;
}

export function cloneState(state) {
  return { wheel: state.wheel.slice(), docks: state.docks.map((d) => d.slice()) };
}

/** All move ids that exist in a level. */
export function moveIds(level) {
  const ids = level.oneway ? ['cw'] : ['cw', 'ccw'];
  level.docks.forEach((_, i) => ids.push(`d${i}`));
  return ids;
}

/**
 * Describe what tapping dock i would do: {kind:'unload'|'load'} or
 * {kind:'invalid', reason}.
 */
export function dockAction(level, state, i) {
  const dock = level.docks[i];
  const seat = state.wheel[dock.at];
  const stack = state.docks[i];
  if (seat !== EMPTY) {
    if (stack.length >= dock.cap) return { kind: 'invalid', reason: 'full' };
    if (dock.gate !== undefined && dock.gate !== seat) return { kind: 'invalid', reason: 'gate' };
    return { kind: 'unload' };
  }
  if (!stack.length) return { kind: 'invalid', reason: 'empty' };
  return { kind: 'load' };
}

/**
 * Apply a move. Returns a new state, or null if the move is illegal here.
 * The input state is never modified.
 */
export function applyMove(level, state, id) {
  if (id === 'cw' || id === 'ccw') {
    if (id === 'ccw' && level.oneway) return null;
    const n = state.wheel.length;
    const wheel = new Array(n);
    const d = id === 'cw' ? 1 : -1;
    for (let k = 0; k < n; k++) wheel[(k + d + n) % n] = state.wheel[k];
    return { wheel, docks: state.docks };
  }
  if (id[0] !== 'd') return null;
  const i = Number(id.slice(1));
  const dock = level.docks[i];
  if (!dock) return null;
  const act = dockAction(level, state, i);
  if (act.kind === 'invalid') return null;
  const wheel = state.wheel.slice();
  const docks = state.docks.slice();
  const stack = state.docks[i].slice();
  if (act.kind === 'unload') {
    stack.push(wheel[dock.at]);
    wheel[dock.at] = EMPTY;
  } else {
    wheel[dock.at] = dock.kind === 'pier' ? stack.shift() : stack.pop();
  }
  docks[i] = stack;
  return { wheel, docks };
}

export function isSolved(level, state) {
  if (state.wheel.some((c) => c !== EMPTY)) return false;
  return state.docks.every((d) => d.every((c) => c === d[0]));
}

/** A dock is "done" when it is full of one color and nothing of that color is elsewhere. */
export function dockComplete(level, state, i) {
  const d = state.docks[i];
  if (!d.length || !d.every((c) => c === d[0])) return false;
  const total = colorCounts(state).get(d[0]);
  return d.length === total;
}

export function colorCounts(state) {
  const m = new Map();
  const add = (c) => c !== EMPTY && m.set(c, (m.get(c) || 0) + 1);
  state.wheel.forEach(add);
  state.docks.forEach((d) => d.forEach(add));
  return m;
}

/** Structural checks. Returns a list of problems (empty when valid). */
export function validateLevel(level) {
  const errs = [];
  let state;
  try {
    state = decodeStart(level);
  } catch (e) {
    return [e.message];
  }
  const seen = new Set();
  level.docks.forEach((d, i) => {
    if (!(d.at >= 0 && d.at < level.seats)) errs.push(`dock ${i}: bad position`);
    if (seen.has(d.at)) errs.push(`dock ${i}: two docks face one gondola`);
    seen.add(d.at);
    if (d.kind !== 'tower' && d.kind !== 'pier') errs.push(`dock ${i}: bad kind`);
    if (state.docks[i].length > d.cap) errs.push(`dock ${i}: over capacity`);
    if (d.gate !== undefined && state.docks[i].some((c) => c !== d.gate)) errs.push(`dock ${i}: gate violated`);
  });
  // every color must fit into docks so that each dock is monochrome
  const counts = [...colorCounts(state).entries()];
  const caps = level.docks.map((d) => d.cap);
  if (!packable(counts, caps, level.docks)) errs.push('colors cannot be sorted into the docks');
  if (level.limit !== undefined && !(level.limit >= (level.par || 0))) errs.push('move limit below par');
  return errs;
}

/** Can each color be placed into its own set of docks? (small backtracking) */
function packable(counts, caps, docks) {
  const free = caps.slice();
  const order = counts.slice().sort((a, b) => b[1] - a[1]);
  const rec = (k) => {
    if (k === order.length) return true;
    const [color, count] = order[k];
    // choose a subset of unused docks whose capacity covers the count
    const idx = free.map((c, i) => i).filter((i) => free[i] > 0 && (docks[i].gate === undefined || docks[i].gate === color));
    const tryFrom = (start, need, used) => {
      if (need <= 0) {
        if (rec(k + 1)) return true;
        return false;
      }
      for (let j = start; j < idx.length; j++) {
        const i = idx[j];
        const c = free[i];
        free[i] = 0;
        used.push(i);
        if (tryFrom(j + 1, need - c, used)) return true;
        used.pop();
        free[i] = c;
      }
      return false;
    };
    return tryFrom(0, count, []);
  };
  return rec(0);
}

/**
 * Game session: state, move counter, undo history and move limit.
 */
export class Game {
  constructor(level) {
    this.level = level;
    this.initial = decodeStart(level);
    this.limit = level.limit ?? Infinity;
    this.restart();
  }

  restart() {
    this.state = cloneState(this.initial);
    this.history = [];
    this.moveCount = 0;
  }

  get movesLeft() {
    return this.limit - this.moveCount;
  }

  get solved() {
    return isSolved(this.level, this.state);
  }

  get outOfMoves() {
    return !this.solved && this.moveCount >= this.limit;
  }

  canPlay(id) {
    return applyMove(this.level, this.state, id) !== null;
  }

  /** Apply one or more moves as a single undoable action. */
  play(ids) {
    if (!Array.isArray(ids)) ids = [ids];
    if (!ids.length || this.solved) return false;
    if (this.moveCount + ids.length > this.limit) return false;
    let s = this.state;
    for (const id of ids) {
      s = applyMove(this.level, s, id);
      if (!s) return false;
    }
    this.history.push({ state: this.state, ids: ids.slice() });
    this.state = s;
    this.moveCount += ids.length;
    return true;
  }

  undo() {
    const last = this.history.pop();
    if (!last) return null;
    this.state = last.state;
    this.moveCount -= last.ids.length;
    return last;
  }
}

/** Stars: three at or under par, two within half the margin, else one. */
export function starsFor(moves, par, limit = par + 4) {
  if (moves <= par) return 3;
  if (moves <= par + Math.max(1, Math.ceil((limit - par) / 2))) return 2;
  return 1;
}
