// Rules: spins, towers (stacks), piers (queues), gates, one-way wheel,
// capacity, win condition, move limit, undo and restart.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game, EMPTY, applyMove, decodeStart, encodeState, isSolved, dockAction, validateLevel, starsFor, stateKey, moveIds } from '../js/engine.js';

// 6 gondolas; tower at 0, pier at 2, tower at 4 (gated to color 2 when asked).
function board(start, extra = {}) {
  return {
    id: 't',
    seats: 6,
    ...(extra.oneway ? { oneway: true } : {}),
    docks: [
      { at: 0, cap: 3, kind: 'tower' },
      { at: 2, cap: 3, kind: 'pier' },
      { at: 4, cap: 3, kind: 'tower', ...(extra.gate !== undefined ? { gate: extra.gate } : {}) },
    ],
    start,
    par: 1,
    ...(extra.limit ? { limit: extra.limit } : {}),
  };
}
const enc = (lv, s) => {
  const e = encodeState(s);
  return `${e.wheel}|${e.docks.join(',')}`;
};

test('spinning clockwise moves every gondola one place', () => {
  const lv = board({ wheel: '01....', docks: ['', '', ''] });
  const s = applyMove(lv, decodeStart(lv), 'cw');
  assert.equal(enc(lv, s), '.01...|,,');
  const back = applyMove(lv, s, 'ccw');
  assert.equal(enc(lv, back), '01....|,,');
});

test('a full turn returns the wheel to where it started', () => {
  const lv = board({ wheel: '0.1..2', docks: ['', '', ''] });
  let s = decodeStart(lv);
  for (let i = 0; i < 6; i++) s = applyMove(lv, s, 'cw');
  assert.equal(stateKey(s), stateKey(decodeStart(lv)));
});

test('tower: unload pushes on top, load takes the top (LIFO)', () => {
  const lv = board({ wheel: '2.....', docks: ['01', '', ''] });
  let s = applyMove(lv, decodeStart(lv), 'd0');
  assert.equal(enc(lv, s), '......|012,,');
  s = applyMove(lv, s, 'd0');
  assert.equal(enc(lv, s), '2.....|01,,', 'the last one in comes out first');
});

test('pier: unload joins the back, load takes the front (FIFO)', () => {
  const lv = board({ wheel: '..2...', docks: ['', '01', ''] });
  let s = applyMove(lv, decodeStart(lv), 'd1');
  assert.equal(enc(lv, s), '......|,012,');
  s = applyMove(lv, s, 'd1');
  assert.equal(enc(lv, s), '..0...|,12,', 'the first one in comes out first');
});

test('docks have limited room and refuse when full', () => {
  const lv = board({ wheel: '0.....', docks: ['111', '', ''] });
  assert.equal(applyMove(lv, decodeStart(lv), 'd0'), null);
  assert.deepEqual(dockAction(lv, decodeStart(lv), 0), { kind: 'invalid', reason: 'full' });
});

test('tapping an empty dock facing an empty gondola does nothing', () => {
  const lv = board({ wheel: '......', docks: ['', '', ''] });
  assert.equal(applyMove(lv, decodeStart(lv), 'd0'), null);
  assert.equal(dockAction(lv, decodeStart(lv), 0).reason, 'empty');
});

test('gates accept only their color', () => {
  const lv = board({ wheel: '....1.', docks: ['', '', ''] }, { gate: 2 });
  assert.equal(applyMove(lv, decodeStart(lv), 'd2'), null);
  assert.equal(dockAction(lv, decodeStart(lv), 2).reason, 'gate');
  const ok = board({ wheel: '....2.', docks: ['', '', ''] }, { gate: 2 });
  assert.ok(applyMove(ok, decodeStart(ok), 'd2'));
});

test('one-way wheel refuses counter-clockwise spins', () => {
  const lv = board({ wheel: '0.....', docks: ['', '', ''] }, { oneway: true });
  assert.equal(applyMove(lv, decodeStart(lv), 'ccw'), null);
  assert.deepEqual(moveIds(lv), ['cw', 'd0', 'd1', 'd2']);
});

