---
description: "Task list for 004-interaction: Doors, Keys and Secrets"
---

# Tasks: Doors, Keys and Secrets

**Input**: Design documents from `/specs/004-interaction/`

**Prerequisites**: plan.md (required), spec.md (required for user stories)

**Tests**: Included, and test-first is the default here rather than the exception.
Constitution Article III requires it for DOM-free logic, and nine of this spec's modules
are DOM-free by design — the door machine, the key inventory and the secret model are
the most unit-testable code in the project.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to
- Exact file paths are given in every description

## Path Conventions

Single project. `src/`, `tests/`, `tools/` at repository root, per plan.md. Pure logic
lands in `src/interaction/`; three.js and DOM edges land in `src/systems/<name>/register.ts`,
which 001's glob discovery picks up with no edit to any shared file.

## Standing rule for this spec

`src/main.ts` is not edited by any task below. It is the bootstrap; 001 landed the system
registry so that per-frame behaviour is added by creating a system directory instead.
A task that finds itself opening `main.ts` has taken the wrong seam.

---

## Phase 1: User Story 1 - Door state machine (Priority: P1) 🎯 MVP

**Goal**: `D` tiles become a pure, time-driven state machine whose every interact command
returns a stated outcome — with the same wall-clock travel duration at 30 fps as at 240,
and a moving door that neither reverses, re-triggers, nor crushes the player.

**Independent Test**: `npm run test` on a suite that imports the door module in a vitest
file defining no `window` and importing no three.js; step it with synthetic deltas and
assert every transition, interpolated position, dwell timing and refusal reason.

### Tests for User Story 1

> Write these first and confirm they fail before implementing.

- [ ] T001 [P] [US1] `tests/unit/door-state.test.ts`: import `src/interaction/door.ts` with no `window` defined and no three.js present; assert the four states, that progress advances 0→1 over the declared duration, that stepping the same total time as 1 ms ticks and as 500 ms ticks agrees within 1e-6, and that dwell expiry closes the door unaided (FR-001, FR-002, US1-S1, US1-S2, US1-S3, US1-S4).
- [ ] T002 [P] [US1] `tests/unit/door-refusals.test.ts`: assert `blocked-moving` leaves state and progress untouched, `refusing-closing` completes the close before any re-open is possible, and `opened-now` resets the dwell timer on an already-open door (FR-003, FR-004, US1-S5, US1-S6, US1-S7).
- [ ] T003 [P] [US1] `tests/unit/door-field.test.ts`: build the door field from a fixture grid of two adjacent `D` tiles, assert each resolves its own travel axis, that the second commanded door refuses with `blocked-neighbour` and stays `closed`, and that no two doors claim the same destination tile (FR-016, US1-S9).
- [ ] T004 [P] [US1] `tests/unit/door-crush.test.ts`: assert `src/interaction/crush.ts` reports intersection between a closing door's travel volume and a player capsule of radius 0.3, and that a door so blocked reverses to `opening` with outcome `crush-reversed` rather than closing on the player (FR-015, Edge Cases).
- [ ] T005 [P] [US1] `tests/unit/interact-bindings.test.ts`: assert `Space` and `KeyE` both map to the single interact command and every other key code maps to none, so the binding is data rather than two handlers (FR-005).

### Implementation for User Story 1

