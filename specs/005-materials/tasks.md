---
description: "Task list for 005-materials: Procedural Materials and Lighting"
---

# Tasks: Procedural Materials and Lighting

**Input**: Design documents from `/specs/005-materials/`

**Prerequisites**: plan.md (required), spec.md (required for user stories)

**Tests**: Included, and unusually load-bearing. This is the first spec whose output is
judged by eye, so Constitution Article III is what keeps it judgeable at all: texture
generation, normal encoding, roughness ordering, bindings, tile UVs and light placement
are DOM-free and three.js-free and are written test-first. SC-005 requires at least 12
passing assertions over generation, determinism, normal encoding and roughness ordering.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to
- Exact file paths are given in every description

## Path Conventions

Single project. `src/`, `tests/`, `tools/` at repository root, per plan.md. Behaviour is
added by creating `src/systems/<name>/register.ts`, which `src/boot/discover.ts` picks up
by glob — no task in this spec edits `src/main.ts`, `src/boot/registry.ts`,
`src/scene/empty.ts` or `src/diag/diag.ts`.

---

## Phase 1: User Story 1 - Deterministic procedural texture generation (Priority: P1) 🎯 MVP

**Goal**: Five named materials generated from code alone — seeded, byte-reproducible RGBA
buffers plus the height field behind them, with no image file, no canvas and no three.js
anywhere in the generating path.

**Independent Test**: Under `npm run test`, import the generator from a file that defines
no `window`; assert each material's buffer length is `size * size * 4`, every channel is
in `0..255`, same seed hashes equal and different seeds do not, and the table names
exactly five materials.

### Tests for User Story 1

> Write these first and confirm they fail before implementing.

- [ ] T001 [P] [US1] `tests/unit/materials-table.test.ts`: the exported table declares exactly `brick`, `stone`, `wood`, `steel` and `blood-stone`, each carrying its own seed and its own generation parameters rather than repeating them at a call site (FR-002, US1-S2).
- [ ] T002 [P] [US1] `tests/unit/materials-generate.test.ts`: for every material, buffer length is `size * size * 4`, no channel is `NaN` and all lie in `0..255`; two runs at one seed hash equal and two seeds hash differently; any two materials' mean channel values differ by more than the declared threshold; at least three quarters of the 16x16 tiles have non-zero variance (FR-001, FR-003, US1-S3, US1-S4, US1-S5, US1-S6).
- [ ] T003 [P] [US1] `tests/unit/materials-purity.test.ts`: read the sources under `src/materials/` and assert none of the generating modules import `three`, `document` or `HTMLCanvasElement`, that the generator is importable in a vitest file defining no `window`, and that `512` appears only as the named constant and at no call site (FR-001, FR-004, US1-S1, US1-S7).

### Implementation for User Story 1

- [ ] T004 [US1] Create `src/materials/constants.ts` declaring `TEXTURE_SIZE = 512`, the RGBA channel count, the generation time budget in milliseconds and the mean-distinctness threshold — the one place the resolution lives, so lowering it is a `DECISIONS.md` entry rather than five edits (FR-004, US1-S7).
- [ ] T005 [US1] Create `src/materials/rng.ts` with a seeded 32-bit PRNG and a buffer hash, both pure, so that one `(seed, size)` pair yields one byte-identical stream and a texture regression is a hash diff (FR-003, US1-S4).
- [ ] T006 [US1] Create `src/materials/noise.ts` with tiling value noise and an fbm octave sum built on `src/materials/rng.ts`, wrapping at the buffer edge so a texture that repeats has no seam (FR-001, FR-003, US1-S6).
- [ ] T007 [US1] Create `src/materials/table.ts` exporting the `MaterialTable` — the five material names, each with its seed, generation parameters and roughness range; the single source of truth this spec's later stories read (FR-002, US1-S2).
- [ ] T008 [US1] Create `src/materials/patterns.ts` holding the five height-field-and-colour routines — brick lattice, stone speckle, wood grain, brushed steel, blood-stone — kept apart from the orchestrator so neither file approaches the 400-line ceiling (FR-001, FR-002, US1-S5, US1-S6).
- [ ] T009 [US1] Create `src/materials/generate.ts` exporting `generateAlbedo(name, size)` that returns `{ albedo: Uint8ClampedArray, height }` from `src/materials/patterns.ts`, memoized per `(name, size)` so a material is generated exactly once per page load (FR-001, FR-003, FR-004, US1-S3, US1-S8).
- [ ] T010 [US1] Extend `src/materials/generate.ts` with an elapsed-time accumulator measured across all five materials and compared against the budget in `src/materials/constants.ts` — exceeding it records a number for diagnostics rather than aborting the load, and generation never runs inside the frame loop (FR-004, US1-S8).

