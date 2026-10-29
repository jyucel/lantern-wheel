// End-to-end tests: drive the real game in a browser with real input.
import { test, expect } from '@playwright/test';

const KEY = 'lantern-wheel.v1';

async function seedProgress(page, upTo, extra = {}) {
  await page.addInitScript(
    ([key, n, extra]) => {
      const stars = {};
      for (let i = 1; i <= n; i++) stars[i] = 3;
      localStorage.setItem(key, JSON.stringify({ v: 1, stars, best: {}, seen: extra.seen || {}, last: 1, settings: { sfx: true, music: false, glyphs: true } }));
    },
    [KEY, upTo, extra],
  );
}

function trackErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('Navigated away from page')) errors.push(m.text());
  });
  return errors;
}

async function openLevel(page, id) {
  await page.goto(`./#level=${id}`);
  await expect(page.locator('#screen-game')).toHaveClass(/active/);
  await expect(page.locator('#hud-level')).toHaveText(`Level ${id}`);
  if (await page.locator('#modal-intro').isVisible()) await page.click('#intro-ok');
  await page.waitForTimeout(150);
}

const state = (page) =>
  page.evaluate(() => {
    const g = window.__wheel.game;
    const k = (s) => s.wheel.join(',') + '|' + s.docks.map((d) => d.join('')).join(',');
    return { key: k(g.state), initial: k(g.initial), moves: g.moveCount, solved: g.solved };
  });

/** Perform a move through real input: tap docks on the board, spins via the buttons. */
async function input(page, id, touch) {
  if (id === 'cw' || id === 'ccw') {
    const btn = page.locator(id === 'cw' ? '#btn-cw' : '#btn-ccw');
    if (touch) await btn.tap();
    else await btn.click();
    return;
  }
  const p = await page.evaluate((id) => window.__wheel.view.clientPointFor(id), id);
  if (touch) await page.touchscreen.tap(p.x, p.y);
  else await page.mouse.click(p.x, p.y);
}

/** Drag the wheel by `steps` gondolas with the mouse (negative = counter-clockwise). */
async function dragWheel(page, steps) {
  const g = await page.evaluate(() => {
    const v = window.__wheel.view;
    const r = v.canvas.getBoundingClientRect();
    const [cx, cy] = v.px(0, 0);
    return { cx: r.left + cx, cy: r.top + cy, R: v.R * v.s * 0.7, n: v.level.seats };
  });
  const a0 = 0.4;
  const total = (steps * 2 * Math.PI) / g.n;
  const pt = (a) => [g.cx + Math.cos(a) * g.R, g.cy + Math.sin(a) * g.R];
  await page.mouse.move(...pt(a0));
  await page.mouse.down();
  for (let i = 1; i <= 8 * Math.abs(steps); i++) await page.mouse.move(...pt(a0 + (total * i) / (8 * Math.abs(steps))));
  await page.mouse.up();
}

test('title screen loads cleanly under a sub-path', async ({ page }) => {
  const errors = trackErrors(page);
  const failed = [];
  page.on('response', (r) => r.status() >= 400 && failed.push(`${r.status()} ${r.url()}`));
  await page.goto('./');
  await expect(page.locator('h1.logo')).toContainText('Lantern');
  await expect(page.locator('#title-stats')).toContainText('200 puzzles');
  await expect(page.locator('#btn-daily')).toBeVisible();
  await page.waitForTimeout(300);
  expect(failed).toEqual([]);
  expect(errors).toEqual([]);
});

test('tutorial: levels 1-3 through real input, progress saved', async ({ page, isMobile }) => {
  const errors = trackErrors(page);
  await page.goto('./');
  await page.click('#btn-play');
  await expect(page.locator('#hud-level')).toHaveText('Level 1');
  await expect(page.locator('#coach')).toContainText('one color');
  await expect(page.locator('#hand')).toBeVisible();
  for (let id = 1; id <= 3; id++) {
    const sol = await page.evaluate(() => window.__wheel.level.solution);
    for (const mv of sol) await input(page, mv, isMobile);
    await expect(page.locator('#modal-win')).toBeVisible();
    await expect(page.locator('#win-stars svg.on')).toHaveCount(3);
    await page.click('#win-next');
    await expect(page.locator('#hud-level')).toHaveText(`Level ${id + 1}`);
  }
  const saved = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)), KEY);
  expect(saved.stars).toMatchObject({ 1: 3, 2: 3, 3: 3 });
  await page.goto('./');
  await page.click('#btn-levels');
  await expect(page.locator('.lvl[data-level="3"]')).toHaveClass(/solved/);
  await expect(page.locator('.lvl[data-level="6"]')).toBeEnabled();
  await expect(page.locator('.lvl[data-level="7"]')).toBeDisabled();
  expect(errors).toEqual([]);
});

