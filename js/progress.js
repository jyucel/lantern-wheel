// Lantern Wheel: saved progress and settings (localStorage).
// The storage object is injected so the logic can be tested in Node.

import { starsFor } from './engine.js';

const KEY = 'lantern-wheel.v1';
export const LOOKAHEAD = 3; // levels playable beyond the last solved one
export const START_HINTS = 3;
export const MAX_HINTS = 9;

/** Local calendar date as YYYY-MM-DD. */
export function dayKey(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

/** Whole days between two YYYY-MM-DD keys (b - a). */
export function dayDiff(a, b) {
  const t = (k) => Date.UTC(+k.slice(0, 4), +k.slice(5, 7) - 1, +k.slice(8, 10));
  return Math.round((t(b) - t(a)) / 86_400_000);
}

function defaults() {
  return {
    v: 1,
    stars: {}, // level id -> best star count
    best: {}, // level id -> fewest moves
    seen: {}, // one-time intros already shown
    last: 1, // last level played
    hints: START_HINTS, // earned hint tokens
    daily: { solved: {}, streak: 0, bestStreak: 0, lastDay: null },
    settings: { sfx: true, music: true, glyphs: true },
  };
}

export class Progress {
  constructor(storage, totalLevels) {
    this.storage = storage;
    this.total = totalLevels;
    this.data = defaults();
    try {
      const raw = storage && storage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.v === 1) {
          const d = defaults();
          this.data = { ...d, ...parsed, settings: { ...d.settings, ...parsed.settings }, daily: { ...d.daily, ...parsed.daily } };
        }
      }
    } catch {
      // corrupt or blocked storage: start fresh
    }
  }

  save() {
    try {
      this.storage && this.storage.setItem(KEY, JSON.stringify(this.data));
    } catch {
      // storage full or unavailable; progress stays in memory
    }
  }

  stars(id) {
    return this.data.stars[id] || 0;
  }

  best(id) {
    return this.data.best[id] ?? null;
  }

  isSolved(id) {
    return this.stars(id) > 0;
  }

  /** A level is playable if it is among the first few or close after a solved one. */
  isUnlocked(id) {
    if (id < 1 || id > this.total) return false;
    if (id <= LOOKAHEAD) return true;
    for (let k = 1; k <= LOOKAHEAD; k++) if (this.isSolved(id - k)) return true;
    return this.isSolved(id);
  }

  /**
   * Record a finished level. Returns the stars earned, whether it was a
   * record, and whether a hint token was earned (first three-star finish).
   */
  recordWin(id, moves, par, limit) {
    const stars = starsFor(moves, par, limit);
    const prevBest = this.best(id);
    const newBest = prevBest === null || moves < prevBest;
    const prevStars = this.stars(id);
    if (newBest) this.data.best[id] = moves;
    if (stars > prevStars) this.data.stars[id] = stars;
    const hintEarned = stars === 3 && prevStars < 3 && this.addHint();
    this.save();
    return { stars, newBest, prevBest, hintEarned };
  }

  get hints() {
    return this.data.hints;
  }

  /** Grant a hint token (capped). Returns true if one was added. */
  addHint() {
    if (this.data.hints >= MAX_HINTS) return false;
    this.data.hints++;
    this.save();
    return true;
  }

  /** Spend a hint token. Returns false when none are left. */
  useHint() {
    if (this.data.hints <= 0) return false;
    this.data.hints--;
    this.save();
    return true;
  }

  // ---- daily puzzle ---------------------------------------------------------

  dailyDone(day = dayKey()) {
    return !!this.data.daily.solved[day];
  }

  /** Current streak, counting only if it is still alive today. */
  dailyStreak(today = dayKey()) {
    const d = this.data.daily;
    if (!d.lastDay) return 0;
    return dayDiff(d.lastDay, today) <= 1 ? d.streak : 0;
  }

  recordDaily(day, moves, par, limit) {
    const d = this.data.daily;
    const stars = starsFor(moves, par, limit);
    const first = !d.solved[day];
    d.solved[day] = Math.max(d.solved[day] || 0, stars);
    if (first) {
      d.streak = d.lastDay && dayDiff(d.lastDay, day) === 1 ? d.streak + 1 : 1;
      d.lastDay = day;
      d.bestStreak = Math.max(d.bestStreak, d.streak);
      this.addHint();
    }
    this.save();
    return { stars, streak: d.streak, first };
  }

  setLast(id) {
    this.data.last = id;
    this.save();
  }

  firstUnsolved() {
    for (let id = 1; id <= this.total; id++) if (!this.isSolved(id)) return id;
    return null;
  }

  /** Level to open from the "Play" button. */
  continueLevel() {
    const last = this.data.last;
    if (last && this.isUnlocked(last) && !this.isSolved(last)) return last;
    return this.firstUnsolved() ?? this.total;
  }

  totalStars() {
    return Object.values(this.data.stars).reduce((a, b) => a + b, 0);
  }

  solvedCount() {
    return Object.keys(this.data.stars).length;
  }

  markSeen(key) {
    this.data.seen[key] = true;
    this.save();
  }

  hasSeen(key) {
    return !!this.data.seen[key];
  }

  setting(name) {
    return this.data.settings[name];
  }

  setSetting(name, value) {
    this.data.settings[name] = value;
    this.save();
  }

  reset() {
    const settings = this.data.settings;
    this.data = defaults();
    this.data.settings = settings;
    this.save();
  }
}