**Checkpoint**: `npm run test` proves five distinct, deterministic, structured albedo
buffers exist with no DOM, no canvas and no three.js in the path. Nothing renders yet;
`tools/check-no-binaries.mjs` still passes, which is the whole claim of Constitution II.

---

## Phase 2: User Story 2 - Normal and roughness maps from the height field (Priority: P1)

**Goal**: Each material arrives as a full `{albedo, normal, roughness, height}` set —
normals by central difference from that material's own height field, roughness that makes
steel read smooth and stone rough — with a declared degradation instead of a stall.

**Independent Test**: Under `npm run test`, derive a normal map from a constant height
field and assert every texel is `(128, 128, 255)` within ±1; derive from a ramp of known
slope and assert the hand-computed vector; assert every decoded normal is unit length;
assert the roughness means order `steel < wood < stone`.

### Tests for User Story 2

> Write these first and confirm they fail before implementing.

- [ ] T011 [P] [US2] `tests/unit/materials-normal.test.ts`: a constant height field encodes to `(128, 128, 255)` within ±1 per channel; a linear ramp of known slope encodes to the hand-computed tangent-space normal within the declared tolerance with `Z` positive everywhere; every decoded texel is unit length within tolerance; the derivation is driven by the height field, not by albedo luminance (FR-005, US2-S1, US2-S2, US2-S3, US2-S4).
- [ ] T012 [P] [US2] `tests/unit/materials-roughness.test.ts`: every decoded roughness value lies in `0..1`, and the per-material means order such that `steel` is strictly smoother than `stone` and `stone` is strictly rougher than `wood` (FR-006, US2-S5).
- [ ] T013 [P] [US2] `tests/unit/materials-maps.test.ts`: all three maps of a material share the declared size and are addressable by one UV with no sampling offset; a material whose normal derivation throws still returns its albedo with a flat normal and the declared constant roughness and records a fallback; reported byte count equals size × size × channels × map count (FR-005, FR-006, FR-007, US2-S6, US2-S7, US2-S8).

### Implementation for User Story 2

- [ ] T014 [US2] Create `src/materials/normal.ts` deriving a tangent-space normal map from a height field by central difference with `+Z` out of the surface, sampling wrapped at the buffer edge so an edge texel does not encode a cliff that shows as a bright line at every tile boundary (FR-005, US2-S1, US2-S2, US2-S3, Edge Cases).
- [ ] T015 [US2] Create `src/materials/roughness.ts` deriving a roughness map from the same height field within each material's declared roughness range from `src/materials/table.ts`, so `steel` reads smooth and `stone` rough by construction rather than by tuning (FR-006, US2-S5).
- [ ] T016 [US2] Create `src/materials/diagnostics.ts` declaring the whole `materials` shape — `generatedMs`, `textureCount`, `bytes`, `untexturedMeshes`, `lights`, `shadowsEnabled`, `fallbacks` and the per-material `{name, hasNormal, hasRoughness}` list — with `publishMaterialDiagnostics()` and `recordFallback()` writers, reaching `window.__diag` by TypeScript module augmentation of 001's `Diagnostics` interface so `src/diag/diag.ts` is never edited (FR-007, US2-S7).
- [ ] T017 [US2] Create `src/materials/maps.ts` assembling `{albedo, normal, roughness, height}` per material from `src/materials/generate.ts`, `src/materials/normal.ts` and `src/materials/roughness.ts`, all three maps at the declared size and one UV space (FR-005, FR-006, US2-S6).
- [ ] T018 [US2] Extend `src/materials/maps.ts` so a failed normal or roughness derivation ships that material with a flat normal and the declared constant roughness, still applies its albedo, and calls `recordFallback()`; if that path is ever taken, append the one line describing it to `DECISIONS.md` — an untextured surface is never an allowed outcome (FR-007, US2-S7).
- [ ] T019 [US2] Extend `src/materials/maps.ts` with `buildAllMaterialMaps()` publishing `generatedMs` from T010, `textureCount`, `bytes` computed from the declared size and channel count, and the per-material `{name, hasNormal, hasRoughness}` list, so a resolution change is visible as a number rather than as a stutter (FR-007, US2-S8).