- [ ] T006 [P] [US1] Create `src/interaction/outcomes.ts` exporting the complete `InteractOutcome` union and an `INTERACT_OUTCOMES` array — `opened`, `opened-now`, `blocked-moving`, `refusing-closing`, `blocked-neighbour`, `locked-missing-key`, `crush-reversed`, `already-open`, `blocked-geometry`, `no-target`. Declared in full here, once, so US2 and US3 import the union rather than widening it (FR-006, US2-S7).
- [ ] T007 [P] [US1] Create `src/interaction/params.ts` holding the named constants in one place — door travel duration, `dwellMs`, the maximum per-frame delta step, door travel distance (1 tile) and secret travel distance (2 tiles) — so tuning never chases literals across files, mirroring 003's `MovementParams` (FR-002, US1-S8).
- [ ] T008 [US1] Implement `src/interaction/door.ts`: `createDoor()`, `stepDoor(door, deltaMs)` and the `closed | opening | open | closing` progression, with progress a function of accumulated seconds over `params.ts`'s travel duration and every delta clamped to the declared maximum before integration. No `three` import, no DOM API (FR-001, FR-002, US1-S1, US1-S2, US1-S3).
- [ ] T009 [US1] Extend `src/interaction/door.ts` with `interactDoor(door, now)`: the dwell timer that closes an open door unaided, `blocked-moving` for a door in motion, `refusing-closing` for a door mid-close, and `opened-now` resetting the dwell on an already-open door — every path returning a declared outcome and never an empty result (FR-003, FR-004, FR-006, US1-S4, US1-S5, US1-S6, US1-S7).
- [ ] T010 [P] [US1] Implement `src/interaction/crush.ts` exporting a pure `doorWouldCrush(door, playerX, playerZ, radius)` AABB overlap against the door's travel volume; position comes in as arguments, never from a global, so the test needs no page (FR-015).
- [ ] T011 [US1] Wire the crush test into `src/interaction/door.ts`'s close path: a `closing` door whose travel volume would intersect the player capsule aborts, reverses to `opening`, and reports `crush-reversed`; blocking is left to collision, so the door never damages or traps the player (FR-015, Edge Cases).
- [ ] T012 [US1] Implement `src/interaction/door-field.ts`: build one door per `D` tile of 002's grid, resolve each door's travel axis from its two solid neighbours, refuse the second of a commanded adjacent pair with `blocked-neighbour`, answer "which door is adjacent to the player" and return `no-target` when none is (FR-006, FR-016, US1-S9).
- [ ] T013 [P] [US1] Implement `src/interaction/bindings.ts` mapping `Space` and `KeyE` to one interact command; the door decides whether it is locked, so this layer has no notion of keys and no second binding (FR-005).
- [ ] T014 [P] [US1] Implement `src/interaction/gate-registry.ts` — `registerDoorGate(fn)` / `collectDoorGates()`, mirroring `src/boot/registry.ts` — so a later story adds a refusal condition by registering from its own file instead of editing `door.ts`; `interactDoor` consults the gates before it opens (FR-006, FR-015).
- [ ] T015 [P] [US1] Implement `src/interaction/interaction-diag.ts` declaring the `__diag.interaction` shape in full — `doorsTotal`, `doorsOpen`, `secretsFound`, `secretsTotal`, `keys`, `lastReason`, `lastRefusalKeyKind`, `keyConsumed` — with zero/null defaults plus `recordOutcome()` and field setters. The whole FR-017 field set is declared here, in one story, so US2 and US3 populate fields rather than reopen this contract (FR-006, US1-S2).
- [ ] T016 [P] [US1] Implement `src/interaction/open-state.ts` as a registry of passable-tile providers — `registerOpenTileProvider(fn)` / `openTiles()` — so US3 publishes opened secrets later without re-editing the collider call site (FR-006, US1-S2).
- [ ] T017 [US1] Create `src/systems/doors/register.ts`: build one mesh per door at setup with 002's flat-colour materials, install the single `keydown` listener through `bindings.ts`, step every door from `update(ctx, deltaMs)`, drive mesh offset from `progress`, register the crush gate and the door open-tile provider, and publish `doorsTotal`/`doorsOpen`/`lastReason` through `interaction-diag.ts`. No edit to `src/main.ts` — 001's glob discovery finds this file (FR-005, FR-015, US1-S2).
- [ ] T018 [US1] Feed `openTiles()` into 003's collider at its single existing call site in the player system — one line, since 003 FR-007 already takes open state as an argument and its module signature is unchanged. A closed door stays solid; an open one stops blocking (FR-016, US1-S2).

**Checkpoint**: Every `D` tile in the shipped level opens on `Space`/`E`, dwells, closes
itself, refuses correctly while moving, and never closes on the player. All four gates green.

