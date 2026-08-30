---
description: "Task list for 002-map-geometry: Level Map and Merged Geometry"
---

# Tasks: Level Map and Merged Geometry

**Input**: Design documents from `/specs/002-map-geometry/`

**Prerequisites**: plan.md (required), spec.md (required for user stories)

**Tests**: Included. Constitution Article III requires test-first for DOM-free logic,
and this spec is mostly DOM-free logic: the grid, the validator, face culling and the
tile counts are all pure functions. SC-003 additionally requires at least 10 passing
assertions over parsing and validation.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to
- Exact file paths are given in every description

## Path Conventions

Single project. `src/`, `tests/`, `tools/` at repository root, per plan.md.

## Standing constraint: `src/main.ts` is not edited

001 landed a system registry (`src/boot/registry.ts`) with glob discovery
(`src/boot/discover.ts`) so that a story adds `src/systems/<name>/register.ts` and no
shared wiring file. No task below touches `src/main.ts`, and
`tests/unit/systems-discovery.test.ts` fails if one tries.

---

## Phase 1: User Story 1 - Level data format and validator (Priority: P1) 🎯 MVP

**Goal**: The map exists as plain data with a validator that refuses a malformed grid
before any geometry is built from it — DOM-free, three.js-free, and unit-testable.

**Independent Test**: `npm run test` on a suite that imports `src/level.ts` with no DOM
and no three.js present; the grid parses to 64 rows of 64 cells, `validateLevel()`
returns no errors for the shipped layout, and returns a named error for each malformed
grid in Edge Cases.

### Tests for User Story 1

> Write these first and confirm they fail before implementing.

- [ ] T001 [P] [US1] `tests/unit/level.test.ts`: assert the exported grid is 64 rows of 64 cells drawn only from `0`, `1`..`9`, `D`, `S`, `E`; that it declares at least 4 wall type IDs, at least 4 `D`, at least 2 `S` and exactly 1 `E`; that every outer-border tile is non-empty; and that the spawn set holds a player spawn on an empty tile with a yaw, 6-10 mutually-3-tiles-apart enemy spawns, at least 12 item spawns with exactly one `silver-key`, one `gold-key` and at least 3 `treasure`, plus a lock entry per `D` tile including one silver and one gold (FR-001, FR-003, US1-S2, US1-S3, US1-S4).
- [ ] T002 [P] [US1] `tests/unit/level-validate.test.ts`: one case per malformed grid in Edge Cases — zero `E`, two `E` citing both coordinates, non-square, square but not 64x64, all-empty, a `D` with four empty neighbours, a spawn on a non-empty tile, a wall type ID with no material entry, and a spawn unreachable from the exit — each asserting the named error category and that nothing throws (FR-005, US1-S5, US1-S6, US1-S7, US1-S8, US1-S9, US1-S10, SC-003).
- [ ] T003 [P] [US1] `tests/unit/level-purity.test.ts`: read `src/level.ts` and `src/level-validate.ts` as source text and assert neither imports `three` nor names a DOM global, and import both from a test file that defines no `window` — the same shape as 001's `tests/unit/systems-discovery.test.ts` (FR-004, US1-S1).

### Implementation for User Story 1

- [ ] T004 [US1] Create `src/level.ts` exporting the 64x64 grid as an in-file string array — original work in the spirit of a grid maze with right angles, locked doors, secrets and an elevator exit, never id Software's E1M1 data — with a solid border on every outer tile, at least 4 wall type IDs, at least 4 `D`, at least 2 `S`, exactly 1 `E`, and at least 40x40 tiles of contiguous walkable space (FR-001, FR-002, US1-S2, US1-S3, SC-005).
- [ ] T005 [US1] Add to `src/level.ts` the spawn set — player spawn tile plus facing yaw, 6 to 10 enemy spawn tiles at least 3 tiles apart, at least 12 item spawn tiles each carrying a kind from `health`, `ammo`, `treasure`, `silver-key`, `gold-key` — and the door-lock table naming every `D` tile's lock as `none`, `silver` or `gold` with at least one of each locked kind; this file is the only place 006 and 007 read their guard and pickup populations from (FR-003, US1-S4).
- [ ] T006 [US1] Add to `src/level.ts` the wall-material table with one entry per declared wall type ID plus a named default entry, and the tile-scale constants every later spec reads from here — 1 world unit per tile edge, floor at y=0, ceiling at y=2 (FR-006, US1-S10).
- [ ] T007 [US1] Create `src/level-validate.ts` exporting `validateLevel()` returning `{ valid, errors[] }` with named, coordinate-carrying errors rather than throwing, covering `dimensions` (non-square or not 64x64, including the degenerate all-empty grid), `exit` (zero or more than one `E`, citing every offending coordinate), spawn placement on empty tiles, a lock-table entry for every `D` tile, and a material entry for every wall type ID present (FR-005, US1-S5, US1-S6, US1-S7, US1-S9, US1-S10).
- [ ] T008 [US1] Add the `reachability` check to `src/level-validate.ts`: a 4-neighbour flood from the player spawn across empty, door and secret tiles must reach the exit tile, reporting a named error when it does not — including the sealed single-tile corridor that isolates the spawn or the exit (FR-005, US1-S8).
- [ ] T009 [US1] Add the `door-placement` check to `src/level-validate.ts`: every `D` and `S` cell must have solid tiles on exactly two opposite sides forming a one-tile-thick wall, so a door cannot stand in open space (FR-005, Edge Cases).
- [ ] T010 [US1] Have `validateLevel()` in `src/level-validate.ts` report the counts it computed — floor tiles, wall tiles by type, doors, secrets and exits — alongside the error list, so US3 publishes the validator's own numbers rather than recounting the grid a second way (FR-005, US1-S5).