**Checkpoint**: every material is a complete map set under `npm run test`, with the
degradation path exercised by a test rather than discovered in a browser. Still nothing
is bound to geometry.

---

## Phase 3: User Story 3 - Materials bound to merged geometry (Priority: P1)

**Goal**: Every surface in the level is textured — walls by type, doors, secrets, floor
and ceiling — with the draw-call ceiling 002 won still intact.

**Independent Test**: Load the built page headlessly and assert
`window.__diag.materials.untexturedMeshes` is 0 and `window.__diag.drawCalls` is under 20.

### Tests for User Story 3

> Write these first and confirm they fail before implementing.

- [ ] T021 [P] [US3] `tests/unit/materials-bindings.test.ts`: every wall type ID 002 declares maps to exactly one of the five materials; an ID with no entry resolves to 002's declared default material rather than to nothing; doors, secrets, floor and ceiling each resolve to a declared material, and a door's material differs from the wall type beside it (FR-008, US3-S1, US3-S3, US3-S4).

### Implementation for User Story 3

- [ ] T022 [US3] Create `src/materials/bindings.ts` mapping 002's wall type IDs, plus doors, secrets, floor and ceiling, onto the five material names US1's material table declares, with an unmapped ID resolving to 002's declared default material and the substitution passed to `recordFallback()` (FR-008, US3-S1, US3-S3, US3-S4).
- [ ] T026 [US3] Create `src/systems/materials/register.ts` registering a system with an `order` above 002's level-geometry system, whose `setup` builds every map set once through `src/materials/maps.ts` and assigns the shared materials to the merged per-wall-type meshes, the door and secret meshes from 004, and the floor and ceiling meshes, via `src/materials/bindings.ts` (FR-008, US3-S1, US3-S3, US3-S4).
- [ ] T028 [US3] Extend `src/systems/materials/register.ts` to walk the scene once after setup, count meshes whose material carries no albedo map, and publish `untexturedMeshes`, `textureCount`, `bytes` and `generatedMs` through `publishMaterialDiagnostics()` (FR-008, FR-010, US3-S2).
- [ ] T030 [US3] Make the single edit this spec makes to `tools/smoke.mjs`: after `__diag` is read back, discover `tools/smoke-checks/*.mjs` and run each module's exported check against it — the same glob seam `src/boot/discover.ts` uses, so US4 and every later spec add an assertion by adding a file rather than by editing this one (FR-010, US3-S5).
- [ ] T031 [US3] Create `tools/smoke-checks/materials.mjs` asserting `__diag.materials.untexturedMeshes` is 0 and `__diag.drawCalls` is under 20 at the spawn tile and three further camera positions — printing which condition failed and exiting non-zero (FR-008, FR-010, US3-S2, US3-S5).

**Checkpoint**: the milestone's DONE condition is machine-checked — no untextured surface,
and 002's draw-call achievement survived being skinned. The level is fully textured, still
flat-lit, and not yet asserted for tiling or cost.

---

## Phase 4: User Story 4 - Tiling, texture economy and the frame budget (Priority: P1)

**Goal**: The texture tiles once per world tile across merged runs, exactly one map set
exists per material, surfaces stay sharp at grazing angles, and the textured level holds
its frame rate with the enemy system live.

**Independent Test**: In unit tests, assert a merged run of N tiles spans N UV units and
adjacent faces agree at a shared edge; then run `npm run smoke` with the enemy system live
and assert it clears the declared FPS floor.

### Tests for User Story 4

> Write these first and confirm they fail before implementing.

- [ ] T020 [P] [US4] `tests/unit/materials-uv.test.ts`: UVs computed for a merged run of N tiles span exactly N UV units on the run's long axis, one repeat per tile edge; two adjacent faces of the same material agree at their shared edge within the declared epsilon; no face is stretched (FR-009, US4-S1, US4-S2).

### Implementation for User Story 4

