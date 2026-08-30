---
description: "Task list for 006-enemies: Enemy Guards and Pathing"
---

# Tasks: Enemy Guards and Pathing

**Input**: Design documents from `/specs/006-enemies/`

**Prerequisites**: plan.md (required), spec.md (required for user stories)

**Tests**: Included, and mandatory here. Three of this spec's four stories are entirely
DOM-free and three.js-free modules, which is precisely the code Constitution Article III
requires to be written test-first.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to
- Exact file paths are given in every description

## Path Conventions

Single project. `src/`, `tests/`, `tools/` at repository root, per plan.md. Enemy logic
lives under `src/enemy/`; runtime hooks are `src/systems/<name>/register.ts`, discovered
by `src/boot/discover.ts`.

## No task in this spec edits `src/main.ts`

001 landed a system registry so a story adds behaviour by adding
`src/systems/<name>/register.ts` and nothing shared. Both runtime hooks below take that
route. Every gate exists from 001 onward, so the bootstrap exception does **not** apply:
`typecheck`, `build`, `test` and `smoke` must all pass after every task here.

---

## Phase 1: User Story 1 - Guard state machine (Priority: P1) 🎯 MVP

**Goal**: Guard behaviour is a table of states and named edges plus one pure step
function, deterministic under a seed, with pathing and sight injected rather than
imported so it can ship before US2 exists.

**Independent Test**: Under `npm run test`, drive the guard through all five states with
a synthetic grid, a seeded PRNG and scripted player positions; assert the exact state
after each tick, and assert the same seed reproduces a byte-identical trace.

### Tests for User Story 1

> Write these first and confirm they fail before implementing.

- [ ] T001 [P] [US1] `tests/unit/enemy-rng.test.ts`: the seeded PRNG returns an identical value sequence for seed `1234` across two independent instances, and a different sequence for a different seed; DOM-free and three.js-free (FR-002, US1-S9).
- [ ] T002 [P] [US1] `tests/unit/enemy-states.test.ts`: the exported state list is exactly `idle`, `alert`, `chase`, `attack`, `death`; every transition entry carries `from`, `to` and a named `guard` predicate; `death` has zero outgoing edges; every non-`death` state is reachable from `idle`; no state but the spawn state has zero incoming edges (FR-001, US1-S1, US1-S7, US1-S8).
- [ ] T003 [P] [US1] `tests/unit/enemy-step.test.ts`: a scripted tick sequence over a hand-drawn grid with a stubbed `GuardWorld` walks all five states and every legal edge, and the recorded trace for seed `1234` is byte-identical across two runs while a different seed diverges only at ticks that requested randomness (FR-001, FR-002, US1-S2, US1-S3, US1-S4, US1-S5, US1-S6, US1-S7, US1-S9, SC-001).

### Implementation for User Story 1

- [ ] T004 [US1] Implement `src/enemy/rng.ts` — a seeded 32-bit PRNG exposing `createRng(seed)` and `next()`, importing neither the DOM nor `three`; this module is the whole of the spec's reproducibility claim (FR-002, US1-S9, SC-002).
- [ ] T005 [US1] Implement `src/enemy/states.ts` — the `GuardState` union, the exported `{from, to, guard}` transition table, and the tuning constants each edge reads (alert duration, attack range, shot cooldown, move speed, last-known-position timeout, path-request interval), declared once here rather than inline at their use sites (FR-001, US1-S1, US1-S5, US1-S6).
- [ ] T006 [US1] Implement `src/enemy/step.ts` — `stepGuard(guard, {tick, rng, grid, doorStates, playerPos, world})`, a pure function returning the next guard record, where `world` is the exported `GuardWorld` port declaring `hasLineOfSight(a, b)` and `findPath(from, to)`; US2 supplies the real implementation and MUST NOT need to edit this file (FR-001, FR-002, US1-S2, US1-S3).
- [ ] T007 [US1] In `src/enemy/step.ts`, implement the `idle` patrol facing driven by the seeded PRNG rather than frozen, and the `alert` branch: last-known-player-position recorded on sight, promotion to `chase` after the declared alert duration, and return to `idle` on reaching the last known position or on the declared timeout (US1-S2, US1-S3, US1-S4).
- [ ] T008 [US1] In `src/enemy/step.ts`, implement the `chase` → `attack` range-and-sight gate and the `attack` → `chase` return once the current shot cooldown ends, both reading their thresholds from `src/enemy/states.ts` (US1-S5, US1-S6).
- [ ] T009 [US1] In `src/enemy/step.ts`, make `death` terminal — lethal damage from any state enters it, no edge leaves it, a pending attack wind-up is cancelled so no damage is dealt after entry, and a second `death` transition cannot fire (FR-001, US1-S7, Edge Cases).