---

## Phase 2: User Story 2 - Keys and locked doors (Priority: P1)

**Goal**: Silver and gold keys become an inventory; a locked door consults it and, when
it refuses, *names the key it wants* — reaching diagnostics as a distinct reason instead
of a dead keypress. Keys survive use.

**Independent Test**: `npm run test` on a suite that imports the inventory and the
locked-door decision path; assert a pickup adds exactly one key, a locked door refuses
naming the missing kind, the matching key flips the outcome to `opened`, and the key is
still in the inventory afterwards.

### Tests for User Story 2

> Write these first and confirm they fail before implementing.

- [ ] T019 [P] [US2] `tests/unit/key-inventory.test.ts`: import `src/interaction/keys.ts` with no `window` and no three.js; assert it holds only counts keyed by `silver` and `gold`, that collecting a pickup adds exactly one, and that collecting the same pickup twice in a session still yields one (FR-007, FR-008, US2-S1, US2-S2).
- [ ] T020 [P] [US2] `tests/unit/locked-door.test.ts`: assert a gold-locked door with no gold key refuses `locked-missing-key` naming `gold` at progress 0, that holding the gold key yields `opened`, that the inventory is identical before and after (`keyConsumed: false`), and that a gold key does not open a silver-locked door (FR-009, FR-010, US2-S3, US2-S4, US2-S5).
- [ ] T021 [P] [US2] `tests/unit/key-placement.test.ts`: assert `validateLevel()` reports a named `key-placement` error for a fixture where a locked door's key lies behind that same door, and reports none for the shipped layout (FR-011, US2-S6).
- [ ] T022 [P] [US2] `tests/unit/interact-outcome-set.test.ts`: drive every reachable interact path against a fixture level and assert each result is a member of the declared `INTERACT_OUTCOMES` union — never `undefined`, never an empty string (FR-009, US2-S7).

### Implementation for User Story 2

- [ ] T023 [US2] Implement `src/interaction/keys.ts`: `createInventory()`, `addKey(inv, kind)`, `hasKey(inv, kind)` and `keyCounts(inv)` over the kinds `silver` and `gold`. Pure data — no DOM, no three.js, no level import (FR-007, FR-008, US2-S1).
- [ ] T024 [US2] Implement `src/interaction/pickups.ts` over 002's item spawn table: mark a key pickup consumed on collection so re-entering its tile is idempotent and cannot yield a second key (FR-008, US2-S2).
- [ ] T025 [US2] Implement `src/interaction/locks.ts` exporting `lockGate(lockTable, inventory)` in the shape the door gate registry expects: return `locked-missing-key` with the missing kind when the inventory lacks it, otherwise `null` so the door machine proceeds — and never decrement the inventory, so `keyConsumed` is `false` (FR-009, FR-010, US2-S3, US2-S4, US2-S5).
- [ ] T026 [US2] Implement `src/interaction/rules/key-placement.ts`: a pure rule returning a named `key-placement` error when a locked door's required kind has no pickup reachable from the player spawn without passing through that door, reusing 002's 4-neighbour reachability (FR-011, US2-S6).
- [ ] T027 [US2] Implement `src/interaction/level-rules.ts` collecting `./rules/*.ts` with `import.meta.glob({ eager: true })` — carrying `/// <reference types="vite/client" />` as `src/boot/discover.ts` does — and add the single call line in `src/level.ts` that folds the collected rules into `validateLevel()`'s error list. The glob is what lets US3 add its rule as a new file rather than as an edit here (FR-011, US2-S6).
- [ ] T028 [US2] Create `src/systems/keys/register.ts`: build key pickup meshes from 002's spawn table as generated geometry with flat colour (no icon file — Constitution II), collect on player proximity through `pickups.ts`, register `lockGate` via `registerDoorGate`, and write `keys`, `lastRefusalKeyKind` and `keyConsumed` through the interaction diagnostics setters so a refusal is visible headlessly. Registers itself by glob; no shared file edited (FR-009, FR-010, US2-S8).