- [ ] T023 [US4] Create `src/materials/uv.ts` exporting a pure `computeTileUVs(positions, normals)` that derives UVs in world-tile space at one repeat per tile edge — so a merge boundary is not a UV boundary — with the tile edge and the agreement epsilon as named constants in that file (FR-009, US4-S1, US4-S2).
- [ ] T024 [US4] Create `src/materials/texture-adapter.ts`, the only module in `src/materials/` that imports `three`: it wraps a finished buffer into a `DataTexture` with `RepeatWrapping`, mipmaps and the declared anisotropy constant, colour-space sRGB for albedo and linear for normal and roughness (FR-011, US4-S5).
- [ ] T025 [US4] Extend `src/materials/texture-adapter.ts` with a per-name cache that builds exactly one `MeshStandardMaterial` per material, shared by every mesh that uses it, so five materials upload one set of maps each rather than one set per mesh (FR-011, US4-S3).
- [ ] T027 [US4] Extend `src/systems/materials/register.ts` to write each merged `BufferGeometry`'s UV attribute from `src/materials/uv.ts` before the material is attached, so a 20-tile wall run reads as twenty bricks rather than one stretched brick (FR-009, US4-S1, US4-S2).
- [ ] T029 [US4] Give `src/systems/materials/register.ts` a `resize` hook that re-attaches nothing and regenerates no texture, so a viewport change leaves `generatedMs` and the uploaded texture count unchanged (FR-011, US4-S4).
- [ ] T040 [US4] Move map derivation off the animation frame — generate on a worker, or cut the work into per-frame steps — so that building five materials never occupies a frame the page owes the render loop. The floor is not to be lowered; the cost moves (FR-011, US4-S6).
- [ ] T041 [US4] Extend `tools/smoke-checks/materials.mjs` with the cost assertions: exactly one map set exists per material, generation time is unchanged after a viewport resize, and `npm run smoke` clears the declared FPS floor with the enemy system live — printing which condition failed and exiting non-zero (FR-009, FR-011, US4-S3, US4-S4, US4-S6).

**Checkpoint**: tiling is correct across merges, five materials upload one map set each,
and the textured level holds its frame rate alongside the enemies.

---

## Phase 5: User Story 5 - Shadow-mapped lights, ambient and fog (Priority: P2)

**Goal**: The level is lit rather than merely visible — point lights that cast shadows,
an ambient floor that keeps corners readable, and fog that gives the maze depth without
fogging the exit out of existence.

**Independent Test**: Load the built page headlessly and assert the light count,
shadow-map size, shadow flag and fog parameters equal their declared constants; assert an
occluded floor sample is measurably darker than the same sample unoccluded; assert `fps`
is at or above 001's harness floor and `drawCalls` is still under 20.

### Tests for User Story 5

> Write these first and confirm they fail before implementing.

- [ ] T032 [P] [US5] `tests/unit/lighting-rig.test.ts`: the rig reports the declared light count, shadow-map size, depth bias and ambient level; every planned light sits on a walkable tile of 002's grid; and the fog far distance exceeds the shipped level's longest sight-line so the exit tile stays discernible from the far end of it (FR-012, FR-013, US5-S1, US5-S4).

### Implementation for User Story 5

- [ ] T033 [US5] Create `src/lighting/constants.ts` holding the whole `LightingRig` — point-light count, shadow-map size, depth bias, ambient level, fog colour, fog near and fog far — so tuning any of them is one edit in one file and a bias that causes acne is a one-line change (FR-012, FR-013, US5-S1, Edge Cases).
- [ ] T034 [US5] Create `src/lighting/rig.ts` as a pure, three.js-free planner that turns 002's grid and its spawn and exit anchors into light placements and a fog range, so placement is asserted under `npm run test` rather than eyeballed (FR-012, FR-013, US5-S1, US5-S4).
- [ ] T035 [US5] Create `src/systems/lighting/register.ts` registering a system that adds the planned `PointLight`s with shadows, the ambient term and the scene fog from `src/lighting/constants.ts`, enabling the renderer's shadow map through a cast local to this file rather than widening `GameContext` in the shared `src/boot/registry.ts` (FR-012, FR-013, US5-S1, US5-S3).
- [ ] T036 [US5] Extend `src/systems/lighting/register.ts` with a harness-only probe that renders a declared floor region with its occluding wall shown and hidden and returns both mean luminances, plus a sample from an unlit corner — the evidence that shadows are cast rather than merely enabled and that no corner is pure black (US5-S2, US5-S3).
- [ ] T037 [US5] Extend `src/systems/lighting/register.ts` to publish `lights` and `shadowsEnabled` through `publishMaterialDiagnostics()`, completing `window.__diag.materials` as an object additive over the 001–004 contracts with no existing field renamed, removed or repurposed (FR-015, US5-S7).
- [ ] T038 [US5] Extend `src/systems/lighting/register.ts` so that if shadow-mapped point lights cannot be made to work on the active backend, the level ships with ambient and fog only, every surface still textured, `shadowsEnabled` reads false and `recordFallback()` carries the reason; when that path is taken, append the one line FR-014 requires to the repository's decision log — the epic degrades rather than stalling (FR-014, US5-S6).
- [ ] T039 [US5] Create `tools/smoke-checks/lighting.mjs` asserting the light count, shadow-map size, shadow flag and fog parameters match their declared constants, that the probe's occluded sample is darker than its unoccluded one and its corner sample is not black, and that `__diag.fps` after 120 frames is at or above 001's declared floor — failing non-zero and naming the condition, including when `untexturedMeshes` is above zero or `drawCalls` reaches 20 (FR-016, US5-S1, US5-S2, US5-S3, US5-S4, US5-S5, US5-S8).