**Checkpoint**: `npm run test` drives a guard through all five states with no DOM, no
three.js and no pathfinder. Nothing renders yet.

---

## Phase 2: User Story 2 - A* pathing and line-of-sight on the 64x64 grid (Priority: P1)

**Goal**: A bounded A* and a bounded raycast over the level grid, honouring door state,
bound into the `GuardWorld` port US1 declared.

**Independent Test**: Under `npm run test`, assert exact paths on hand-drawn grids, an
explicit `unreachable` behind a wall ring, door state changing passability, hand-computed
line-of-sight answers, and a pathological grid returning within the node-expansion cap.

### Tests for User Story 2

> Write these first and confirm they fail before implementing.

- [ ] T010 [P] [US2] `tests/unit/enemy-los.test.ts`: `hasLineOfSight` is true across open cells, false with one intervening wall, false through a closed door and true through an open one, and false across a diagonal corner whose two orthogonal neighbours are walls (FR-005, US2-S5, US2-S6, US2-S7, US2-S8).
- [ ] T011 [P] [US2] `tests/unit/enemy-pathing.test.ts`: `findPath` returns an ordered orthogonally-adjacent wall-free path on a known 64x64 layout, the declared `unreachable` result — not `null`, not `[]`, not a partial path — behind a closed wall ring, `unreachable` through a closed door and a traversing path through an open one, an integer `nodesExpanded` never exceeding the declared cap on a grid built to maximise search, and identical results for two identical calls (FR-003, FR-004, US2-S1, US2-S2, US2-S3, US2-S4, US2-S9).
- [ ] T012 [P] [US2] `tests/unit/enemy-nav.test.ts`: the navigator issues at most one path request per guard per declared interval and reports the throttle; a guard's path is discarded when the player's cell changes rather than followed to the stale destination; a door closing mid-traverse forces a new path within one tick; and two guards converging on one corridor cell each hold a distinct claimed cell (FR-003, FR-004, Edge Cases).

### Implementation for User Story 2

- [ ] T013 [US2] Implement `src/enemy/los.ts` — `hasLineOfSight(grid, doorStates, a, b)` stepping cell by cell (Bresenham/DDA) with no array allocated per call, returning false for any intervening wall or closed door and false across a two-wall diagonal corner; no DOM, no `three` (FR-005, US2-S5, US2-S6, US2-S7, US2-S8).
- [ ] T014 [US2] Implement `src/enemy/pathing.ts` — A* over the 64x64 grid returning `{cells, nodesExpanded}` or the declared `unreachable` value, with closed doors impassable and open doors passable, and the node-expansion cap exported as the single named constant the spec's clarification requires (FR-003, FR-004, US2-S1, US2-S2, US2-S3, US2-S4).
- [ ] T015 [US2] In `src/enemy/pathing.ts`, fix the open-set tie-break to a deterministic ordering so identical grid and door states always yield an identical path, and return `unreachable` on exhausting the cap rather than continuing the search (FR-004, US2-S9, SC-003).
- [ ] T016 [US2] Implement `src/enemy/nav.ts` — the adapter that binds `src/level.ts`'s grid and 004's door state into the `GuardWorld` port exported by `src/enemy/step.ts`, throttling path requests per guard to the interval declared in `src/enemy/states.ts`, reporting the throttle so a regression is visible, and discarding a stale path when the player's cell changes or a traversed door closes (FR-003, FR-004, Edge Cases).
- [ ] T017 [US2] In `src/enemy/nav.ts`, add per-guard cell claiming so two guards converging on one corridor never resolve to the same target cell, neither is pushed into a wall, and neither stops moving (FR-003, Edge Cases).