for (const id of [9, 37, 61, 88, 112, 140, 163, 200]) {
  test(`level ${id} can be solved at par through real input`, async ({ page, isMobile }) => {
    const errors = trackErrors(page);
    await seedProgress(page, id - 1);
    await openLevel(page, id);
    const { solution, par } = await page.evaluate(() => window.__wheel.level);
    for (const mv of solution) {
      expect((await state(page)).solved).toBe(false);
      await input(page, mv, isMobile);
    }
    await expect(page.locator('#modal-win')).toBeVisible();
    await expect(page.locator('#win-detail')).toContainText(`${par} move`);
    await expect(page.locator('#win-stars svg.on')).toHaveCount(3);
    const saved = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)), KEY);
    expect(saved.best[String(id)]).toBe(par);
    if (id === 200) await expect(page.locator('#win-next')).toBeHidden();
    expect(errors).toEqual([]);
  });
}

test('undo and restart restore earlier states', async ({ page, isMobile }) => {
  await seedProgress(page, 30);
  await openLevel(page, 30);
  const s0 = await state(page);
  await input(page, 'cw', isMobile);
  await input(page, 'cw', isMobile);
  const s2 = await state(page);
  expect(s2.moves).toBe(2);
  await page.click('#btn-undo');
  expect((await state(page)).moves).toBe(1);
  await page.click('#btn-undo');
  expect(await state(page)).toEqual(s0);
  await input(page, 'ccw', isMobile);
  await page.click('#btn-restart');
  expect(await state(page)).toEqual(s0);
});

test('dragging the wheel spins it and counts each gondola as a move', async ({ page, isMobile }) => {
  test.skip(isMobile, 'mouse drag');
  await seedProgress(page, 30);
  await openLevel(page, 30);
  const expected = await page.evaluate(() => {
    const g = window.__wheel.game;
    const n = g.state.wheel.length;
    const w = g.state.wheel;
    return Array.from({ length: n }, (_, k) => w[(k - 2 + n) % n]).join(',');
  });
  await dragWheel(page, 2);
  const s = await state(page);
  expect(s.moves).toBe(2);
  expect(s.key.split('|')[0]).toBe(expected);
});

test('invalid dock taps explain themselves and change nothing', async ({ page, isMobile }) => {
  await seedProgress(page, 30);
  await openLevel(page, 30);
  // find a dock whose tap is invalid, or make one: spin until a full dock faces a lantern, else an empty pair
  const target = await page.evaluate(() => {
    const { level, game } = window.__wheel;
    for (let i = 0; i < level.docks.length; i++) if (!game.canPlay(`d${i}`)) return `d${i}`;
    return null;
  });
  test.skip(!target, 'every dock is tappable at the start of this level');
  const s0 = await state(page);
  await input(page, target, isMobile);
  await expect(page.locator('#toast')).toHaveClass(/show/);
  expect(await state(page)).toEqual(s0);
});

test('running out of moves blocks play until undo or restart', async ({ page, isMobile }) => {
  await seedProgress(page, 40);
  await openLevel(page, 40);
  const limit = await page.evaluate(() => window.__wheel.level.limit);
  for (let i = 0; i < limit; i++) await page.evaluate(() => window.__wheel.act(['cw']));
  await expect(page.locator('#modal-out')).toBeVisible();
  await page.click('#out-undo');
  await expect(page.locator('#modal-out')).toBeHidden();
  expect((await state(page)).moves).toBe(limit - 1);
  await input(page, 'cw', isMobile);
  await expect(page.locator('#modal-out')).toBeVisible();
  await page.click('#out-restart');
  expect((await state(page)).moves).toBe(0);
});

test('one-way wheel: counter-clockwise spin is disabled', async ({ page }) => {
  await seedProgress(page, 100, { seen: { pier: 1, oneway: 1 } });
  await page.goto('./');
  const id = await page.evaluate(async () => (await import('./js/levels.js')).LEVELS.find((l) => l.oneway).id);
  await openLevel(page, id);
  await expect(page.locator('#btn-ccw')).toBeDisabled();
  const s0 = await state(page);
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('#toast')).toContainText('clockwise');
  expect(await state(page)).toEqual(s0);
});

