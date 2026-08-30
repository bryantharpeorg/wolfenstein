# Implementation Plan: Level Map and Merged Geometry

**Branch**: `002-map-geometry` | **Date**: 2026-08-29 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-map-geometry/spec.md`

## Summary

Turn 001's empty lit scene into a place. A hand-authored 64x64 grid lives as plain
data in `src/level.ts` with a validator beside it that refuses a malformed map before
anything is built from it; a pure face-emitter turns that grid into culled vertex data
with no three.js in sight; a thin three.js layer merges those faces into one
`BufferGeometry` per wall material plus one floor and one ceiling; and a diagnostics
system publishes the level's tile counts, bounds and validation report under
`window.__diag.level` so the smoke harness can assert map integrity without a human
walking the map.

The load-bearing idea is US1's: the map is *data with a validator*, not geometry. Every
later spec reads this grid — M2 collides against it, M3 opens doors in it, M5 pathfinds
across it, M6 spawns pickups from its spawn table — so the format and its guard rails
are established once, in a module that imports neither `three` nor the DOM, and are
therefore unit-testable rather than only observable on screen.

The second structural idea is that this spec **does not edit `src/main.ts`**. 001
landed a system registry (`src/boot/registry.ts`) with glob-based discovery
(`src/boot/discover.ts`) exactly so a story adds `src/systems/<name>/register.ts` and
touches no shared wiring file. 002 is the first spec to exercise that seam: US2 adds
the level system and retires 001's `spin-cube` placeholder by deleting its directory;
US3 adds a second system beside it rather than extending US2's.

## Technical Context

**Language/Version**: TypeScript 5.x, `strict: true`, targeting ES2022; Node.js 20+ on
the build host. Unchanged from 001.

**Primary Dependencies**: `three` remains the only runtime dependency (Constitution I).
This spec adds none. `BufferGeometry`, `BufferAttribute`, `Mesh`, `MeshStandardMaterial`
and the two light types are all that is used from it.

**Storage**: N/A. The level is source code, not a loaded file — FR-001 requires it
authored in-file, which also keeps Article II satisfied by construction.

**Testing**: `vitest` carries the weight here. Grid parsing, validation, reachability
and — critically — *face emission* are pure functions over the grid, so US2's central
claim ("interior faces are culled, not merely invisible") is a unit assertion on vertex
counts rather than a screenshot. The headless smoke gate carries what only exists
inside the render loop: `drawCalls`, and the `__diag.level` contract itself.

**Target Platform**: Unchanged from 001 — evergreen desktop browsers, WebGPU where
available and WebGL otherwise, headless Chromium with SwiftShader for gate runs.

**Project Type**: Single-project browser application.

**Performance Goals**: Fewer than 20 draw calls at any camera position (FR-010), which
the structure makes near-automatic: at most 9 wall meshes, one floor, one ceiling. Geometry
is built exactly once during system `setup()` and must complete in under 100 ms for the
shipped 64x64 grid (US2-S7); nothing in this spec allocates per frame.

**Constraints**: Zero binary assets (Constitution II) — the entire level is a string
array and generated buffers, so SC-006 holds by construction. No source file over 400
lines (Constitution IV), which is what splits the validator out of `src/level.ts`. Tile
scale is fixed here for the whole project: 1 world unit per tile edge, floor at y=0,
ceiling at y=2; M2's collider and M3's door travel read it from this spec.

**Scale/Scope**: Three stories, one strictly ordered chain (US1 → US2 → US3), matching
the spec's `## Work Graph`. Cross-spec, this depends only on `001-scaffold` having
landed: it needs the toolchain, the render loop, the system registry and `window.__diag`,
all of which 001 owns, and nothing else exists yet to depend on.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Article | Bearing on this spec | Status |
|---|---|---|
| I. Stack is fixed | three.js only, and only in `src/geometry/build.ts` and the two system registrations. No engine, no physics library, no mesh-merging dependency — `BufferGeometry` assembled by hand is the merge. | PASS |
| II. Zero binary assets | The level is a string array; geometry is generated; wall materials are flat colours until M4. SC-006 states it and `tools/check-no-binaries.mjs` enforces it inside the smoke gate. | PASS |
| III. Test-first, smoke-tested always | `src/level.ts`, `src/level-validate.ts`, `src/geometry/faces.ts` and `src/level-stats.ts` are DOM-free and three.js-free by design, so grid, validation, face culling and tile counts are all vitest-testable. Only mesh construction and the `__diag` publication need the browser, and those are covered by the smoke gate. | PASS — the split exists for this article |
| IV. File size ceiling (400) | A 64-row grid plus spawn tables plus a nine-category validator would not fit one file. Data lives in `src/level.ts`, validation in `src/level-validate.ts`, face emission in `src/geometry/faces.ts`, mesh assembly in `src/geometry/build.ts`. | PASS |
| V. Prefer editing to authoring | US3 extends `src/diag/diag.ts` and `tools/smoke.mjs` rather than creating parallel diagnostics. New files appear only where 001 left a seam expecting them. | PASS |
| VI. Original work only | FR-002 is explicit: the layout is designed by hand for this file in the *spirit* of a grid maze — right angles, locked doors, secrets, elevator exit — and must not reproduce id Software's E1M1 data. | PASS |
| VII. Every task ends green and committed | All four gates exist as of 001. No bootstrap exception applies from this spec onward. | PASS |
| VIII. Design forks decided, not asked | Two forks are pre-decided below and belong in `DECISIONS.md` when taken: the validator's file placement, and doors/secrets rendering as ordinary closed walls. | PASS |