**Checkpoint**: A guard can be driven end to end in a unit test on the real level grid.
Still nothing on screen, and still no damage.

---

## Phase 3: User Story 3 - Hitscan attacks with damage falloff (Priority: P2)

**Goal**: Guards exist in the running level, tick every frame, and shoot along a ray that
stops at cover and does less damage with distance.

**Independent Test**: Under `npm run test`, assert exact damage at each declared falloff
breakpoint, `blocked` with zero damage behind a wall or closed door, and a placed-guard
count matching the level's markers between 6 and 10.

### Tests for User Story 3

> Write these first and confirm they fail before implementing.

- [ ] T018 [P] [US3] `tests/unit/enemy-falloff.test.ts`: damage is read from the exported curve table at each declared breakpoint, damage at the near breakpoint strictly exceeds damage at the far breakpoint, and both are greater than zero (FR-008, US3-S1, US3-S2).
- [ ] T019 [P] [US3] `tests/unit/enemy-attack.test.ts`: a clear shot deals the curve's value for its distance; a wall between attacker and target reports `blocked`, zero damage and the ray's termination distance; a closed door likewise reports `blocked` with zero damage; no shot is emitted when line-of-sight is absent; and two guards firing on the same tick at different distances each compute damage from their own distance (FR-007, US3-S3, US3-S4, US3-S5, US3-S8).
- [ ] T020 [P] [US3] `tests/unit/enemy-spawn.test.ts`: the guard count instantiated from `src/level.ts`'s `enemySpawns` equals the marker count and lies between 6 and 10 inclusive, and a marker on a wall cell yields a named error carrying that marker's coordinates rather than a dropped guard or an uncaught throw (FR-006, US3-S6, US3-S7).

### Implementation for User Story 3

- [ ] T021 [US3] Implement `src/enemy/falloff.ts` — the exported distance-to-damage table and the evaluator every shot consults, so no damage number is ever an inline literal at a call site (FR-008, US3-S1, US3-S2).
- [ ] T022 [US3] Implement `src/enemy/attack.ts` — `resolveShot(guard, playerPos, grid, doorStates)` running the ray through `src/enemy/los.ts`, terminating at the first blocking wall or closed door with `blocked`, the termination distance and zero damage, and otherwise returning the falloff value for the measured distance (FR-007, US3-S3, US3-S4, US3-S5, US3-S8).
- [ ] T023 [US3] Implement `src/enemy/spawn.ts` — read `enemySpawns` from `src/level.ts`, build one guard record per marker, assert the live count at no fewer than 6 and no more than 10, and return a named error naming the coordinates of any marker landing on a wall cell (FR-006, US3-S6, US3-S7).
- [ ] T024 [US3] Implement `src/enemy/world.ts` — the live guard records `{state, viewAngle, pathable, cell, health}` and `tickWorld(dt)`, which calls US1's `stepGuard` through the navigator from `src/enemy/nav.ts` and resolves shots through `src/enemy/attack.ts`; `viewAngle` is declared here initialised to 0 and is written each frame by US4, `pathable` is set false when the first chase path returns `unreachable` so the guard stays `idle` instead of hanging, and `enemiesAlive` counts records whose state is not `death`. No DOM, no `three` (FR-006, FR-007, FR-011, US4-S6, Edge Cases).
- [ ] T025 [US3] Extend `src/diag/diag.ts` additively — add `enemies` (array of `{state, viewAngle, pathable}`), `enemiesAlive` (integer) and `enemySpawnErrors` (string[]) to the `Diagnostics` interface and initialise them in `createDiagnostics`, renaming, removing and repurposing nothing 001, 002, 003 or 004 owns. This is the only task in this spec that edits a file an earlier spec owns (FR-011, SC-004).
- [ ] T026 [US3] Add `src/systems/enemies/register.ts` — a `defineSystem` registration that spawns guards from `src/enemy/spawn.ts` in `setup`, calls `tickWorld` in `update`, and publishes `enemies`, `enemiesAlive` and `enemySpawnErrors` onto `ctx.diag`; it is discovered by `src/boot/discover.ts`, so `src/main.ts` is not edited (FR-011, SC-004).
- [ ] T027 [US3] Add `tools/smoke-checks/enemies.mjs` asserting `window.__diag.enemies.length` between 6 and 10 inclusive, `enemiesAlive` equal to that count at spawn, and `enemySpawnErrors` empty — and give `tools/smoke.mjs` a single loop that runs every `tools/smoke-checks/*.mjs`, mirroring `src/boot/discover.ts`, so US4 adds its own check without editing the harness again (reuse that loop if an earlier spec has already added one) (FR-006, FR-011, SC-004).

