// Every shipped level and daily puzzle: valid, solvable through the game
// rules, par proven optimal, tight limits, rising difficulty, and not
// solvable by the naive greedy strategy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LEVELS, CHAPTERS } from '../js/levels.js';
import { DAILY } from '../js/daily.js';
import { Game, decodeStart, isSolved, validateLevel, stateKey } from '../js/engine.js';
import { solve } from '../js/solver.js';
import { naivePlay } from '../tools/naive-player.mjs';

const ALL = [...LEVELS, ...DAILY];

test('200 levels in 8 chapters of 25, sequential ids', () => {
  assert.equal(LEVELS.length, 200);
  assert.equal(CHAPTERS.length, 8);
  LEVELS.forEach((l, i) => {
    assert.equal(l.id, i + 1);
    assert.equal(l.chapter, Math.floor(i / 25));
  });
});

test('every level and daily puzzle is structurally valid and starts unsolved', () => {
  for (const l of ALL) {
    assert.deepEqual(validateLevel(l), [], `level ${l.id}`);
    assert.equal(isSolved(l, decodeStart(l)), false, `level ${l.id} starts solved`);
  }
});

test('the stored solution solves every level through the game rules in exactly par moves', () => {
  for (const l of ALL) {
    const g = new Game(l);
    assert.equal(l.solution.length, l.par, `level ${l.id}`);
    l.solution.forEach((id, i) => {
      assert.equal(g.solved, false, `level ${l.id} solved early at step ${i}`);
      assert.ok(g.play(id), `level ${l.id}: illegal move ${id} at step ${i}`);
    });
    assert.ok(g.solved, `level ${l.id}: solution does not solve`);
  }
});

test('the A* solver independently proves every par optimal', { timeout: 3_600_000 }, () => {
  for (const l of ALL) {
    const res = solve(l, decodeStart(l), { maxNodes: 1_500_000 });
    assert.ok(res, `level ${l.id}: solver found no solution`);
    assert.equal(res.length, l.par, `level ${l.id}: optimal ${res.length} != par ${l.par}`);
    const g = new Game(l);
    assert.ok(g.play(res.path) && g.solved, `level ${l.id}: solver path invalid`);
  }
});

test('the obvious greedy strategy fails on every level from 10 on and every daily', { timeout: 600_000 }, () => {
  const easy = ALL.filter((l) => (l.daily || l.id >= 10) && naivePlay(l, decodeStart(l), 90) <= l.limit).map((l) => l.id);
  assert.deepEqual(easy, []);
});

test('move limits are tight: par + 2 (par + 3 in the first chapter)', () => {
  for (const l of ALL) {
    const margin = l.limit - l.par;
    assert.ok(margin >= 2 && margin <= 3, `level ${l.id}: margin ${margin}`);
    if (!l.daily && l.chapter > 0) assert.equal(margin, 2);
  }
});

test('difficulty climbs: chapters ramp and later chapters are longer', () => {
  const avg = CHAPTERS.map((_, c) => LEVELS.filter((l) => l.chapter === c).reduce((a, l) => a + l.par, 0) / 25);
  for (let c = 1; c < avg.length; c++) assert.ok(avg[c] >= avg[c - 1] - 1.5, `chapter ${c + 1} much easier than ${c}`);
  assert.ok(avg.at(-1) > avg[0] + 8);
  for (let c = 0; c < CHAPTERS.length; c++) {
    const ls = LEVELS.filter((l) => l.chapter === c);
    const early = ls.slice(0, 5).reduce((a, l) => a + l.par, 0) / 5;
    const late = ls.slice(-5).reduce((a, l) => a + l.par, 0) / 5;
    assert.ok(late > early + 2, `chapter ${c + 1} does not ramp`);
  }
  assert.ok(LEVELS.filter((l) => l.chapter >= 1).every((l) => l.par >= 9), 'no short levels after chapter 1');
  assert.ok(DAILY.every((d) => d.par >= 15), 'daily puzzles are hard');
});

test('rules appear from their chapter on', () => {
  const first = (pred) => LEVELS.find(pred)?.chapter;
  assert.equal(first((l) => l.docks.some((d) => d.kind === 'pier')), 2);
  assert.equal(first((l) => l.oneway), 3);
  assert.equal(first((l) => l.docks.some((d) => d.gate !== undefined)), 4);
});

test('tutorial levels', () => {
  assert.deepEqual(LEVELS.slice(0, 3).map((l) => l.par), [1, 2, 4]);
});

test('levels are distinct', () => {
  const keys = new Set(ALL.map((l) => JSON.stringify([l.seats, l.oneway, l.docks, stateKey(decodeStart(l))])));
  assert.equal(keys.size, ALL.length);
});