**Note on Article V and `src/main.ts`.** The strongest form of "prefer editing" here is
*not editing*. `src/main.ts` is bootstrap only and 001 left a test
(`tests/unit/systems-discovery.test.ts`) asserting it never names an individual system.
This spec adds two system directories and changes `src/main.ts` by zero lines.

## Project Structure

### Documentation (this feature)

```text
specs/002-map-geometry/
├── spec.md              # The feature specification
├── plan.md              # This file
├── tasks.md             # Task breakdown (/speckit-tasks output)
└── workgraph.json       # Ergane's compiled node graph (ergane spec derive)
```

### Source Code (repository root)

```text
src/
├── main.ts                       # UNCHANGED by this spec — bootstrap only
├── level.ts                      # US1: the 64x64 grid, spawn set, door-lock table,
│                                 #      wall-material table, tile-scale constants. Pure data.
├── level-validate.ts             # US1: validateLevel() — dimensions, exit, spawn placement,
│                                 #      door/secret adjacency, lock and material coverage,
│                                 #      reachability BFS. Pure; returns named errors.
├── level-stats.ts                # US3: computeLevelStats() over grid + faces + report,
│                                 #      and the corruptGrid() hook the smoke flag uses. Pure.
├── geometry/
│   ├── faces.ts                  # US2: PURE face emission — culls faces between two solid
│   │                             #      tiles, emits floor/ceiling quads. No three.js import,
│   │                             #      so SC-002's vertex counts are a unit test.
│   └── build.ts                  # US2: the only new three.js file — merges faces into one
│                                 #      BufferGeometry per wall type, plus floor and ceiling
├── systems/
│   ├── level/register.ts         # US2: builds geometry once in setup(), adds the meshes and
│   │                             #      the scene's lights, seats the camera at the spawn tile
│   ├── level-diag/register.ts    # US3: publishes window.__diag.level once; reads the
│   │                             #      corruption flag from location.search
│   └── spin-cube/register.ts     # DELETED by US2 — 001's placeholder, retired as designed
├── diag/diag.ts                  # US3: Diagnostics gains `level`, additively (FR-011)
├── boot/                         # Unchanged (registry + glob discovery)
├── renderer/                     # Unchanged
├── overlay/                      # Unchanged
└── scene/empty.ts                # Unchanged — the shell stays contentless

tests/unit/
├── level.test.ts                 # US1: grid shape, cell alphabet, counts, spawn tables
├── level-validate.test.ts        # US1: one case per malformed grid in Edge Cases
├── level-purity.test.ts          # US1: asserts src/level.ts imports neither three nor the DOM
├── geometry-faces.test.ts        # US2: perimeter-only counts, enclosed tile emits nothing
└── level-stats.test.ts           # US3: counts and bounds match hand-computed values

tools/
└── smoke.mjs                     # US3: gains the headless page drive and the __diag.level
                                  #      assertions; still runs check-no-binaries.mjs
```