**Checkpoint**: Six to ten guards hunt the player and deal damage in the built page, and
`npm run smoke` proves it. They are still invisible.

---

## Phase 4: User Story 4 - Billboard rendering from a procedural sprite sheet (Priority: P2)

**Goal**: Guards are visible as camera-facing billboards whose frame is chosen from 8
view angles on a code-drawn sheet, shared per guard type, culled when off-screen.

**Independent Test**: Load the built page headlessly, orbit the camera 360 degrees in
eight steps and assert `window.__diag.enemies[i].viewAngle` visits eight distinct values;
under `npm run test`, assert the sheet's declared dimensions and that the tree holds no
image file.

### Tests for User Story 4

> Write these first and confirm they fail before implementing.

- [ ] T028 [P] [US4] `tests/unit/enemy-view-angle.test.ts`: a due-north viewer bearing selects angle index 0, and eight evenly spaced bearings around the circle select eight distinct indices in `0..7` (FR-010, US4-S3).
- [ ] T029 [P] [US4] `tests/unit/enemy-sprite-shape.test.ts`: the sheet plan reports width `8 * cell` and height `frames * cell` for the declared frame count, emits an ordered draw program for every angle-and-frame pair including the death frames, and is deterministic for a given seed; DOM-free and three.js-free (FR-009, US4-S2).

### Implementation for User Story 4

- [ ] T030 [US4] Implement `src/enemy/view-angle.ts` — a pure `viewAngleIndex(guardYaw, cameraBearing)` mapping relative bearing to `0..7` with index 0 at due north, importing neither the DOM nor `three` (FR-010, US4-S3).
- [ ] T031 [US4] Implement `src/enemy/sprite-shape.ts` — the pure sheet plan: cell size, `8 * cell` by `frames * cell` dimensions, and the ordered canvas-2D draw program for each angle and frame including the declared death frames, with no canvas and no `three` in this module so it runs under vitest (FR-009, US4-S2).
- [ ] T032 [US4] Implement `src/enemy/sprite-sheet.ts` — replay the program from `src/enemy/sprite-shape.ts` onto exactly one `HTMLCanvasElement` per guard *type*, never per instance, and upload it as one texture, so ten guards cost one sheet (FR-009, US4-S2, US4-S7, Edge Cases).
- [ ] T033 [US4] Implement `src/enemy/billboard.ts` — one camera-facing quad per guard whose normal points at the camera rather than an axis-aligned card, with its sheet frame chosen through `src/enemy/view-angle.ts` (FR-009, FR-010, US4-S1, US4-S3).
- [ ] T034 [US4] In `src/enemy/billboard.ts`, advance the death frames over the declared duration on entering `death` and hold the final frame afterwards; no edit to `src/enemy/world.ts` is needed for US4-S6 because T024 already excludes `death` records from `enemiesAlive` (FR-009, US4-S5, US4-S6).
- [ ] T035 [US4] Add `src/systems/enemy-billboards/register.ts` — a `defineSystem` registration that builds a billboard per live guard record from `src/enemy/world.ts`, writes the chosen index back onto that record's `viewAngle` field each frame, and issues no draw call for a guard behind the camera; discovered by `src/boot/discover.ts`, so `src/main.ts` is not edited (FR-010, FR-011, US4-S4, US4-S8).
- [ ] T036 [US4] Add `tools/smoke-checks/enemy-orbit.mjs` — orbit the camera around a stationary guard through 360 degrees in eight equal steps, read `window.__diag.enemies[i].viewAngle` at each, assert the eight readings are pairwise distinct with no consecutive repeat, and assert `drawCalls` rises by no more than one per visible guard; it is picked up by the loop T027 added, so `tools/smoke.mjs` is not edited again (FR-010, US4-S4, US4-S7, SC-005, SC-006).

