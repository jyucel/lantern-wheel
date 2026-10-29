// Saved progress: unlocking, stars, persistence, robustness.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Progress, LOOKAHEAD, START_HINTS, MAX_HINTS, dayKey, dayDiff } from '../js/progress.js';

class MemoryStorage {
  constructor() {
    this.map = new Map();
  }
  getItem(k) {
    return this.map.has(k) ? this.map.get(k) : null;
  }
  setItem(k, v) {
    this.map.set(k, String(v));
  }
}

test('fresh progress unlocks only the first levels', () => {
  const p = new Progress(new MemoryStorage(), 200);
  for (let id = 1; id <= LOOKAHEAD; id++) assert.ok(p.isUnlocked(id));
  assert.equal(p.isUnlocked(LOOKAHEAD + 1), false);
  assert.equal(p.isUnlocked(0), false);
  assert.equal(p.isUnlocked(201), false);
  assert.equal(p.continueLevel(), 1);
});

test('solving a level unlocks the next ones', () => {
  const p = new Progress(new MemoryStorage(), 200);
  p.recordWin(1, 1, 1);
  assert.ok(p.isUnlocked(4));
  assert.equal(p.isUnlocked(5), false);
  p.recordWin(4, 10, 3);
  assert.ok(p.isUnlocked(7));
  assert.equal(p.isUnlocked(8), false);
});

test('progression through all levels in order keeps the next level unlocked', () => {
  const p = new Progress(new MemoryStorage(), 200);
  for (let id = 1; id <= 200; id++) {
    assert.ok(p.isUnlocked(id), `level ${id} locked`);
    p.recordWin(id, 5, 5);
  }
  assert.equal(p.firstUnsolved(), null);
  assert.equal(p.solvedCount(), 200);
  assert.equal(p.totalStars(), 600);
});

test('stars and best moves only improve', () => {
  const p = new Progress(new MemoryStorage(), 200);
  let r = p.recordWin(2, 9, 4);
  assert.equal(r.stars, 1);
  assert.ok(r.newBest);
  r = p.recordWin(2, 4, 4);
  assert.equal(r.stars, 3);
  assert.equal(r.prevBest, 9);
  r = p.recordWin(2, 12, 4);
  assert.equal(r.stars, 1);
  assert.equal(r.newBest, false);
  assert.equal(p.stars(2), 3);
  assert.equal(p.best(2), 4);
});

test('progress persists across sessions', () => {
  const store = new MemoryStorage();
  const a = new Progress(store, 200);
  a.recordWin(1, 1, 1);
  a.recordWin(2, 3, 2);
  a.setSetting('music', false);
  a.markSeen('locked');
  a.setLast(3);
  const b = new Progress(store, 200);
  assert.equal(b.stars(1), 3);
  assert.equal(b.stars(2), 2);
  assert.equal(b.setting('music'), false);
  assert.equal(b.setting('sfx'), true);
  assert.ok(b.hasSeen('locked'));
  assert.equal(b.continueLevel(), 3);
});

test('continue skips to the first unsolved level when the last one is done', () => {
  const p = new Progress(new MemoryStorage(), 200);
  p.recordWin(1, 1, 1);
  p.setLast(1);
  assert.equal(p.continueLevel(), 2);
});

test('corrupt or missing storage never throws', () => {
  const store = new MemoryStorage();
  store.setItem('lantern-wheel.v1', '{not json');
  const p = new Progress(store, 200);
  assert.equal(p.solvedCount(), 0);
  const q = new Progress(null, 200);
  q.recordWin(1, 1, 1);
  assert.equal(q.stars(1), 3);
  const throwing = {
    getItem() {
      throw new Error('blocked');
    },
    setItem() {
      throw new Error('blocked');
    },
  };
  const t = new Progress(throwing, 200);
  t.recordWin(1, 1, 1);
  assert.equal(t.stars(1), 3);
});

test('reset clears progress but keeps settings', () => {
  const p = new Progress(new MemoryStorage(), 200);
  p.recordWin(1, 1, 1);
  p.setSetting('sfx', false);
  p.reset();
  assert.equal(p.solvedCount(), 0);
  assert.equal(p.setting('sfx'), false);
});

test('hints: start with a few, spend them, earn one per first three-star finish', () => {
  const p = new Progress(new MemoryStorage(), 200);
  assert.equal(p.hints, START_HINTS);
  assert.ok(p.useHint());
  assert.equal(p.hints, START_HINTS - 1);
  let r = p.recordWin(5, 9, 6, 10); // 1 star: no hint
  assert.equal(r.hintEarned, false);
  r = p.recordWin(5, 6, 6, 10); // first 3 stars
  assert.equal(r.hintEarned, true);
  assert.equal(p.hints, START_HINTS);
  r = p.recordWin(5, 6, 6, 10); // repeat: nothing
  assert.equal(r.hintEarned, false);
  while (p.useHint());
  assert.equal(p.hints, 0);
  assert.equal(p.useHint(), false);
  for (let i = 0; i < 20; i++) p.addHint();
  assert.equal(p.hints, MAX_HINTS, 'hints are capped');
});

test('daily streak counts consecutive days and resets after a gap', () => {
  const p = new Progress(new MemoryStorage(), 200);
  assert.equal(p.dailyStreak('2026-03-01'), 0);
  let r = p.recordDaily('2026-03-01', 12, 12, 16);
  assert.deepEqual([r.streak, r.first, r.stars], [1, true, 3]);
  assert.ok(p.dailyDone('2026-03-01'));
  assert.equal(p.dailyDone('2026-03-02'), false);
  r = p.recordDaily('2026-03-01', 11, 12, 16); // replay same day
  assert.equal(r.first, false);
  assert.equal(r.streak, 1);
  p.recordDaily('2026-03-02', 14, 12, 16);
  r = p.recordDaily('2026-03-03', 16, 12, 16);
  assert.equal(r.streak, 3);
  assert.equal(p.dailyStreak('2026-03-04'), 3, 'still alive the next day');
  assert.equal(p.dailyStreak('2026-03-05'), 0, 'broken after a missed day');
  r = p.recordDaily('2026-03-06', 12, 12, 16);
  assert.equal(r.streak, 1);
  assert.equal(p.data.daily.bestStreak, 3);
  // across a month boundary
  p.recordDaily('2026-03-31', 12, 12, 16);
  assert.equal(p.recordDaily('2026-04-01', 12, 12, 16).streak, 2);
});

test('day helpers', () => {
  assert.equal(dayKey(new Date(2026, 0, 5)), '2026-01-05');
  assert.equal(dayDiff('2026-02-28', '2026-03-01'), 1);
  assert.equal(dayDiff('2025-12-31', '2026-01-01'), 1);
});

test('older saves without hints or daily data load with defaults', () => {
  const store = new MemoryStorage();
  store.setItem('lantern-wheel.v1', JSON.stringify({ v: 1, stars: { 1: 3 }, best: {}, seen: {}, last: 2, settings: {} }));
  const p = new Progress(store, 200);
  assert.equal(p.stars(1), 3);
  assert.equal(p.hints, START_HINTS);
  assert.equal(p.dailyStreak('2026-01-01'), 0);
});