test('moves never create or destroy lanterns', () => {
  const lv = board({ wheel: '0.1...', docks: ['01', '2', '21'] });
  let s = decodeStart(lv);
  const count = (st) => [...st.wheel.filter((c) => c !== EMPTY), ...st.docks.flat()].sort().join('');
  const before = count(s);
  const ids = moveIds(lv);
  for (let i = 0; i < 300; i++) {
    const next = applyMove(lv, s, ids[(i * 7) % ids.length]);
    if (next) s = next;
  }
  assert.equal(count(s), before);
});

test('win: wheel empty and each dock a single color', () => {
  const won = board({ wheel: '......', docks: ['000', '11', '2'] });
  assert.ok(isSolved(won, decodeStart(won)));
  const riding = board({ wheel: '1.....', docks: ['000', '1', '2'] });
  assert.equal(isSolved(riding, decodeStart(riding)), false, 'a lantern still on the wheel');
  const mixed = board({ wheel: '......', docks: ['001', '1', '2'] });
  assert.equal(isSolved(mixed, decodeStart(mixed)), false);
  const split = board({ wheel: '......', docks: ['00', '0', '111'] });
  assert.ok(isSolved(split, decodeStart(split)), 'a color may be spread over docks');
});

test('game: play, undo, restart and the move limit', () => {
  const g = new Game(board({ wheel: '.1....', docks: ['00', '', '11'] }, { limit: 3 }));
  const initial = stateKey(g.state);
  assert.equal(g.movesLeft, 3);
  assert.ok(g.play('cw'));
  const mid = stateKey(g.state);
  assert.ok(g.play(['cw', 'cw']));
  assert.equal(g.outOfMoves, true);
  assert.equal(g.play('cw'), false, 'no moves beyond the limit');
  g.undo();
  assert.equal(stateKey(g.state), mid);
  assert.equal(g.moveCount, 1);
  g.restart();
  assert.equal(stateKey(g.state), initial);
  assert.equal(g.moveCount, 0);
  assert.equal(g.history.length, 0);
  assert.equal(g.undo(), null);
});

test('game: illegal actions are rejected whole', () => {
  const g = new Game(board({ wheel: '......', docks: ['0', '', ''] }));
  assert.equal(g.play(['cw', 'd1']), false);
  assert.equal(g.moveCount, 0);
  assert.equal(g.history.length, 0);
});

test('game: no moves after solving', () => {
  const g = new Game(board({ wheel: '1.....', docks: ['00', '', '11'] }));
  // gondola 0 carries 1; spin it to the tower of 1s at seat 4 (2 ccw), drop
  assert.ok(g.play(['ccw', 'ccw', 'd2']));
  assert.ok(g.solved);
  assert.equal(g.play('cw'), false);
});

test('validateLevel catches broken levels', () => {
  assert.deepEqual(validateLevel(board({ wheel: '......', docks: ['001', '1', '2'] })), []);
  assert.match(validateLevel(board({ wheel: '.....', docks: ['', '', ''] })).join(), /size mismatch/);
  assert.match(validateLevel(board({ wheel: '......', docks: ['0000', '', ''] })).join(), /over capacity/);
  const gated = board({ wheel: '......', docks: ['0', '', '1'] }, { gate: 2 });
  assert.match(validateLevel(gated).join(), /gate violated/);
  // four of one color cannot fit when every dock holds 3 and two are needed for others
  const tight = board({ wheel: '0.....', docks: ['000', '111', '222'] });
  assert.match(validateLevel(tight).join(), /cannot be sorted/);
});

test('star thresholds', () => {
  assert.equal(starsFor(10, 10, 12), 3);
  assert.equal(starsFor(11, 10, 12), 2);
  assert.equal(starsFor(12, 10, 12), 1);
  assert.equal(starsFor(11, 10, 11), 2);
});