**Checkpoint**: All four gates green. Guards are visible, lethal, deterministic and
headlessly asserted; the tree still contains no image file.

---

## Dependencies & Execution Order

### User Story Dependencies

Strictly sequential, as declared in the spec's `## Work Graph` block and compiled into
`workgraph.json`:

- **US1** — no dependencies inside this spec. Fixes the state list, the transition table
  and the `GuardWorld` port every later story consumes.
- **US2** — depends on US1. Implements the port US1 declared; `chase` means nothing until
  a path exists.
- **US3** — depends on US2. An attack is a ray test that needs US2's line-of-sight, and a
  guard needs US1's `attack` state before a shot can be gated on it.
- **US4** — depends on US3. It draws the records US3 instantiates; there is nothing to
  billboard before guards exist.

The spec itself depends on `004-interaction` having landed: pathing and line-of-sight
both read door state, guard placement reads `enemySpawns` from 002's `src/level.ts`, and
every sight test is against 003's player position. That edge is declared as
`depends_on_landed` in the spec's frontmatter.

### Shared files

- `src/diag/diag.ts` — edited exactly once, by T025 (US3), additively. No other story in
  this spec opens it.
- `tools/smoke.mjs` — edited exactly once, by T027 (US3), to add the check-module loop.
  T036 (US4) adds a check module and touches the harness not at all.
- `src/main.ts` — **not edited by any task.** Behaviour is added through
  `src/systems/<name>/register.ts`, per `src/boot/registry.ts`.
- `src/enemy/world.ts` — created by US3 (T024) and only *read* by US4; T035 writes the
  `viewAngle` field on a record, which is data, not a second story editing the file.

### Parallel Opportunities

Within a story only, on the tasks marked [P]: T001/T002/T003 in US1; T010/T011/T012 in
US2; T018/T019/T020 in US3; T028/T029 in US4. Every one of those pairs is a distinct test
file. Nothing crosses a story boundary.

## Notes

- Test-first is mandatory for anything DOM-free and three.js-free (Article III), which in
  this spec is every module except `sprite-sheet.ts`, `billboard.ts` and the two
  `register.ts` files. Those are verified through `__diag` by the smoke gate instead.
- Never weaken a gate to make it pass. A failing gate blocks the commit, not the gate.
  Raising the node-expansion cap to make a path succeed is a violation, not a fix.
- Commit once per task (ergane's inner loop; Article VII). All four gates exist from 001
  onward, so all four must be green at every task boundary.
- No source file over 400 lines (Article IV); split as part of the task that would exceed
  it. `src/enemy/nav.ts` and `src/enemy/billboard.ts` are the two most likely to.
- Two forks decided here belong in `DECISIONS.md` when their tasks land: the `GuardWorld`
  port on `src/enemy/step.ts` (T006), and spawn faults reported through
  `__diag.enemySpawnErrors` rather than `__diag.errors` (T025).