**Checkpoint**: `npm run test` proves the shipped layout validates clean and every
malformed grid is refused by name. Nothing renders yet.

---

## Phase 2: User Story 2 - Merged geometry at one draw call per material (Priority: P1)

**Goal**: The level renders as merged `BufferGeometry` — one mesh per wall material plus
one floor and one ceiling — with faces between two solid tiles never emitted at all.

**Independent Test**: Build geometry from the shipped grid in a unit test with three.js
imported directly; the emitted vertex and index counts equal the hand-computable figure
for visible faces only. Separately, read `window.__diag.drawCalls` from the running page
and assert it is under 20.

### Tests for User Story 2

> Write these first and confirm they fail before implementing.

- [ ] T011 [P] [US2] `tests/unit/geometry-faces.test.ts`: against `src/geometry/faces.ts`, assert a solid 3x3 block inside open space emits exactly 12 vertical faces and zero faces between two adjacent solid tiles; a wall tile with four solid neighbours contributes zero vertices; floor and ceiling each emit exactly one quad per empty tile with no duplicates; and the shipped grid's total wall-face count equals the hand-computed perimeter-only figure (FR-008, FR-009, US2-S2, US2-S3, US2-S4, SC-002).

### Implementation for User Story 2

- [ ] T012 [US2] Create `src/geometry/faces.ts` — a pure face emitter over the grid from `src/level.ts`, importing neither `three` nor any DOM API, returning per-wall-type position, normal and UV arrays; a vertical face is emitted only where a solid tile borders walkable space, never between two solid tiles, at 1 world unit per tile with floor y=0 and ceiling y=2 (FR-008, US2-S2, US2-S3).
- [ ] T013 [US2] Add floor and ceiling emission to `src/geometry/faces.ts`: one quad per walkable tile at y=0 and y=2 respectively, each tile covered exactly once with no overlapping quads, wound so each is visible from inside the room rather than from above and below (FR-009, US2-S4, US2-S6).
- [ ] T014 [US2] Keep `src/geometry/faces.ts` O(visible faces): write directly into pre-sized typed arrays and allocate no per-tile object that survives the build, so the 4096-tile grid costs one pass and no garbage (FR-008, Edge Cases).
- [ ] T015 [US2] Create `src/geometry/build.ts` — the only new three.js file — turning the arrays from `src/geometry/faces.ts` into one merged `BufferGeometry` and `Mesh` per wall type ID present in the level, never one mesh per tile, plus one floor mesh and one ceiling mesh, using the flat-colour materials declared in `src/level.ts` (FR-007, FR-009, US2-S1).
- [ ] T016 [US2] Have `src/geometry/build.ts` fall back to the declared default material when a wall type ID has no material entry, and return the fallback in its build result so US3 can surface it in `__diag.level.errors` rather than failing the render (FR-007, Edge Cases).
- [ ] T017 [US2] Have `src/geometry/build.ts` run `validateLevel()` from `src/level-validate.ts` first and throw a typed build failure carrying the error list when the grid is invalid, so no geometry is ever built from a malformed map (FR-007, US1-S6).
- [ ] T018 [US2] Create `src/systems/level/register.ts` registering a `level` system through `defineSystem` from `src/boot/registry.ts`: build the geometry once in `setup()`, add the wall, floor and ceiling meshes to `ctx.scene`, add the ambient and directional lights the scene needs now that the placeholder is going away, and seat `ctx.camera` on the player spawn tile at eye height facing the declared yaw (FR-007, US2-S5, US2-S6).
- [ ] T019 [US2] Keep `src/systems/level/register.ts` free of per-frame work: the build happens exactly once during `setup()` and completes in under 100 ms for the shipped 64x64 grid, with no `update` hook rebuilding or re-merging anything (US2-S7).
- [ ] T020 [US2] Have `src/systems/level/register.ts` catch the typed build failure from `src/geometry/build.ts` and render a human-readable message naming the validation errors into the document body instead of a partial level — mirroring the fatal-message behaviour of `src/main.ts` without editing it, since a throw from `setup()` would otherwise leave a blank page (Edge Cases, US1-S6).
- [ ] T021 [US2] Delete `src/systems/spin-cube/register.ts` and its directory — 001's placeholder cube, retired now that `src/systems/level/register.ts` supplies both the geometry and the lights; this is the seam's intended path and touches no shared file (FR-010, US2-S5).

