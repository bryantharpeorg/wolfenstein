# Implementation Plan: Enemy Guards and Pathing

**Branch**: `006-enemies` | **Date**: 2026-08-29 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/006-enemies/spec.md`

## Summary

Put six to ten hostile guards into the level `001`–`004` built. Three quarters of this
milestone is arithmetic, not rendering: a five-state guard machine driven by a table of
edges, A* over the 64x64 grid with a hard node-expansion cap, a cell-stepping
line-of-sight raycast, and a distance-to-damage falloff table. All of it lives in
`src/enemy/*.ts` with no DOM and no `three` import, so it runs under `npm run test` and
is asserted by exact traces rather than by watching a screen. Only the last story —
billboards drawn from a procedurally generated sprite sheet — touches the scene graph.

The load-bearing idea is US1's seam. `stepGuard` takes a `GuardWorld` port with
`hasLineOfSight` and `findPath` on it, supplied by the caller. US1's tests hand it a
stub over a hand-drawn grid; US2 hands it the real navigator bound to `src/level.ts`
and 004's door state. That one indirection is what lets the state machine ship and be
proven before pathing exists, which is the order the spec's Work Graph declares — and
it means US2 never edits US1's file.

The second load-bearing idea is inherited rather than invented: `001` landed a system
registry (`src/boot/registry.ts` + `src/boot/discover.ts`) whose entire purpose is that
a story adds behaviour by adding `src/systems/<name>/register.ts` and editing nothing
shared. **No task in this spec edits `src/main.ts`.** US3 adds the `enemies` system that
ticks the AI; US4 adds the `enemy-billboards` system that draws it. `src/main.ts` never
learns that guards exist.

## Technical Context

**Language/Version**: TypeScript 5.x, `strict: true`, ES2022, per the landed
`tsconfig.json`. Node.js 20+ on the build host.

**Primary Dependencies**: `three` remains the only runtime dependency (Constitution I).
A* is written here — not pulled in — because a pathfinding package would be a second
engine and would drag the search out of vitest's reach.

**Storage**: N/A. Guard runtime state lives in memory in `src/enemy/world.ts` and dies
with the page.

**Testing**: `vitest` for `src/enemy/*` — every module in this spec except
`sprite-sheet.ts`, `billboard.ts` and the two `register.ts` files is DOM-free and
three.js-free by construction (FR-001, Article III). The render half is verified through
`window.__diag` by `npm run smoke`, which this spec extends with two check modules.

**Target Platform**: Same as 001 — evergreen desktop browsers, WebGPU where available,
WebGL otherwise; headless Chromium for the gate.

**Performance Goals**: No per-frame allocation in `hasLineOfSight` (US2-S8), a declared
node-expansion cap on every path request (FR-004), and a per-guard throttle on path
requests (Edge Cases). The stated goal is negative and precise: **a guard must never be
able to stall a frame.** Ten guards each requesting a fresh 4096-cell search every tick
is the failure mode this spec is written to make impossible, so the cap and the throttle
are both declared constants and both are reported, not merely applied.

**Constraints**: Zero binary assets (Constitution II) — the guard sprite sheet is drawn
by canvas 2D calls at load time, and SC-006 re-checks the tree inside the smoke gate. No
source file over 400 lines (Constitution IV): the state machine, the pathfinder, the
raycast, the attack resolver and the sprite generator are already separate modules for
that reason. `window.__diag` is 001's contract and is extended additively only (FR-011).

**Scale/Scope**: Four stories in one strict chain (US1 → US2 → US3 → US4), matching the
spec's `## Work Graph`. Fourteen new modules under `src/enemy/`, two new systems, eleven
new vitest files, two new smoke check modules. Exactly one file owned by an earlier spec
is edited: `src/diag/diag.ts`, once, by US3, to add two fields.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Article | Bearing on this spec | Status |
|---|---|---|
| I. Stack is fixed | No pathfinding library, no behaviour-tree library, no ECS. A* and the state table are ~150 lines of TypeScript each; billboards are a three.js `PlaneGeometry` faced at the camera | PASS |
| II. Zero binary assets | The guard sprite sheet is the first sprite art in the repository and is drawn by code: `sprite-shape.ts` emits the draw program, `sprite-sheet.ts` replays it onto a canvas. US4-S2 and SC-006 assert no image file exists at any path | PASS |
| III. Test-first, smoke-tested always | Three of four stories are entirely pure modules and are written test-first (T001-T003, T010-T012, T018-T020). The renderer half is asserted through `__diag.enemies` by a smoke check that orbits the camera | PASS |
| IV. File size ceiling (400) | Fourteen small modules rather than one `enemy.ts`. `pathing.ts` (A*), `los.ts` (raycast) and `nav.ts` (binding + throttle + cell claims) are split on that ceiling, not on taste | PASS |
| V. Prefer editing to authoring | Honoured where a home exists — the diagnostics contract is *edited* into `src/diag/diag.ts`, not shadowed by a second diag module. New modules are created only where 001 left no home: there is no enemy code to grow | PASS |
| VI. Original work only | No id Software sprite data, no reproduced guard art, no reproduced names. The sheet is a procedurally drawn original figure at 8 bearings | PASS |
| VII. Every task ends green and committed | All four gates exist from 001 onward, so the bootstrap exception does **not** apply here: `typecheck`, `build`, `test` and `smoke` must pass after every task in this file | PASS |
| VIII. Design forks decided, not asked | Two forks are decided below and belong in `DECISIONS.md` when the tasks that hit them land: the `GuardWorld` port, and `enemySpawnErrors` as a diagnostics field rather than an `__diag.errors` entry | PASS |

**Note on FR-006 and the smoke gate.** FR-006 requires a *named error* when a spawn
marker lands on a wall cell. Pushing that string into `window.__diag.errors` would fail
`npm run smoke` outright, which is right for a broken level but wrong as a mechanism —
001 owns `errors` and its meaning is "something threw". This spec records spawn faults
in `window.__diag.enemySpawnErrors` (a new array, additive per FR-011) and has
`tools/smoke-checks/enemies.mjs` fail the gate when it is non-empty. The consequence is
identical, the ownership is clean, and a human reading the failure is told the marker's
coordinates rather than a stack trace.

## Project Structure

### Documentation (this feature)

```text
specs/006-enemies/
├── spec.md              # The feature specification
├── plan.md              # This file
├── tasks.md             # Task breakdown (/speckit-tasks output)
└── workgraph.json       # Ergane's compiled node graph (ergane spec derive)
```

### Source Code (repository root)

```text
src/
├── enemy/
│   ├── rng.ts               # US1 — seeded 32-bit PRNG; the whole determinism claim rests here
│   ├── states.ts            # US1 — GuardState union, the {from,to,guard} table, tuning constants
│   ├── step.ts              # US1 — stepGuard(): pure tick over a GuardWorld port (LOS + findPath injected)
│   ├── los.ts               # US2 — hasLineOfSight(): cell-stepping DDA, no per-call allocation
│   ├── pathing.ts           # US2 — A* + MAX_NODE_EXPANSIONS + PathResult | unreachable
│   ├── nav.ts               # US2 — binds level grid + door state into GuardWorld; throttle, stale-path, cell claims
│   ├── falloff.ts           # US3 — the exported distance→damage table and its evaluator
│   ├── attack.ts            # US3 — resolveShot(): ray test, blocked + termination distance, zero damage
│   ├── spawn.ts             # US3 — reads level.ts enemySpawns, asserts 6..10, names wall-cell markers
│   ├── world.ts             # US3 — the live guard records and the tick that drives them; DOM-free
│   ├── view-angle.ts        # US4 — pure bearing → 0..7 sprite index
│   ├── sprite-shape.ts      # US4 — pure: sheet dimensions and the ordered draw program per angle/frame
│   ├── sprite-sheet.ts      # US4 — replays that program onto ONE canvas per guard type; builds the texture
│   └── billboard.ts         # US4 — camera-facing quad, frame selection, death animation, off-screen cull
├── systems/
│   ├── enemies/
│   │   └── register.ts      # US3 — ticks world.ts each frame, publishes __diag.enemies
│   └── enemy-billboards/
│       └── register.ts      # US4 — draws the guards, writes viewAngle back onto the records
└── diag/
    └── diag.ts              # EDITED ONCE, by US3: adds enemies, enemiesAlive, enemySpawnErrors

tests/unit/
├── enemy-rng.test.ts            # US1
├── enemy-states.test.ts         # US1
├── enemy-step.test.ts           # US1
├── enemy-los.test.ts            # US2
├── enemy-pathing.test.ts        # US2
├── enemy-nav.test.ts            # US2
├── enemy-falloff.test.ts        # US3
├── enemy-attack.test.ts         # US3
├── enemy-spawn.test.ts          # US3
├── enemy-view-angle.test.ts     # US4
└── enemy-sprite-shape.test.ts   # US4

tools/
├── smoke.mjs                    # EDITED ONCE, by US3: one loop that runs tools/smoke-checks/*.mjs
└── smoke-checks/
    ├── enemies.mjs              # US3 — guard count 6..10, enemiesAlive, enemySpawnErrors empty
    └── enemy-orbit.mjs          # US4 — eight camera bearings, eight distinct viewAngle readings
```

**Structure Decision**: Single project, unchanged from 001. Three points are load-bearing
rather than decorative.

*One, `src/main.ts` is not in this tree.* 001 landed `src/boot/registry.ts` and
`src/boot/discover.ts` precisely so a story never has to edit the bootstrap; adding
behaviour there is documented in that file as "the thing this arrangement exists to
prevent". Both of this spec's runtime hooks are `defineSystem` calls in their own
directories, discovered by `import.meta.glob`. There is no index to append to and no
wiring line to conflict on.

*Two, `src/enemy/step.ts` never imports `pathing.ts` or `los.ts`.* It declares the
`GuardWorld` port and consumes it. This is what makes the spec's declared order
(US1 before US2) executable rather than aspirational, and it is why US2 can add the real
navigator without opening a US1 file.

*Three, the sprite generator is split in two.* `sprite-shape.ts` is pure — sheet
dimensions and an ordered list of draw operations — so US4-S2's dimension assertion runs
under vitest with no jsdom canvas shim. `sprite-sheet.ts` is the thin replay onto a real
`CanvasRenderingContext2D` and is verified in the browser by the smoke gate. Without that
split the only DOM-free half of US4 would be the angle arithmetic.

## Complexity Tracking

*No Constitution violations to justify.* Three constraints are recorded because they
change how a task must be written:

| Constraint | Why it matters | Consequence for tasks |
|---|---|---|
| `src/enemy/world.ts` holds a `viewAngle` field US3 never computes | FR-011 fixes the diagnostics shape as `{state, viewAngle, pathable}`, but the bearing is only knowable once a camera exists in US4. Publishing the field from US3 and filling it from US4 keeps both stories out of each other's files | T024 declares `viewAngle` on the record and initialises it to 0; T035 writes it each frame from the billboard system. Neither story edits a file the other owns — the shared thing is a data field, not a source file |
| `tools/smoke.mjs` is one file that two stories want to extend | US3 must assert the guard count and US4 must assert the orbit. Two edits to one harness file is exactly the cross-story contention the system registry removed from `src/main.ts` | T027 adds a single discovery loop over `tools/smoke-checks/*.mjs` — the same trick as `boot/discover.ts` — and its own check module. T036 then adds only `tools/smoke-checks/enemy-orbit.mjs`. If an earlier spec has already added such a loop, T027 reuses it and adds no line at all |
| The orbit assertion needs a programmatically movable camera | SC-005 and US4-S4 require eight camera bearings with no human input, and the spec's Assumptions claim the harness can do this. 003 owns the camera; nothing in 001's landed harness moves it | T036 drives the orbit through the page's own diagnostics surface rather than by synthesising mouse input, and asserts the eight readings are pairwise distinct. If 003 landed no programmatic camera hook, T036 adds a test-only setter on the enemy-billboards system rather than reaching into 003's module — and records that in `DECISIONS.md` |