**Checkpoint**: Locked doors gate the map, refuse by name, and open once their key is
carried — with the key still in hand afterwards. All four gates green.

---

## Phase 3: User Story 3 - Secret push-walls and completion counters (Priority: P2)

**Goal**: `S` tiles slide back exactly two tiles and stay open forever, the opened tile
becomes walkable, and `secretsFound`/`secretsTotal` make level completion a number.

**Independent Test**: `npm run test` on a suite that pushes each shipped secret and
asserts it travels exactly 2 tiles, increments `secretsFound` by exactly 1, never
decreases, and reaches `secretsTotal`; then re-pushes an open secret and asserts the
counter is unchanged.

### Tests for User Story 3

> Write these first and confirm they fail before implementing.

- [ ] T029 [P] [US3] `tests/unit/secret-push.test.ts`: assert a pushed secret slides away from the player and comes to rest displaced by exactly 2 tiles along its declared axis, with mid-slide displacement a fraction of 2 tiles interpolated over elapsed seconds using the same rule US1 asserts for doors (FR-012, US3-S1, US3-S2).
- [ ] T030 [P] [US3] `tests/unit/secret-counters.test.ts`: push every secret of a fixture level once and assert `secretsFound` increments by exactly 1 per secret and reaches `secretsTotal`; re-push an open one and assert the outcome is `already-open`, displacement stays at 2 tiles, no reverse motion occurs, and the counter is unchanged (FR-013, US3-S3, US3-S4, US3-S5).
- [ ] T031 [P] [US3] `tests/unit/secret-blocked.test.ts`: assert a secret whose 2-tile path holds a solid tile or another secret halts at the first blocked position with outcome `blocked-geometry` and a reported remaining distance, displacing nothing into solid rock (FR-014, US3-S6).
- [ ] T032 [P] [US3] `tests/unit/secret-placement.test.ts`: assert `validateLevel()` reports a named `secret-placement` error for an `S` tile whose 2-tile path cannot clear, and none for the shipped layout (FR-014, US3-S6).
- [ ] T033 [P] [US3] `tests/unit/interaction-diag-shape.test.ts`: assert the `window.__diag.interaction` object carries `doorsTotal`, `doorsOpen`, `secretsFound`, `secretsTotal`, `keys`, `lastReason` and `lastRefusalKeyKind`, that `secretsFound` never exceeds `secretsTotal`, and that no field owned by 001 (`ready`, `renderer`, `fps`, `frameTimeMs`, `drawCalls`, `errors`) or by 002 (`level`) is renamed, removed or repurposed (FR-017, US3-S8).

### Implementation for User Story 3

- [ ] T034 [US3] Implement `src/interaction/secret.ts`: `createSecret()` and `stepSecret(secret, deltaMs)` interpolating displacement 0→2 tiles over elapsed seconds with the shared travel constants and delta clamp Phase 1 declared, plus a `found` flag set once on first push. Pure — no DOM, no `three` import (FR-012, US3-S1, US3-S2).
- [ ] T035 [US3] Extend `src/interaction/secret.ts` with the terminal outcomes: `already-open` on any further push of a fully open secret with no reverse motion, and `blocked-geometry` halting travel at the first obstructed position while reporting the remaining distance (FR-013, FR-014, US3-S3, US3-S6).
- [ ] T036 [US3] Implement `src/interaction/secret-field.ts`: build one secret per `S` tile of 002's grid, resolve each push axis away from the player, keep `secretsFound` monotonic non-decreasing and bounded by `secretsTotal`, and expose the origin tiles of opened secrets as an open-tile provider registered through the passable-tile registry Phase 1 created, so 003's collision reports them walkable (FR-013, US3-S4, US3-S5, US3-S7).
- [ ] T037 [P] [US3] Implement `src/interaction/rules/secret-placement.ts`, a new file in the `rules/` directory US2's glob already discovers, so the collector and 002's level module are both left untouched, flagging any `S` tile whose 2-tile travel path cannot clear as a named `secret-placement` error (FR-014, US3-S6).
- [ ] T038 [US3] Create `src/systems/secrets/register.ts`: build secret meshes reusing 002's wall materials so an unpushed secret is indistinguishable from wall, step them from `update(ctx, deltaMs)`, drive mesh offset from displacement, register the opened-tile provider, and write `secretsFound`/`secretsTotal` through the interaction diagnostics setters. Discovered by glob; the bootstrap is untouched (FR-012, FR-017, US3-S7).
- [ ] T039 [US3] Publish the completed `window.__diag.interaction` object and confirm additivity: every FR-017 field present after the first frame, stable in shape across reads, and every 001/002 field intact beside it (FR-017, US3-S8).
- [ ] T040 [US3] Extend `tools/smoke.mjs` with the interaction assertions — exit non-zero when `__diag.interaction.secretsFound` exceeds `secretsTotal`, when `doorsOpen` is not an integer, or when any entry appears in `__diag.errors`, printing the captured reason (FR-018, US3-S4).
- [ ] T041 [US3] Confirm `npm run typecheck`, `npm run build`, `npm run test` and `npm run smoke` pass together, and that the suite carries at least 12 interaction assertions covering one per refusal reason in `INTERACT_OUTCOMES` (FR-018, US3-S8).