**Checkpoint**: all four gates green on a lit, fogged, fully textured level, with every
claim in this spec readable from `npm run test` or `npm run smoke` and none of it from a
screenshot.

---

## Dependencies & Execution Order

### User Story Dependencies

Strictly sequential, as declared in the spec's `## Work Graph` block and compiled into
`workgraph.json`:

- **US1** — no dependencies within this spec. Produces the buffers every other story consumes.
- **US2** — depends on US1. Normals come from US1's height field; there is nothing to differentiate before it exists.
- **US3** — depends on US2. Binding a material to a mesh requires the complete map set, including the fallback set.
- **US4** — depends on US3. Lighting a level that still has untextured surfaces would measure the wrong thing; US4's shadow probe assumes US3's materials are attached.

### Cross-spec dependencies

`depends_on_landed: ["004-interaction"]`. This spec attaches to 002's merged per-wall-type
meshes, its wall type IDs, its floor and ceiling geometry and its draw-call budget, *and*
to 004's door and secret meshes (US3-S3, FR-008); 004 in turn cannot land without 002's
grid and 003's player, so `004-interaction` is the single edge that orders this spec
correctly. The claim that M4 is off the critical path is wrong: FR-008 requires a declared
material on doors and secrets, which do not exist before 004.

### Shared files

None between the stories of this spec — that is the point of the module split in plan.md.
Two files deserve a note anyway:

- `tools/smoke.mjs` — edited exactly once, by US3 (T030), and the edit is a discovery loop, so US4's assertions arrive as a new file under `tools/smoke-checks/` rather than as a second edit.
- `DECISIONS.md` — append-only, and both T018 and T038 append to it *only if* their fallback is actually taken. Each append is one new line at the end of the file, which is how every spec in this repository records a fork (Article VIII).

Not touched by any task here: `src/main.ts`, `src/boot/registry.ts`,
`src/boot/discover.ts`, `src/scene/empty.ts`, `src/diag/diag.ts`. Behaviour arrives as
`src/systems/materials/register.ts` and `src/systems/lighting/register.ts`, which the
glob in `discover.ts` finds without an index to append to, and the `materials` field
arrives on `window.__diag` by module augmentation rather than by editing 001's contract.

### Parallel Opportunities

Within a story only, on the tasks marked [P]: T001/T002/T003 in US1; T011/T012/T013 in
US2; T020/T021 in US3. Nothing crosses a story boundary, because nothing may.

## Notes

- Test-first is mandatory for anything DOM-free and three.js-free (Article III); in this spec that is everything under `src/materials/` except `texture-adapter.ts`, and everything under `src/lighting/` except the system. SC-005's floor of 12 assertions is met by T001, T002, T011 and T012 alone.
- The only three.js imports this spec adds are in `src/materials/texture-adapter.ts` and the two `src/systems/*/register.ts` files. A `three` import appearing anywhere else in `src/materials/` fails T003 (FR-001).
- Never weaken a gate to make it pass. A failing gate blocks the commit, not the gate — narrowing the draw-call assertion to accommodate a naive per-tile material assignment is the specific violation this spec invites (Article III).
- Taking FR-007's or FR-014's fallback is a legitimate outcome, not a failure, but it must land in *both* `DECISIONS.md` and `__diag.materials.fallbacks` (SC-008). Shipping a surface with no albedo map is not fallback-able.
- Commit once per task (ergane's inner loop; Article VII).
- No source file over 400 lines (Article IV); `src/materials/patterns.ts` is the one at real risk — split a routine out as part of the task that would exceed it.