**Checkpoint**: The map renders solid from the spawn tile and `npm run smoke` shows
fewer than 20 draw calls. Level facts are not yet machine-readable.

---

## Phase 3: User Story 3 - Level visibility diagnostics (Priority: P2)

**Goal**: `window.__diag.level` makes map integrity a headless assertion, and
`npm run smoke` fails citing the validator when the map is broken.

**Independent Test**: `npm run smoke` asserts the new level fields are present and match
counts the harness computes independently from the grid; with the corruption flag set,
it exits non-zero citing an entry from `__diag.level.errors`.

### Tests for User Story 3

> Write these first and confirm they fail before implementing.

- [ ] T022 [P] [US3] `tests/unit/level-stats.test.ts`: against `src/level-stats.ts`, assert `floorTiles`, `wallTilesByType`, `doorTiles`, `secretTiles`, `exitTiles` and `wallFaces` equal values computed by hand from the shipped grid; that `bounds` reports a walkable range of at least 40x40 tiles; and that a grid put through the corruption hook validates false with at least one named error (FR-011, US3-S1, US3-S2, US3-S4, SC-005).

### Implementation for User Story 3

- [ ] T023 [US3] Create `src/level-stats.ts` exporting a pure `computeLevelStats()` that takes the exported grid, a `validateLevel()` report and the face arrays from `src/geometry/faces.ts` as arguments — reading US1's modules, never editing them — returning `floorTiles`, `wallTilesByType`, `doorTiles`, `secretTiles`, `exitTiles`, `wallFaces`, `bounds` as `{minX, maxX, minZ, maxZ}` over walkable space, `valid`, and `errors` verbatim from the validator; it imports neither `three` nor any DOM API (FR-011, US3-S1, US3-S2).
- [ ] T024 [US3] Add a `corruptGrid()` hook to `src/level-stats.ts` that returns a copy of the grid with one named row overwritten, so the failure path the smoke gate proves is a real validator rejection rather than a mocked one (FR-012, US3-S5).
- [ ] T025 [US3] Extend the `Diagnostics` interface and `createDiagnostics()` in `src/diag/diag.ts` with a `level` field defaulting to `null`, typed by `src/level-stats.ts` — purely additive, with `ready`, `renderer`, `fps`, `frameTimeMs`, `drawCalls`, `errors` and `fallbackReason` left untouched in name and meaning (FR-011, US3-S3).
- [ ] T026 [US3] Create `src/systems/level-diag/register.ts` registering a `level-diag` system ordered after `level`: compute the stats once in `setup()` and assign them to `ctx.diag.level`, including the default-material fallbacks reported by `src/geometry/build.ts`, and register no `update` hook so the object stays identical across reads while `fps` and `frameTimeMs` keep moving (FR-011, US3-S3, US3-S6).
- [ ] T027 [US3] Have `src/systems/level-diag/register.ts` read a corruption flag from `location.search` and, when set, publish stats computed from `corruptGrid()`'s output so `__diag.level.valid` is false and `__diag.level.errors` is populated on a real page load (FR-012, US3-S5).
- [ ] T028 [US3] Extend `tools/smoke.mjs` from the static check it is today into a headless page drive: build, serve `dist/`, load the page in headless Chromium, wait up to 15s for `window.__diag.ready`, then assert `__diag.level` carries every field of FR-011 and that `__diag.drawCalls` is below 20, keeping the existing `tools/check-no-binaries.mjs` invocation in place (FR-010, FR-011, US3-S1, US3-S2, SC-001, SC-006).
- [ ] T029 [US3] Resolve the browser in `tools/smoke.mjs` from `PLAYWRIGHT_BROWSERS_PATH` / `CHROME_PATH` when set and fail with a message naming the missing browser rather than attempting a download — an Ergane node's `HOME` is tmpfs, so a browser fetched at install time is not present at gate time (plan.md Complexity Tracking).
- [ ] T030 [US3] Have `tools/smoke.mjs` recompute the tile counts for itself, straight from the exported grid rather than through `src/level-stats.ts`, and fail when any value disagrees with the corresponding `__diag.level` field, so a stats bug cannot agree with itself (US3-S4).
- [ ] T031 [US3] Have `tools/smoke.mjs` sample `__diag.level` twice at least 120 frames apart and fail unless the two reads are identical while `fps` and `frameTimeMs` have changed, proving the level object is published once rather than rebuilt per frame (US3-S6).
- [ ] T032 [US3] Add the corrupted-grid pass to `tools/smoke.mjs`: a second page load with the corruption flag set, exiting non-zero and printing at least one entry from `__diag.level.errors`, kept as a permanent harness assertion rather than a one-off demonstration (FR-012, US3-S5, SC-004).
- [ ] T033 [US3] Have `tools/smoke.mjs` fail with the level error text cited whenever `__diag.level.valid` is false or `__diag.level.errors` is non-empty on the normal pass, then confirm all four gates — `typecheck`, `build`, `test`, `smoke` — pass together (FR-012, Article VII).