**Structure Decision**: Three seams, each drawn where Article III can act on it.

*Data / validation.* FR-001 fixes the path `src/level.ts` and the spec's Key Entities
call it "data only", so `validateLevel()` cannot live there and Article IV would forbid
it anyway. The validator is `src/level-validate.ts`, a sibling file, **not** a
`src/level/` directory — a directory of that name sitting beside `src/level.ts` shadows
the exact path the spec fixes and makes `import './level'` ambiguous to a reader even
though TypeScript resolves it.

*Pure faces / three.js meshes.* `src/geometry/faces.ts` takes the grid and returns typed
arrays; `src/geometry/build.ts` wraps those in `BufferGeometry`. This is what makes
US2-S2 and US2-S3 — "exactly 12 vertical faces for a 3x3 block", "zero vertices for an
enclosed tile" — assertions in vitest rather than claims. It is also the seam M4 needs:
procedural textures attach to the meshes `build.ts` produces without the face emitter
changing at all.

*One system per story.* `src/systems/level/` and `src/systems/level-diag/` are separate
directories on purpose. They are discovered by glob, so neither story appends to an
index, and US3 never edits a file US2 wrote. Deleting `src/systems/spin-cube/` is the
first real use of the property 001 built the registry for.

## Complexity Tracking

*No Constitution violations to justify.* Three environmental facts are recorded here
because each changes how a task must be written:

| Constraint | Why it matters | Consequence for tasks |
|---|---|---|
| `tools/smoke.mjs` as landed is a static check, not a page drive | 001's spec described a harness that loads the built page in headless Chromium and reads `window.__diag`; what landed checks for binary assets and for `dist/index.html`. FR-012 and US3-S1 require reading `__diag.level` back from a *running* page, so that capability does not yet exist. | US3 must add the headless page load to `tools/smoke.mjs` itself, not merely add assertions to an existing one — and it must honour `PLAYWRIGHT_BROWSERS_PATH` / `CHROME_PATH` and fail naming the missing browser rather than downloading one, per 001's own Complexity Tracking: an Ergane node's `HOME` is tmpfs and a browser fetched at install time is gone by gate time. |
| Retiring `spin-cube` removes the scene's only lights | 001's placeholder system owns the `AmbientLight` and `DirectionalLight` as well as the cube. `src/scene/empty.ts` is deliberately contentless. Deleting the directory without replacing the lights renders a correct level as a black screen, and `drawCalls` would still pass. | The task that adds `src/systems/level/register.ts` must add the scene lighting in the same task, and the deletion of `src/systems/spin-cube/register.ts` must be ordered *after* it. |
| `validateLevel()` failure must not reach the user as a stack trace | The Edge Cases require a human-readable failure rendered into the document body, "reusing 001's renderer-failure path" — but that path is `showFatalMessage`, a private function inside `src/main.ts`, and this spec does not edit `src/main.ts`. | `src/systems/level/register.ts` catches the build failure and writes its own readable message into the document body, mirroring 001's behaviour rather than importing it. A system's `setup()` throwing would otherwise propagate into the bootstrap's setup loop and leave a blank page with only a console error. |
