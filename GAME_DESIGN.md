# Lantern Wheel: Game Design

## Where it comes from
Lantern Wheel combines three concepts into one ruleset:

| Ingredient | Taken from | What it contributes |
|---|---|---|
| A wheel of gondolas that spins as one | *Loopline* (conveyor loop) + *Tiltgarden* (one input moves everything) | Positioning: every spin moves every riding lantern, so you plan where things will be, not just what to move next |
| Towers (stacks) and piers (queues) of limited length | *Switchyard* (shunting sidings) | Order: what you bury, and in what order you queue it, decides what you can reach later |
| Gates, a clockwise-only wheel, a tight wheel with no spare dock | all three | New constraints that change the plan, one chapter at a time |

The goal is simple: empty the wheel so that every dock holds one color.

## Why it is challenging (by design, and measured)
An earlier prototype (a ring-rotation sorter) turned out to be solvable by
just doing the obvious thing. In Lantern Wheel, difficulty is engineered and
checked:

1. **Irreversible-feeling structure.** A tower only gives back its top
   lantern and a pier only its front one, so a careless drop buries what you
   will need later.
2. **Shared motion.** Spinning to serve one dock also moves every other
   riding lantern. Parking lanterns on the wheel has a positional cost.
3. **Tight move budgets.** Each level allows par + 2 moves (par + 3 in the
   first chapter). Par is the proven optimum.
4. **The naive-player filter.** The generator plays every candidate level
   with a greedy strategy: always spin the shortest way to the dock whose tap
   helps most right now, and never make a move that doesn't help
   immediately. A level is kept only if that strategy **fails** within the
   move limit. Every level from 10 on (after a short onboarding) needs a non-obvious idea, such as
   lifting a correct-looking lantern, parking on purpose, or queueing in the
   right order. The test suite re-checks this for every level.

## Rules
- **Spin** (drag the wheel, the spin buttons, arrow keys, or the mouse wheel): every gondola moves one place. One move.
- **Tap a dock**: if the gondola facing it carries a lantern, drop it onto the dock (if there is room and the gate allows); if the gondola is empty, lift the dock's next lantern onto it. One move.
- **Tower**: stack. The lantern nearest the wheel is on top.
- **Pier**: queue. Lanterns leave from the wheel end and join at the far end.
- **Gate**: the dock only accepts its own color.
- **Win**: the wheel is empty and every dock holds a single color.
- **Stars**: ★★★ at par, ★★ within half of the margin, ★ within the limit.

## Progression (200 levels, 8 chapters × 25)
1. **First Lanterns**: tutorial (levels 1–3), two colors, three towers.
2. **Festival Towers**: three colors, four towers.
3. **The Piers**: queues join the towers.
4. **Clockwise Night**: the wheel only turns clockwise.
5. **Color Gates**: gated docks.
6. **Tight Wheel**: no spare dock; park on the wheel.
7. **Lantern Parade**: four colors, ten gondolas.
8. **Grand Festival**: everything combined.

Par rises from 1 to about 24. A **Daily Lantern** (pool of 100 hard boards,
par 17–21) adds a streak. **Hints** are tokens: three to start, plus one per
first ★★★ and per daily solve.

## Feel & identity
A night lantern festival on a lake: a golden wheel with spokes, glowing paper
lanterns that sway gently, stone towers and wooden piers, and sky lanterns
drifting up in the background. The type is rounded and friendly (Fredoka).
Every color also has a symbol for color-blind players. All sound is
synthesized, with a calm generative soundtrack, and sound and music mute
separately.

## Verification
- `js/solver.js`: A* with an admissible heuristic. Admissibility and optimality
  are checked against exhaustive breadth-first search in `tests/solver.test.mjs`.
- `npm test`: every level and daily puzzle is replayed through the rules and
  re-solved optimally, and fails the naive strategy. The suite also covers
  rules, limits, undo/restart, progress, hints and streaks.
- `npm run test:e2e`: Playwright plays levels from every chapter with real
  input in Chromium (desktop and mobile), Firefox and WebKit.