**Checkpoint**: Map integrity is a machine assertion. Every later spec can prove it did
not break the level without a human loading the page.

---

## Dependencies & Execution Order

### User Story Dependencies

Strictly sequential, as declared in the spec's `## Work Graph` block and compiled into
`workgraph.json`:

- **US1** — no dependencies within this spec. Creates the grid, the spawn tables and the validator.
- **US2** — depends on US1. Has nothing to emit faces from without the grid, and nothing to refuse a bad map with.
- **US3** — depends on US2. `wallFaces` and the draw-call budget do not exist until geometry does.

Cross-spec, the whole epic depends on `001-scaffold` having landed: the toolchain, the
render loop, the system registry and `window.__diag` are all its work, and this spec
extends them rather than re-establishing them.

### Shared files (no cross-story contention)

Each story owns its files outright; no file below is written by two stories:

- **US1** — `src/level.ts`, `src/level-validate.ts`, `tests/unit/level.test.ts`, `tests/unit/level-validate.test.ts`, `tests/unit/level-purity.test.ts`
- **US2** — `src/geometry/faces.ts`, `src/geometry/build.ts`, `src/systems/level/register.ts`, `tests/unit/geometry-faces.test.ts`, and the deletion of `src/systems/spin-cube/register.ts`
- **US3** — `src/level-stats.ts`, `src/systems/level-diag/register.ts`, `src/diag/diag.ts`, `tools/smoke.mjs`, `tests/unit/level-stats.test.ts`

US2 and US3 both *import* US1's modules; neither writes them, and the US1 → US2 → US3
chain already orders those reads behind the write. `src/main.ts` is written by no story
in this spec — that is what the system registry is for.

### Parallel Opportunities

Within a story only, on the tasks marked [P]: T001/T002/T003 in US1; T011 in US2; T022
in US3. Nothing crosses a story boundary, and the three stories are a strict chain.

## Notes

- Test-first is mandatory for anything DOM-free and three.js-free (Article III). In this spec that is most of the work: the grid, the validator, the face emitter and the stats. Only mesh construction and the `__diag` publication are smoke-verified instead.
- Never weaken a gate to make it pass. A failing gate blocks the commit, not the gate.
- Commit once per task (ergane's inner loop; Article VII).
- No source file over 400 lines (Article IV); the split of data from validator and of faces from meshes is what keeps this spec under it. Split further as part of the task that would exceed it.
- Zero binary assets (Article II): the level is a string array and the geometry is generated, so SC-006 holds by construction and `tools/check-no-binaries.mjs` keeps it that way.
- Tile scale — 1 unit per edge, floor y=0, ceiling y=2 — is fixed by T006 and read by 003's collider and 004's door travel. Changing it later is a cross-spec decision for `DECISIONS.md`.