**Checkpoint**: Every door, key and secret in the shipped level is exercised headlessly.
Level completion is a number. All four gates green.

---

## Dependencies & Execution Order

### User Story Dependencies

Strictly sequential, as declared in the spec's `## Work Graph` block and compiled into
`workgraph.json`:

- **US1** — no dependencies within this spec. Creates the outcome union, the params, the
  state machine and all three extension seams (`gate-registry.ts`, `open-state.ts`,
  `interaction-diag.ts`).
- **US2** — depends on US1. Its lock decision is a gate registered into US1's door
  machine, and its refusal reason is a member of US1's union.
- **US3** — depends on US2. It reuses US1's motion model and US2's interaction dispatch
  and rule-discovery directory, and it closes the `__diag.interaction` contract.

### Spec dependencies

`depends_on_landed: ["003-player"]` — the minimal set. This spec reads 003's player
capsule and its "adjacent tile" query (crush test, door adjacency, secret push
direction), and 003 already declares `002-map-geometry`, which declares `001-scaffold`.
Naming 002 or 001 here would be a transitive edge and therefore noise.

### Shared files (all within a single story — no cross-story writes)

- `src/interaction/door.ts` — created in T008 (US1), extended in T009 and T011 (US1)
- `src/interaction/secret.ts` — created in T034 (US3), extended in T035 (US3)
- No file in this spec is written by two different user stories. `gate-registry.ts`,
  `open-state.ts`, `interaction-diag.ts` and `interaction/rules/` exist so that US2 and
  US3 extend US1's and US2's behaviour by **registering** or **adding a file**, never by
  editing one another's modules.

### Files outside this spec

- `src/level.ts` (002's) — one line, once, in T027 (US2)
- 003's player system — one line, once, in T018 (US1)
- `tools/smoke.mjs` — T040 (US3)
- `src/main.ts` — **not edited by any task**

### Parallel Opportunities

Within a story only, on the tasks marked [P]: T001–T007 and T010/T013–T016 in US1;
T019–T022 in US2; T029–T033 and T037 in US3. Nothing crosses a story boundary.

## Notes

- Test-first is mandatory for anything DOM-free and three.js-free (Article III), which
  here is every module under `src/interaction/`. Only mesh motion and key binding are
  verified through `__diag` by the smoke harness instead.
- Never weaken a gate to make it pass. A failing gate blocks the commit, not the gate.
- Commit once per task (ergane's inner loop; Article VII).
- No source file over 400 lines (Article IV); `door.ts` and `secret.ts` are the two most
  likely to approach it — split as part of the task that would exceed it.
- Zero binary assets (Article II): keys are generated geometry and flat colour, and the
  "which key do you want" feedback is text. A key icon file fails the milestone.
