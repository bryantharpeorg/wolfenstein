---
description: "Task list for 003-player: Player Movement and Camera"
---

# Tasks: Player Movement and Camera

**Input**: Design documents from `/specs/003-player/`

**Prerequisites**: plan.md (required), spec.md (required for user stories);
`002-map-geometry` landed, so `src/level.ts` exports the grid, the player spawn tile and
its facing yaw.

**Tests**: Included, and test-first for every module under `src/player/` — all of them
are DOM-free and three.js-free by construction, which is exactly the code Constitution
Article III requires a failing test for. US2's resolver is the most heavily tested module
in the project because its bug class is intermittent (US2 rationale).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to
- Exact file paths are given in every description

## Path Conventions

Single project. `src/`, `tests/`, `tools/` at repository root, per plan.md. Behaviour is
added as `src/systems/<name>/register.ts`, discovered by glob in `src/boot/discover.ts`.
**No task in this spec edits `src/main.ts`, `src/boot/*` or `src/diag/diag.ts`** — that is
what the registry seam 001 landed exists to prevent.

## Shared declaration files

`src/player/params.ts`, `src/player/state.ts` and `src/player/diag-player.ts` are read by
all three stories and are created **complete** by US1, including the fields US2 and US3
populate at runtime. US2 and US3 import them and never edit them (plan.md, "Story file
ownership").

---

## Phase 1: User Story 1 - First-person camera and mouse look (Priority: P1) 🎯 MVP

**Goal**: Clicking the canvas locks the pointer; mouse movement turns the camera by an
amount that depends on total delta and not on frame count; pitch cannot flip; Esc gives
the pointer back; a denied lock changes nothing but a boolean.

**Independent Test**: Drive the built page headlessly — request pointer lock, dispatch
synthetic `mousemove` deltas totalling a known amount at two different simulated frame
intervals, assert yaw/pitch agree to within tolerance, then dispatch Esc and assert the
lock was released.

### Tests for User Story 1

> Write these first and confirm they fail before implementing.

- [ ] T001 [P] [US1] `tests/unit/look.test.ts`: 100 units of horizontal delta yields exactly `100 * sensitivityYaw` radians; the same total delta split over 1 and over 20 calls agrees to within 1e-6; unbounded upward delta leaves pitch within ±89° and free of NaN; halving both sensitivities halves the angular change (FR-002, FR-003, US1-S2, US1-S3, US1-S5, US1-S6).
- [ ] T002 [P] [US1] `tests/unit/pointer-lock.test.ts`: against a fake target whose `requestPointerLock` resolves, throws, and rejects in turn, the adapter reports `pointerLocked` truthfully, records no error on denial, accumulates deltas only while locked, and clears them when the lock is released (FR-001, FR-004, US1-S1, US1-S7, US1-S8).

### Implementation for User Story 1

- [ ] T003 [US1] Create `src/player/params.ts` — the single `MovementParams` table: `sensitivityYaw` and `sensitivityPitch` mutable at runtime through an exported setter with no reload, `PITCH_LIMIT_RAD` at 89°, plus the constants US2 and US3 import read-only (collider radius 0.3, substep 0.25, delta clamp, eye height, walk and sprint speed, bob amplitude/frequency/settle/speed epsilon) (FR-002, US1-S6).
- [ ] T004 [P] [US1] Create `src/player/state.ts` exporting the `PlayerState` record and a `createPlayerState(spawn)` factory carrying every field the spec's Key Entities name — `x`, `z`, `yaw`, `pitch`, `speed`, `sprinting`, `bobOffset` — plus `stuck`, per-axis `blocked` flags and `desiredVelX`/`desiredVelZ`, all zero-initialised so US2 and US3 assign into them without editing this file (FR-002, FR-003, US1-S2, US1-S3).
- [ ] T005 [P] [US1] Create `src/player/diag-player.ts` exporting `ensurePlayerDiag(diag)`, which attaches `window.__diag.player` with the complete FR-014 shape zero-initialised, and augments the `Diagnostics` interface by TypeScript module augmentation rather than by editing `src/diag/diag.ts` — no field owned by 001 or 002 is renamed, removed or repurposed (FR-001, US1-S1).
- [ ] T006 [US1] Implement `src/player/look.ts` as a pure function over accumulated mouse deltas returning `{yaw, pitch}` — yaw wrapped modulo 2π in the direction that turns the view right, pitch clamped to `PITCH_LIMIT_RAD`, importing neither `three` nor any DOM API so it runs under `npm run test` (FR-002, FR-003, US1-S2, US1-S3, US1-S4, US1-S5, US1-S6).
- [ ] T007 [P] [US1] Implement `src/player/pointer-lock.ts` — the DOM adapter that requests pointer lock on click, listens for `pointerlockchange`, `pointerlockerror` and `mousemove`, and accumulates raw deltas since the last drain; it takes its target element and event source as injected parameters so T002 can exercise it without a browser, and a denied, errored or browser-revoked lock leaves `pointerLocked` false, throws nothing uncaught, and records nothing in `window.__diag.errors` (FR-001, FR-004, US1-S1, US1-S7, US1-S8).
- [ ] T008 [US1] Create `src/systems/player-look/register.ts` at `order: 30` — calls `ensurePlayerDiag`, installs the T007 adapter on the canvas at setup, and each frame drains the accumulated deltas through `src/player/look.ts` into `PlayerState`, writing `camera.rotation` with order `YXZ` so the camera's up vector stays world up at the clamp, and publishing `yaw`, `pitch` and `pointerLocked` to `window.__diag.player` (FR-001, FR-002, FR-003, US1-S1, US1-S3, US1-S4).
- [ ] T009 [US1] In `src/systems/player-look/register.ts`, ignore accumulated deltas while `pointerLocked` is false and keep the system running after a denied or revoked lock, so a later click re-acquires it and the keyboard movement US3 adds is never disabled by a pointer-lock failure (FR-004, US1-S7, US1-S8).

**Checkpoint**: The camera turns with the mouse, cannot flip, and reports
`__diag.player.pointerLocked`. The player does not move yet and nothing collides.

---

## Phase 2: User Story 2 - Collision that never clips (Priority: P1)

**Goal**: Displacement of any magnitude, at any delta, resolves to a walkable position —
swept against 002's grid in substeps of at most 0.25 units, per axis, with per-axis
blocked flags reported back and a bad spawn pushed out rather than trapping the camera.

**Independent Test**: Unit-test the pure resolver directly over a battery of start tiles,
directions and displacements up to 50 units in a single call, asserting the resolved
position never ends inside a non-empty tile and never crosses a solid boundary lying
between start and target.

### Tests for User Story 2

> Write these first and confirm they fail before implementing.

- [ ] T010 [P] [US2] `tests/unit/collide.test.ts`: a 5-unit move into a wall stops flush within 1e-6; a diagonal into a corner slides along the free axis and comes to rest walkable; the resolver reports per-axis blocked flags; a start inside a solid tile is pushed out along the axis of least penetration in one call without throwing; a position at a tile boundary and one at 0.9999999 neither jitter nor report a spurious block (FR-005, FR-007, FR-008, FR-009, US2-S2, US2-S4, US2-S7, US2-S8).
- [ ] T011 [P] [US2] `tests/unit/collide-battery.test.ts`: at least 500 generated cases over start position, direction and single-call displacement up to 50 units, each asserting the resolved circle of radius 0.3 lies entirely within walkable tiles; plus the 1000 ms sprint spike and the 16 ms-versus-250 ms convergence to within 0.3 units over identical total elapsed time (FR-006, FR-010, US2-S3, US2-S5, US2-S6, SC-002, SC-003).
- [ ] T012 [US2] In `tests/unit/collide.test.ts`, assert the module's import graph: it imports neither `three` nor any DOM API and takes the grid and its open/closed state as arguments rather than reading a global, so M3 can open a door without changing the signature (FR-005, FR-007, US2-S1).

### Implementation for User Story 2

- [ ] T013 [US2] Implement `src/player/tiles.ts` — a pure predicate over 002's `src/level.ts` grid answering whether tile `(x, z)` blocks, treating every non-empty cell including `D` and `S` as solid unless the supplied open-state marks it open, and a walkability query for a circle of radius 0.3 at a world position (FR-007, US2-S1, US2-S3).
- [ ] T014 [US2] Implement `src/player/collide.ts` — `resolveMove(grid, position, displacement, openState) -> {position, blockedAxes, stuck}`, an axis-aligned box of the collider radius swept per axis against the grid, stopping flush at the boundary within 1e-6, sliding on the free axis in a corner, comparing boundaries against a declared epsilon rather than `===`, and depenetrating a start inside solid along the axis of least penetration with `stuck` set rather than throwing (FR-005, FR-008, FR-009, US2-S2, US2-S4, US2-S7, US2-S8).
- [ ] T015 [US2] Implement `src/player/integrate.ts` — clamps the frame delta to the declared maximum from `src/player/params.ts`, splits the resulting displacement into increments of at most 0.25 units, and calls `resolveMove` once per substep, so a clamped multi-second spike at sprint speed cannot cross a one-tile wall and a zero-length delta produces no division by zero or NaN (FR-006, FR-010, US2-S5, US2-S6).
- [ ] T016 [US2] Create `src/systems/player-body/register.ts` at `order: 34` — places the player at `src/level.ts`'s spawn tile and facing yaw at setup, integrates `PlayerState.desiredVelX/desiredVelZ` through `src/player/integrate.ts` each frame, writes `camera.position.x` and `camera.position.z` only, and publishes `x`, `z`, `stuck` and the blocked flags to `window.__diag.player` (FR-009, FR-010, US2-S7).
- [ ] T017 [US2] Implement `src/player/drive-hook.ts` — the declared `window.__playerDrive(velX, velZ, ms)` seam that writes the same `PlayerState.desiredVel*` fields US3's keyboard will write, so the harness can script a walk before WASD exists; install it from `src/systems/player-body/register.ts` and record the decision in `DECISIONS.md` (FR-015, plan.md Complexity Tracking).
- [ ] T018 [US2] Extend `tools/smoke.mjs` to load the built page in headless Chromium and read `window.__diag` back — as landed it only checks for binary assets and `dist/index.html` — resolving the browser from `PLAYWRIGHT_BROWSERS_PATH` / `CHROME_PATH` and failing with the missing browser named rather than attempting a download (FR-015, SC-001).
- [ ] T019 [US2] In `tools/smoke.mjs`, script a walk of at least 200 tiles across the shipped level through `window.__playerDrive`, sampling `__diag.player` throughout, and exit non-zero citing the offending tile if `stuck` is ever true or a sampled position lies on a non-walkable tile of the grid (FR-015, SC-001, SC-006).

**Checkpoint**: All four gates green. The player is in the level at the spawn tile and
cannot leave it under scripted movement, but there is no keyboard yet.

---

## Phase 3: User Story 3 - Locomotion feel (Priority: P2)

**Goal**: WASD moves relative to where the camera is looking, opposite keys cancel to
exactly zero, diagonals do not exceed base speed, Shift sprints at a named constant, and
the head-bob is driven by measured velocity — zero when pressed against a wall, settled
within 250 ms of stopping.

**Independent Test**: In the headless harness, hold a movement key against a wall and
assert the bob offset stays at zero despite non-zero input; then hold it in open space and
assert the offset oscillates at the declared cadence and returns to zero within the
declared settle time after release.

### Tests for User Story 3

> Write these first and confirm they fail before implementing.

- [ ] T020 [P] [US3] `tests/unit/locomotion.test.ts`: at yaw 0 `W` moves along the camera's forward horizontal vector and at yaw 90° the same key produces a displacement rotated 90°; `W`+`S` and `A`+`D` produce exactly zero; `W`+`A` has magnitude equal to the single-key speed, not √2 times it; Shift selects a sprint speed between 1.6x and 2.0x walk (FR-011, FR-012, US3-S1, US3-S2, US3-S3, US3-S4).
- [ ] T021 [P] [US3] `tests/unit/bob.test.ts`: 120 frames at zero measured speed produce exactly zero offset; 120 frames at walk speed oscillate symmetrically about zero with peak-to-peak amplitude between 0.02 and 0.08 units at 3 to 5 cycles per second of travel; half speed lowers both amplitude and frequency; the offset returns to within 1e-4 of zero no later than 250 ms after motion stops (FR-013, US3-S5, US3-S6, US3-S7, US3-S8, US3-S9, SC-005).
- [ ] T022 [P] [US3] `tests/unit/player-diag-contract.test.ts`: `ensurePlayerDiag` adds `x`, `z`, `yaw`, `pitch`, `speed`, `sprinting`, `pointerLocked`, `stuck` and `bobOffset` under `player` with the declared types, and leaves every field owned by 001 (`ready`, `renderer`, `fps`, `frameTimeMs`, `drawCalls`, `errors`) and by 002 (`level`) present and unchanged (FR-014).

### Implementation for User Story 3

- [ ] T023 [US3] Implement `src/player/locomotion.ts` — a pure function from key set, yaw and sprint flag to a desired horizontal velocity: yaw-relative basis vectors, opposite pairs cancelled to exactly zero before normalisation, diagonals normalised so no combination exceeds the current base speed, and the walk and sprint speeds imported read-only from US1's `MovementParams` table rather than restated as literals (FR-011, FR-012, US3-S1, US3-S2, US3-S3, US3-S4).
- [ ] T024 [P] [US3] Implement `src/player/keyboard.ts` — the DOM adapter mapping `keydown`/`keyup` to a live key set including Shift, taking its event source as an injected parameter so it is unit-testable, and clearing the set on blur so a key held across a focus change does not stick (FR-011, FR-012, US3-S1, Edge Cases).
- [ ] T025 [P] [US3] Implement `src/player/bob.ts` — a pure phase integrator advancing on distance travelled and returning a camera-y offset whose amplitude and frequency scale with measured horizontal speed, exactly zero below the declared speed epsilon, and damped back to within 1e-4 of zero within the declared settle time (FR-013, US3-S5, US3-S6, US3-S7, US3-S8, US3-S9).
- [ ] T026 [US3] Create `src/systems/player-locomotion/register.ts` at `order: 32` — installs the T024 keyboard adapter at setup and each frame writes `PlayerState.desiredVelX/desiredVelZ` from `src/player/locomotion.ts` using the yaw US1's system already applied, leaving the integration itself to `player-body` (FR-011, FR-012, US3-S1, US3-S2, US3-S3).
- [ ] T027 [US3] In `src/systems/player-locomotion/register.ts`, publish `speed` and `sprinting` to `window.__diag.player` additively over the fields 001 and 002 own (FR-014, US3-S4).
- [ ] T028 [US3] Create `src/systems/player-bob/register.ts` at `order: 36` — measures horizontal speed from the position `player-body` actually resolved rather than from key state, drives `src/player/bob.ts`, writes `camera.position.y` as eye height plus the offset, and publishes `bobOffset` to `window.__diag.player` (FR-013, FR-014, US3-S5, US3-S6, US3-S7, US3-S8, US3-S9).

**Checkpoint**: The milestone's DONE condition holds — you can walk the whole map, cannot
escape it, and the bob answers to motion rather than to input.

---

## Dependencies & Execution Order

### User Story Dependencies

Strictly sequential, as declared in the spec's `## Work Graph` block and compiled into
`workgraph.json`:

- **US1** — no dependencies within this spec. Creates the three shared declaration files,
  the look math and the pointer-lock adapter.
- **US2** — depends on US1. Needs `PlayerState`, `MovementParams` and `__diag.player` to
  exist, and yaw to be driven before movement can be yaw-relative.
- **US3** — depends on US2. Needs a resolved position to measure speed from; a bob driven
  by anything else is the exact bug US3-S8 forbids.

### Spec-level dependency

`depends_on_landed: ["002-map-geometry"]`. US2 collides against `src/level.ts`'s grid and
US2's system spawns the player at that file's spawn tile and facing yaw; US3's wall-press
scenario needs real walls. 001 is required too but is implied transitively through 002,
so declaring it as well would be noise.

### Shared files (single-story ownership, so there is no contention)

- `src/player/params.ts`, `src/player/state.ts`, `src/player/diag-player.ts` — created
  complete by US1 (T003, T004, T005); US2 and US3 import them and assign their fields at
  runtime without editing them.
- `src/systems/player-look/register.ts` — US1 only (T008, T009).
- `src/systems/player-body/register.ts` — US2 only (T016, T017).
- `src/systems/player-locomotion/register.ts` — US3 only (T026, T027).
- `tools/smoke.mjs` — US2 only (T018, T019).
- `tests/unit/collide.test.ts` — US2 only (T010, T012).
- `src/main.ts`, `src/boot/registry.ts`, `src/boot/discover.ts` and `src/diag/diag.ts` are
  edited by **no** task in this spec.

### Parallel Opportunities

Within a story only, on the tasks marked [P]: T001/T002 and T004/T005/T007 in US1;
T010/T011 in US2; T020/T021/T022 and T024/T025 in US3. Nothing crosses a
story boundary.

## Notes

- Test-first is mandatory for everything under `src/player/` — all of it is DOM-free and three.js-free, including the two DOM adapters, which take their event source as a parameter for exactly that reason (Article III).
- Never weaken a gate to make it pass. Widening the walkability tolerance or shrinking the 500-case battery to make T011 green is the violation Article III names explicitly.
- Camera channels are owned one per system: rotation by `player-look`, `x`/`z` by `player-body`, `y` by `player-bob`. Do not write another system's channel.
- Commit once per task (ergane's inner loop; Article VII), with all four gates green — the 001 bootstrap exception no longer applies.
- No source file over 400 lines (Article IV); `tiles.ts`, `collide.ts` and `integrate.ts` are already split at the seams that ceiling would otherwise force.
