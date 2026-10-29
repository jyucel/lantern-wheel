# Lantern Wheel

**A festival sorting puzzle.** Spin the wheel, stack the towers, queue the
piers, and sort every lantern by color.

▶ **Play:** https://jyucel.github.io/lantern-wheel/

![Lantern Wheel icon](assets/icon-192.png)

## How to play

| | |
|---|---|
| **Goal** | Empty the wheel so every dock holds lanterns of one color |
| **Spin** | Drag the wheel, use the spin buttons, ← → keys, or the mouse wheel. Every gondola moves one place |
| **Tap a dock** | Drop the facing gondola's lantern onto it, or lift the dock's next lantern if the gondola is empty |
| **Towers** | Stacks: only the lantern nearest the wheel can leave |
| **Piers** | Queues: first in, first out; new lanterns join at the far end |
| **Gates** | Colored frame: only that color is accepted |
| **Moves** | Every spin and tap costs one, and the limit is tight. Match *par* (proven minimum) for ★★★ |

Keyboard: `←` `→` spin · `1`–`5` docks · `Z` undo · `R` restart · `H` hint · `Esc` back.

## Features
- 200 levels in 8 chapters, plus a **Daily Lantern** with a streak counter.
- Every level is proven solvable, and par is proven optimal (A* with an
  admissible heuristic, checked against exhaustive search).
- **No "obvious" levels.** From level 10 on (after a nine-level onboarding), every level defeats a greedy
  strategy, and the tests check this.
- Tight move limits, undo, restart, and earned hint tokens.
- An interactive tutorial, an intro card for each new rule, level select,
  stars, and saved progress (`localStorage`).
- Mouse, touch and keyboard controls. The layout adapts to desktop and to
  phones in portrait or landscape.
- Synthesized sound effects and calm generative music, with separate mutes.
  Color-blind symbols on every lantern.
- No ads, accounts, tracking or backend. Plain static files.

## Run locally
```bash
npm install        # only needed for browser tests
npm run serve      # http://localhost:8080/
```
Any static server works. The page must be served over http, because browsers
don't load JavaScript modules from `file://`.

## Tests
```bash
npm test                    # rules, solver optimality, all levels + dailies, naive filter, progress
npm run test:e2e            # Playwright: Chromium desktop + mobile, Firefox
WEBKIT=1 npm run test:e2e   # also mobile WebKit (needs system libraries; runs in CI)
```

## Project layout
```
index.html, css/style.css   app shell and styles
js/engine.js                pure rules (shared by game, generator, tests)
js/solver.js                A* optimal solver
js/levels.js, js/daily.js   generated levels and daily pool
js/render.js                canvas renderer, animation, input
js/audio.js                 Web Audio effects and generative music
js/progress.js              saved progress, hints, daily streak
js/sky.js                   animated backdrop
js/main.js                  screens, HUD, tutorial, flow
tools/generate-levels.mjs   deterministic, parallel level generator
tools/naive-player.mjs      greedy "obvious strategy" used to reject easy levels
tools/build.mjs, serve.mjs  build _site/ and serve locally
tests/                      unit tests (node:test) and e2e tests (Playwright)
```

## Deployment
`.github/workflows/deploy.yml` runs all tests (unit, and browser tests in
Chromium, Firefox and WebKit), builds `_site/`, and publishes to GitHub Pages
on every push to `main`. All paths are relative, so the game works under any
sub-path.

## License
Code: MIT (`LICENSE`). Font: Fredoka, SIL Open Font License 1.1 (`assets/fonts/OFL.txt`).