test('rule intros appear once', async ({ page }) => {
  await seedProgress(page, 50);
  await page.goto('./#level=51');
  await expect(page.locator('#modal-intro')).toBeVisible();
  await expect(page.locator('#intro-title')).toHaveText('Piers');
  await page.click('#intro-ok');
  await page.goto('./#level=52');
  await page.waitForTimeout(200);
  await expect(page.locator('#modal-intro')).toBeHidden();
});

test('hint costs a token and points at a legal move', async ({ page }) => {
  await seedProgress(page, 20);
  await openLevel(page, 21);
  await expect(page.locator('#hint-count')).toHaveText('3');
  await page.click('#btn-hint');
  await expect(page.locator('#toast')).toContainText('from here');
  await expect(page.locator('#hint-count')).toHaveText('2');
  const ok = await page.evaluate(() => window.__wheel.game.canPlay(window.__wheel.view.hint.id));
  expect(ok).toBe(true);
});

test('daily puzzle: playable, records a streak and grants a hint', async ({ page, isMobile }) => {
  await seedProgress(page, 0, { seen: { pier: 1, oneway: 1, gate: 1, tight: 1 } });
  await page.goto('./');
  await page.click('#btn-daily');
  await expect(page.locator('#hud-level')).toHaveText('Daily Lantern');
  await page.waitForTimeout(150);
  const sol = await page.evaluate(() => window.__wheel.level.solution);
  for (const mv of sol) await input(page, mv, isMobile);
  await expect(page.locator('#modal-win')).toBeVisible();
  await expect(page.locator('#win-best')).toContainText('1-day streak');
  await page.click('#win-levels');
  await expect(page.locator('#daily-sub')).toContainText('Solved today');
  const saved = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)), KEY);
  expect(saved.hints).toBe(4);
});

test('locked levels and level select', async ({ page }) => {
  await page.goto('./#level=150');
  await expect(page.locator('#screen-title')).toHaveClass(/active/);
  await page.click('#btn-levels');
  await expect(page.locator('.lvl')).toHaveCount(200);
  await expect(page.locator('.lvl.locked')).toHaveCount(197);
  await page.locator('.lvl[data-level="2"]').click();
  await expect(page.locator('#hud-level')).toHaveText('Level 2');
});

test('sound and music toggles persist', async ({ page }) => {
  await page.goto('./');
  await page.locator('#screen-title [data-toggle="sfx"]').click();
  await page.locator('#screen-title [data-toggle="music"]').click();
  await page.reload();
  await expect(page.locator('#screen-title [data-toggle="sfx"]')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#screen-title [data-toggle="music"]')).toHaveAttribute('aria-pressed', 'false');
});

test('layout fits the viewport with touch-sized controls', async ({ page }) => {
  await seedProgress(page, 200, { seen: { pier: 1, oneway: 1, gate: 1, tight: 1 } });
  for (const id of [1, 60, 160, 200]) {
    await openLevel(page, id);
    const m = await page.evaluate(() => {
      const v = window.__wheel.view;
      const rect = (s) => document.querySelector(s).getBoundingClientRect().toJSON();
      let inside = true;
      v.level.docks.forEach((d, i) => {
        for (const j of [0, d.cap - 1]) {
          const [x, y] = v.px(...v.dockPoint(i, j));
          if (x < 0 || y < 0 || x > v.W || y > v.H) inside = false;
        }
      });
      return { overflow: document.documentElement.scrollWidth > innerWidth, vw: innerWidth, vh: innerHeight, inside, lantern: 0.62 * v.s, undo: rect('#btn-undo'), hint: rect('#btn-hint'), hud: rect('#hud-moves') };
    });
    expect(m.overflow).toBe(false);
    expect(m.inside).toBe(true);
    expect(m.undo.bottom).toBeLessThanOrEqual(m.vh);
    expect(m.undo.height).toBeGreaterThanOrEqual(44);
    expect(m.hint.right).toBeLessThanOrEqual(m.vw);
    expect(m.hud.right).toBeLessThanOrEqual(m.vw);
    expect(m.lantern).toBeGreaterThan(15);
  }
});
