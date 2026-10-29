// Lantern Wheel: deterministic level generator.
//
//   node tools/generate-levels.mjs
//
// For each level it builds a wheel and docks from the chapter's spec, deals
// lanterns (or, for very easy levels, scrambles a solved board), and keeps
// the board only if
//   1. the optimal A* solver finds a solution whose length ("par") matches
//      the chapter's difficulty curve, and
//   2. from level 10 on, the naive greedy strategy (tools/naive-player.mjs)
//      cannot finish within the move limit, so every level needs planning.
// Chapters and the daily pool are generated in parallel worker threads; each
// level has its own seed, so the output is deterministic.

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { EMPTY, applyMove, moveIds, isSolved, encodeState, validateLevel, dockComplete } from '../js/engine.js';
import { solve } from '../js/solver.js';
import { naivePlay } from './naive-player.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PER_CHAPTER = 25;

function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const randInt = (rng, a, b) => a + Math.floor(rng() * (b - a + 1));
const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];
function shuffle(rng, arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Choose dock positions: prefer gondolas near the top and bottom of the
 * wheel (tall boards fit phones; the renderer turns them for wide screens),
 * and keep docks at least `minSep` gondolas apart.
 */
function dockPositions(rng, seats, count) {
  const minSep = seats >= 8 ? 2 : 1;
  for (let attempt = 0; attempt < 200; attempt++) {
    const weight = (p) => Math.abs(Math.cos((2 * Math.PI * p) / seats)) + 0.35 + rng() * 0.5;
    const order = Array.from({ length: seats }, (_, p) => p).sort((a, b) => weight(b) - weight(a));
    const chosen = [];
    for (const p of order) {
      const ok = chosen.every((q) => {
        const d = Math.abs(p - q);
        return Math.min(d, seats - d) >= minSep;
      });
      if (ok) chosen.push(p);
      if (chosen.length === count) return chosen.sort((a, b) => a - b);
    }
  }
  return null;
}

/**
 * Build a level skeleton from a spec:
 *   seats, colors, per (lanterns per color), docks (count), piers, gates,
 *   oneway, extraCap (docks with one spare slot), onWheel (lanterns dealt
 *   onto the wheel)
 */
function buildLevel(spec, rng) {
  const at = dockPositions(rng, spec.seats, spec.docks);
  if (!at) return null;
  const docks = at.map((p) => ({ at: p, cap: spec.per, kind: 'tower' }));
  for (const i of shuffle(rng, docks.map((_, i) => i)).slice(0, spec.piers || 0)) docks[i].kind = 'pier';
  for (const i of shuffle(rng, docks.map((_, i) => i)).slice(0, spec.extraCap || 0)) docks[i].cap++;
  // a small spare dock: room to maneuver, but not enough to make it easy
  if (spec.spareCap) docks[Math.floor(rng() * docks.length)].cap = spec.spareCap;
  const colors = shuffle(rng, [0, 1, 2, 3, 4, 5]).slice(0, spec.colors);
  if (spec.gates) {
    // gated docks each take one distinct color
    shuffle(rng, docks.map((_, i) => i))
      .slice(0, spec.gates)
      .forEach((i, k) => (docks[i].gate = colors[k]));
  }
  return { seats: spec.seats, ...(spec.oneway ? { oneway: true } : {}), docks, colors };
}

/** Random deal: shuffle all lanterns into docks and onto the wheel. */
function deal(level, spec, rng) {
  const bag = shuffle(
    rng,
    level.colors.flatMap((c) => new Array(spec.per).fill(c)),
  );
  const wheel = new Array(level.seats).fill(EMPTY);
  const docks = level.docks.map(() => []);
  const free = shuffle(rng, Array.from({ length: level.seats }, (_, p) => p));
  let onWheel = spec.onWheel ?? 0;
  for (const c of bag) {
    if (onWheel > 0) {
      wheel[free.pop()] = c;
      onWheel--;
      continue;
    }
    const room = level.docks
      .map((d, i) => i)
      .filter((i) => docks[i].length < level.docks[i].cap && (level.docks[i].gate === undefined || level.docks[i].gate === c));
    if (!room.length) {
      if (!free.length) return null;
      wheel[free.pop()] = c;
      continue;
    }
    docks[pick(rng, room)].push(c);
  }
  return { wheel, docks };
}

/** Scramble a solved board with random legal moves (for the easiest levels). */
function scrambleSolved(level, spec, rng, k) {
  const docks = level.docks.map(() => []);
  // each color's home must be big enough to hold all of it
  const order = level.docks.map((_, i) => i).filter((i) => level.docks[i].gate === undefined && level.docks[i].cap >= spec.per);
  level.colors.forEach((c, ci) => {
    const gated = level.docks.findIndex((d) => d.gate === c);
    const i = gated >= 0 ? gated : order.shift();
    if (i === undefined) return;
    for (let j = 0; j < spec.per; j++) docks[i].push(c);
  });
  if (docks.flat().length !== level.colors.length * spec.per) return null;
  let s = { wheel: new Array(level.seats).fill(EMPTY), docks };
  const ids = moveIds(level);
  for (let i = 0; i < k; i++) {
    const legal = ids.map((id) => applyMove(level, s, id)).filter(Boolean);
    s = pick(rng, legal);
  }
  return s;
}

// ---------------------------------------------------------------------------
// Chapters
// ---------------------------------------------------------------------------

const CHAPTERS = [
  {
    name: 'First Lanterns',
    blurb: 'Drop, lift and spin.',
    lo: 1,
    hi: 12,
    slack: 3,
    spec: (i, rng) => ({ seats: 6, colors: 2, per: i < 12 ? 3 : randInt(rng, 3, 4), docks: 3, onWheel: randInt(rng, 0, 2) }),
  },
  {
    name: 'Festival Towers',
    blurb: 'Three colors, four towers.',
    lo: 10,
    hi: 17,
    slack: 2,
    spec: (i, rng) => ({ seats: 6, colors: 3, per: i < 10 ? 3 : 4, docks: 4, spareCap: randInt(rng, 1, 2), onWheel: randInt(rng, 0, 2) }),
  },
  {
    name: 'The Piers',
    blurb: 'Piers are queues: first in, first out.',
    intro: 'pier',
    lo: 11,
    hi: 18,
    slack: 2,
    spec: (i, rng) => ({ seats: 8, colors: 3, per: randInt(rng, 3, 4), docks: 4, piers: i < 10 ? 1 : randInt(rng, 1, 2), onWheel: randInt(rng, 0, 2) }),
  },
  {
    name: 'Clockwise Night',
    blurb: 'The wheel only turns clockwise.',
    intro: 'oneway',
    lo: 11,
    hi: 19,
    slack: 2,
    spec: (i, rng) => ({ seats: pick(rng, [6, 8]), colors: 3, per: 3, docks: 4, oneway: true, piers: i < 12 ? 0 : randInt(rng, 0, 1), onWheel: randInt(rng, 0, 2) }),
  },
  {
    name: 'Color Gates',
    blurb: 'Gated docks accept only their own color.',
    intro: 'gate',
    lo: 12,
    hi: 20,
    slack: 2,
    spec: (i, rng) => ({ seats: 8, colors: 3, per: randInt(rng, 3, 4), docks: 4, gates: i < 12 ? 1 : 2, piers: randInt(rng, 0, 1), onWheel: randInt(rng, 0, 2) }),
  },
  {
    name: 'Tight Wheel',
    blurb: 'No spare dock: park lanterns on the wheel.',
    intro: 'tight',
    lo: 12,
    hi: 21,
    slack: 2,
    spec: (i, rng) => ({ seats: 6, colors: 3, per: 3, docks: 3, extraCap: randInt(rng, 1, 3), piers: randInt(rng, 0, 1), onWheel: randInt(rng, 1, 3) }),
  },
  {
    name: 'Lantern Parade',
    blurb: 'Four colors on a bigger wheel.',
    lo: 13,
    hi: 22,
    slack: 2,
    spec: (i, rng) => ({ seats: 10, colors: 4, per: 3, docks: 5, extraCap: 1, piers: randInt(rng, 1, 2), gates: randInt(rng, 0, 1), onWheel: randInt(rng, 0, 1) }),
  },
  {
    name: 'Grand Festival',
    blurb: 'Every rule at once.',
    lo: 15,
    hi: 24,
    slack: 2,
    spec: (i, rng) => {
      const four = rng() < 0.4;
      return {
        seats: four ? 10 : pick(rng, [6, 8]),
        colors: four ? 4 : 3,
        per: four ? 3 : randInt(rng, 3, 4),
        docks: four ? 5 : pick(rng, [3, 4]),
        extraCap: randInt(rng, 1, 2),
        piers: randInt(rng, 1, 2),
        gates: randInt(rng, 0, 1),
        oneway: rng() < 0.5,
        onWheel: randInt(rng, 0, 2),
      };
    },
  },
];

const DAILY_COUNT = 30;
const DAILY = {
  slack: 2,
  target: (i) => 17 + (i % 5),
  spec: (i, rng) => CHAPTERS[1 + (i % 7)].spec(20, rng),
};

const target = (ch, i) => Math.round(CHAPTERS[ch].lo + ((CHAPTERS[ch].hi - CHAPTERS[ch].lo) * i) / (PER_CHAPTER - 1));

// Scripted tutorial boards.
const TUTORIAL = {
  1: {
    par: 1,
    level: { seats: 6, docks: [{ at: 0, cap: 3, kind: 'tower' }, { at: 2, cap: 3, kind: 'tower' }, { at: 4, cap: 3, kind: 'tower' }] },
    start: { wheel: '0.....', docks: ['00', '111', ''] },
  },
  2: {
    par: 2,
    level: { seats: 6, docks: [{ at: 0, cap: 3, kind: 'tower' }, { at: 2, cap: 3, kind: 'tower' }, { at: 4, cap: 3, kind: 'tower' }] },
    start: { wheel: '.....1', docks: ['000', '11', ''] },
  },
  3: {
    par: 4,
    level: { seats: 6, docks: [{ at: 0, cap: 3, kind: 'tower' }, { at: 2, cap: 3, kind: 'tower' }, { at: 4, cap: 3, kind: 'tower' }] },
    start: { wheel: '......', docks: ['001', '11', '0'] },
  },
};

function makeLevel({ id, seed, t, slack, specFn, extra, tricky, fixed }) {
  const rng = mulberry32(seed);
  let best = null;
  const cost = (c) => Math.abs(c.sol.length - t) + (tricky && !c.tricky ? 100 : 0);
  const deadline = Date.now() + 120_000; // per-level search budget
  for (let attempt = 0; attempt < (fixed ? 1 : 500); attempt++) {
    if (best && Date.now() > deadline) break;
    let level;
    let state;
    let spec = null;
    if (fixed) {
      level = { seats: fixed.level.seats, docks: fixed.level.docks.map((d) => ({ ...d })) };
      state = { wheel: [...fixed.start.wheel].map((c) => (c === '.' ? EMPTY : +c)), docks: fixed.start.docks.map((d) => [...d].map(Number)) };
    } else {
      spec = specFn(rng);
      level = buildLevel(spec, rng);
      if (!level) continue;
      // easy targets: scramble a solved board; harder ones: mix scrambles
      // (structured, tractable) with fully random deals (wild)
      const scramble = t <= 9 || rng() < 0.6;
      state = scramble ? scrambleSolved(level, spec, rng, randInt(rng, t, Math.round(t * 2.5) + 2)) : deal(level, spec, rng);
      if (!state) continue;
      delete level.colors;
    }
    if (isSolved(level, state)) continue;
    if (!fixed && level.docks.some((_, i) => dockComplete(level, state, i))) continue;
    const sol = solve(level, state, { maxNodes: 250_000 });
    if (!sol) continue;
    const tol = attempt < 200 ? 0 : attempt < 380 ? 1 : 2;
    // a tricky board a little off the curve beats an obvious one right on it
    if (!fixed && Math.abs(sol.length - t) > 3 && best) continue;
    const cand = { level, state, sol, spec, tricky: naivePlay(level, state, 90) > sol.length + slack };
    if (!best || cost(cand) < cost(best)) best = cand;
    if (fixed ? sol.length === fixed.par : Math.abs(sol.length - t) <= tol && (!tricky || cand.tricky)) {
      best = cand;
      break;
    }
  }
  if (!best) throw new Error(`could not build level ${id}`);
  if (tricky && !best.tricky) console.warn(`warning: level ${id} is beatable by naive play`);
  const { level, state, sol } = best;
  const out = {
    id,
    ...extra,
    seats: level.seats,
    ...(level.oneway ? { oneway: true } : {}),
    docks: level.docks,
    start: encodeState(state),
    par: sol.length,
    limit: sol.length + slack,
    solution: sol.path,
  };
  const errs = validateLevel(out);
  if (errs.length) throw new Error(`level ${id}: ${errs.join(', ')}`);
  console.log(`${id} par=${out.par} (target ${t})${best.tricky ? '' : ' [naive-beatable]'}`);
  return { out, t, tricky: best.tricky };
}

const PART = 5;

function runJob(job) {
  if (typeof job === 'string' && job.includes(':')) {
    const [ch, part] = job.split(':').map(Number);
    return Array.from({ length: PART }, (_, k) => {
      const i = part * PART + k;
      const id = ch * PER_CHAPTER + i + 1;
      // if no tricky board turned up, search again from fresh seeds
      let r;
      for (let round = 0; round < 5; round++) {
        r = makeLevel({ id, seed: 2000 + id * 7919 + round * 1_000_003, t: target(ch, i), slack: CHAPTERS[ch].slack, specFn: (rng) => CHAPTERS[ch].spec(i, rng), extra: { chapter: ch }, tricky: id >= 10, fixed: TUTORIAL[id] });
        if (id < 10 || r.tricky) break;
      }
      return r;
    });
  }
  if (job === 'daily') {
    return Array.from({ length: DAILY_COUNT }, (_, i) =>
      makeLevel({ id: `d${i + 1}`, seed: 555_000 + i * 104_729, t: DAILY.target(i), slack: DAILY.slack, specFn: (rng) => DAILY.spec(i, rng), extra: { daily: true }, tricky: true }),
    );
  }
  return Array.from({ length: PER_CHAPTER }, (_, i) => {
    const id = job * PER_CHAPTER + i + 1;
    return makeLevel({
      id,
      seed: 2000 + id * 7919,
      t: target(job, i),
      slack: CHAPTERS[job].slack,
      specFn: (rng) => CHAPTERS[job].spec(i, rng),
      extra: { chapter: job },
      tricky: id >= 10,
      fixed: TUTORIAL[id],
    });
  });
}

// Finished jobs are cached so an interrupted run can resume (--fresh ignores the cache).
const CACHE = join(ROOT, 'tools', '.cache');
const cacheFile = (job) => join(CACHE, `job-${String(job).replace(':', 'p')}-${job === 'daily' ? DAILY_COUNT : String(job).includes(':') ? PART : PER_CHAPTER}.json`);

export { CHAPTERS, buildLevel, deal, scrambleSolved, target, mulberry32, makeLevel };
const IS_CLI = !isMainThread || process.argv[1] === fileURLToPath(import.meta.url);

if (!IS_CLI) {
  // imported as a module (diagnostics): do nothing
} else if (!isMainThread) {
  const res = runJob(workerData);
  mkdirSync(CACHE, { recursive: true });
  writeFileSync(cacheFile(workerData), JSON.stringify(res));
  parentPort.postMessage(res);
} else {
  const t0 = Date.now();
  const fresh = process.argv.includes('--fresh');
  const results = new Map();
  const jobs = [];
  for (const job of ['daily', ...CHAPTERS.map((_, c) => c).reverse()]) {
    if (!fresh && existsSync(cacheFile(job))) {
      results.set(job, JSON.parse(readFileSync(cacheFile(job), 'utf8')));
      continue;
    }
    if (job === 'daily') {
      jobs.push(job);
      continue;
    }
    // chapters run as five parts of five levels each
    for (let part = 0; part < PER_CHAPTER / PART; part++) {
      const pj = `${job}:${part}`;
      if (!fresh && existsSync(cacheFile(pj))) results.set(pj, JSON.parse(readFileSync(cacheFile(pj), 'utf8')));
      else jobs.push(pj);
    }
  }
  if (results.size) console.log(`cached: ${[...results.keys()].join(', ')}`);
  const width = Math.max(1, Math.min(jobs.length, availableParallelism?.() || 4));
  let next = 0;
  await new Promise((resolve, reject) => {
    let running = 0;
    const launch = () => {
      if (next >= jobs.length) {
        if (!running) resolve();
        return;
      }
      const job = jobs[next++];
      running++;
      const w = new Worker(fileURLToPath(import.meta.url), { workerData: job, resourceLimits: { maxOldGenerationSizeMb: 3072 } });
      w.once('message', (res) => {
        results.set(job, res);
        console.log(`job ${job} done`);
      });
      w.once('error', reject);
      w.once('exit', () => {
        running--;
        launch();
      });
    };
    if (!jobs.length) resolve();
    for (let i = 0; i < width; i++) launch();
  });
  const chapterResults = (c) => results.get(c) || Array.from({ length: PER_CHAPTER / PART }, (_, p) => results.get(`${c}:${p}`)).flat();
  const levels = CHAPTERS.flatMap((_, c) => chapterResults(c).map((r) => r.out));
  const daily = results.get('daily').map((r) => r.out);
  const chapters = CHAPTERS.map(({ name, blurb, intro }) => ({ name, blurb, ...(intro ? { intro } : {}) }));
  const rows = (arr) => arr.map((l) => '  ' + JSON.stringify(l)).join(',\n');
  writeFileSync(
    join(ROOT, 'js', 'levels.js'),
    `// Generated by tools/generate-levels.mjs. Do not edit by hand.
// ${levels.length} levels, each solved optimally: "par" is the fewest moves,
// "limit" the move budget, "solution" one optimal solution.

export const CHAPTERS = ${JSON.stringify(chapters, null, 1)};

export const LEVELS = [
${rows(levels)}
];
`,
  );
  writeFileSync(
    join(ROOT, 'js', 'daily.js'),
    `// Generated by tools/generate-levels.mjs. Do not edit by hand.
// Pool of ${daily.length} daily puzzles; the game picks one per calendar day.

export const DAILY = [
${rows(daily)}
];
`,
  );
  console.log(`Wrote ${levels.length} levels + ${daily.length} daily puzzles in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}
