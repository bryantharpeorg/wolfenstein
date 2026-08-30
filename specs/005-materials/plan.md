# Implementation Plan: Procedural Materials and Lighting

**Branch**: `005-materials` | **Date**: 2026-08-30 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/005-materials/spec.md`

## Summary

Skin the merged geometry 002 emitted, without spending any of the draw-call budget it
won. Five materials — `brick`, `stone`, `wood`, `steel`, `blood-stone` — are generated
from code as raw `Uint8ClampedArray` RGBA buffers at 512px by a module that imports
neither `three` nor any DOM API, so every texel is assertable under `npm run test`
(Constitution III, FR-001). A thin adapter is the only place a buffer meets three.js.
Normals come from each material's own height field by central difference, never from
albedo luminance (FR-005). UVs are computed in world-tile space so a merged 20-tile run
reads as twenty bricks (FR-009). Then the level is lit: shadow-mapped point lights,
an ambient floor that keeps corners readable, and fog that closes the sight-lines
(FR-012, FR-013).

The load-bearing idea is US1's: **generation is pure data, and rendering is a separate
adapter**. This is what turns "does the level look right" — the first question in this
project no gate can answer by eye — into hash equality, texel ranges, encoded-normal
arithmetic and a per-material distinctness threshold, all of which a vitest run decides
without a browser. Everything left over that genuinely only exists inside the render
loop — draw calls, untextured meshes, shadow contrast, frame rate — is reported through
`window.__diag.materials` and asserted by the smoke harness instead.

The second structural idea is that **no story in this spec edits a file another story in
this spec writes**. 001 ended with a system registry (`src/boot/registry.ts`) discovered
by glob (`src/boot/discover.ts`) precisely because all three of its stories collided in
`src/main.ts`. This spec adds behaviour by adding `src/systems/materials/register.ts`
and `src/systems/lighting/register.ts` — two directories, two stories, zero edits to
`src/main.ts`, `src/scene/empty.ts` or `src/boot/registry.ts`.

## Technical Context

**Language/Version**: TypeScript 5.x, `strict: true`, ES2022. Node.js 20+ on the build
host. No new language features, no new toolchain.

**Primary Dependencies**: none added. `three` remains the only runtime dependency
(Constitution I); `DataTexture`, `MeshStandardMaterial`, `PointLight`, `AmbientLight`
and `Fog` are all core three.js. No noise library, no texture library, no image codec —
FR-001 exists to keep that door shut.

**Storage**: N/A. Generated buffers live in module-level memory for the page's lifetime
and are never persisted; FR-004's "exactly once per page load" is a memo, not a cache
on disk.

**Testing**: `vitest` carries this spec. Texture generation, PRNG determinism, the
material table, normal encoding, roughness ordering, the tile-UV rule and the lighting
rig's placement math are all DOM-free and three.js-free, so all of them are written
test-first (Constitution III, SC-005 requires at least 12 passing assertions). The
render-loop facts — `drawCalls`, `untexturedMeshes`, `lights`, `shadowsEnabled`, `fps`,
and the occluded-versus-unoccluded luminance comparison of US4-S2 — are asserted by
`npm run smoke` through `window.__diag.materials` and a harness-only probe.

**Target Platform**: Evergreen desktop browsers, WebGPU where available and WebGL
otherwise; both smoke passes from 001 exercise this spec. Five materials × three maps is
15 textures, far inside every browser's minimum texture-unit budget, so no backend needs
a reduced material set (Edge Cases).

**Project Type**: Single-project browser application. No backend, no API.

**Performance Goals**: Generation is a load-time cost measured against a declared budget
constant and reported as `__diag.materials.generatedMs`; exceeding it records a
diagnostic rather than aborting the load (Edge Cases). Per-frame, this spec must give up
nothing: `drawCalls` stays below 20 (FR-010) and `fps` stays at or above 001's declared
harness floor (FR-016) — the same floor, because a SwiftShader pass is not being asked
to hit the real hardware's 120 fps.

**Constraints**: Zero binary assets (Constitution II) — this is the spec where that
article is either true or the project has an art pipeline it was built to avoid; SC-007
re-asserts it after five materials land. No source file over 400 lines (Constitution IV),
which is why the five pattern routines sit in their own module apart from the generation
orchestrator. `window.__diag` is 001's contract: this spec extends it additively with a
`materials` object and renames, removes and repurposes nothing (FR-015).

**Scale/Scope**: Four stories in one strict chain (US1 → US2 → US3 → US4), matching the
spec's Work Graph. Roughly a dozen new modules under `src/materials/`, `src/lighting/`
and two `src/systems/` directories, plus one harness check per rendering story.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Article | Bearing on this spec | Status |
|---|---|---|
| I. Stack is fixed | No dependency added. `DataTexture`, `MeshStandardMaterial`, `PointLight`, `Fog` are core three.js; the physical response is three.js's standard material, not a custom shading model (Assumptions) | PASS |
| II. Zero binary assets | The whole point. Five materials × three maps, every texel from a seeded function; SC-007 asserts the tree still holds no binaries, enforced inside the smoke gate by `tools/check-no-binaries.mjs` | PASS — the spec *is* this article |
| III. Test-first, smoke-tested always | Generation, normal encoding, roughness ordering, bindings, tile UVs and light placement are DOM-free and three.js-free modules under `src/materials/` and `src/lighting/`, written test-first. `src/systems/*/register.ts` is the only three.js-touching code, verified through `__diag` | PASS |
| IV. File size ceiling (400) | Patterns, generation, normals, roughness, map assembly, diagnostics, bindings, UVs, the texture adapter and the material cache are separate modules; the five pattern routines are the one place the ceiling is a live risk and they are split out for it | PASS |
| V. Prefer editing to authoring | Within a story, later tasks amend that story's own modules rather than adding more. Across stories the split is deliberate — see Complexity Tracking for why authoring wins here | PASS with note |
| VI. Original work only | No id Software texture data. Brick, stone, wood, steel and blood-stone are noise fields and lattices written here; the layouts they sit on are 002's original level | PASS |
| VII. Every task ends green and committed | All four gates exist from 001 and stay green after every task; no bootstrap exception applies to this spec | PASS |
| VIII. Design forks decided, not asked | FR-007 and FR-014 are pre-decided degradations, and using one is a legitimate outcome recorded in `DECISIONS.md` and `__diag.materials.fallbacks` rather than a question asked of the operator | PASS |

**Note on Article V.** Article V prefers growing an existing file, and the build engine
is measurably faster at editing than at authoring (specs/README.md). This spec still
gives each story its own modules, because a file two stories both write is a merge
conflict the second node did not cause and is charged for. The compromise: stories are
module-disjoint, and *within* a story tasks amend what its earlier tasks created.

## Project Structure

### Documentation (this feature)

```text
specs/005-materials/
├── spec.md              # The feature specification
├── plan.md              # This file
├── tasks.md             # Task breakdown (/speckit-tasks output)
└── workgraph.json       # Ergane's compiled node graph (ergane spec derive)
```

### Source Code (repository root)

```text
src/
├── materials/                 # NEW. Pure data in, pure data out — except the adapter.
│   ├── constants.ts           # US1. TEXTURE_SIZE = 512 (FR-004), channel count,
│   │                          #      generation budget ms, distinctness threshold
│   ├── rng.ts                 # US1. Seeded PRNG + buffer hash; same seed, same bytes (FR-003)
│   ├── noise.ts               # US1. Tiling value noise / fbm over rng.ts
│   ├── patterns.ts            # US1. The five height+colour routines, split out for Article IV
│   ├── table.ts               # US1. MaterialTable: name, seed, params, roughness range (FR-002)
│   ├── generate.ts            # US1. generateAlbedo(name, size) -> {albedo, height}, memoized
│   │                          #      once per page load, elapsed time accumulated (FR-004)
│   ├── normal.ts              # US2. Central-difference tangent-space normals, wrapping (FR-005)
│   ├── roughness.ts           # US2. Height field -> roughness, ordered by material (FR-006)
│   ├── maps.ts                # US2. TextureMaps assembly + the FR-007 flat-normal fallback
│   ├── diagnostics.ts         # US2. MaterialDiagnostics shape, publish/record helpers,
│   │                          #      module augmentation of 001's Diagnostics (FR-015)
│   ├── bindings.ts            # US3. wall type ID -> material, doors/secrets/floor/ceiling,
│   │                          #      002's default for an unmapped ID (FR-008)
│   ├── uv.ts                  # US3. World-tile-space UVs, one repeat per tile edge (FR-009)
│   └── texture-adapter.ts     # US3. The ONE file where a buffer becomes a DataTexture:
│                              #      mipmaps, RepeatWrapping, declared anisotropy (FR-011)
├── lighting/                  # NEW. US4, and pure the same way materials/ is.
│   ├── constants.ts           # US4. LightingRig: light count, shadow-map size, bias,
│   │                          #      ambient level, fog colour/near/far (FR-012, FR-013)
│   └── rig.ts                 # US4. Light placement + fog range from level anchors; no three.js
└── systems/                   # EXISTING seam from 001. Glob-discovered; no shared index.
    ├── materials/register.ts  # US3. Builds maps once, shares one material per name,
    │                          #      applies to 002/004 meshes, counts untextured
    └── lighting/register.ts   # US4. Lights, shadows, ambient, fog + the harness probe

tests/unit/                    # vitest: DOM-free, three.js-free only
├── materials-generate.test.ts # US1
├── materials-table.test.ts    # US1
├── materials-purity.test.ts   # US1 — import graph and the single 512 constant (US1-S1, US1-S7)
├── materials-normal.test.ts   # US2
├── materials-roughness.test.ts# US2
├── materials-maps.test.ts     # US2
├── materials-bindings.test.ts # US3
├── materials-uv.test.ts       # US3
└── lighting-rig.test.ts       # US4

tools/
├── smoke.mjs                  # US3 makes ONE edit: discover and run tools/smoke-checks/*.mjs
└── smoke-checks/
    ├── materials.mjs          # US3. untexturedMeshes, drawCalls, textureCount, resize
    └── lighting.mjs           # US4. lights, shadowsEnabled, fog, shadow probe, fps (FR-016)
```

**Structure Decision**: Single-project layout, extending 001's. Three things about the
split are load-bearing rather than decorative.

*The generator/adapter seam.* `src/materials/` imports no `three` and no DOM anywhere
except `texture-adapter.ts`, which does nothing but wrap a finished buffer. That single
boundary is what makes the milestone's output assertable: `generate.ts` can be imported
from a vitest file that defines no `window` (US1-S1), and a texture regression is a hash
diff rather than an opinion.

*The diagnostics module.* `src/materials/diagnostics.ts` declares the whole FR-015 shape
up front — `generatedMs`, `textureCount`, `bytes`, `untexturedMeshes`, `lights`,
`shadowsEnabled`, `fallbacks`, and the per-material `{name, hasNormal, hasRoughness}`
list — and exposes `publishMaterialDiagnostics()` and `recordFallback()`. US3 and US4
fill their own fields *through* those functions from their own system files, so nobody
edits it after US2 writes it. It reaches `window.__diag` by TypeScript module
augmentation of 001's `Diagnostics` interface, not by editing `src/diag/diag.ts` — that
file is 001's contract and every later spec would otherwise queue up to extend it.

*The harness discovery loop.* `tools/smoke.mjs` is the other file every spec wants. US3
makes one edit to it — a loop over `tools/smoke-checks/*.mjs` calling each module's
exported check against the page's `__diag` — mirroring `src/boot/discover.ts`. After
that, US4 adds an assertion by adding a file, and so can 006 through 008.

`src/main.ts` is not edited by this spec at all, and neither is `src/boot/registry.ts`:
the lighting system casts `ctx.renderer` locally to reach `shadowMap` rather than
widening the shared `GameContext`.

## Complexity Tracking

*No Constitution violations to justify.* Three constraints are recorded here because
each one changes how a task must be written.

| Constraint | Why it matters | Consequence for tasks |
|---|---|---|
| Article V says grow existing files; slice contention says do not | The engine is ~6× faster editing than authoring, so the cheapest spec would put all five materials' code in one module and all four stories in it. Ergane prices the resulting merge conflict as a defect against whichever node lands second, and these four stories are a strict chain whose nodes are dispatched separately. | Each story owns its own modules; no task edits a file another story in this spec creates. Within a story, later tasks amend that story's earlier files. The one genuinely shared file, `tools/smoke.mjs`, is edited exactly once, by US3, and the edit is a discovery loop so nobody has to edit it again. |
| `window.__diag` is 001's contract and four other specs also extend it | Editing the `Diagnostics` interface in `src/diag/diag.ts` puts 002, 003, 004, 005, 006, 007 and 008 on adjacent lines of one file, which is a conflict for six of them. FR-015 also forbids touching any existing field's meaning. | This spec adds its fields by declaration-merging `Diagnostics` from `src/materials/diagnostics.ts`. No task edits `src/diag/diag.ts`. The smoke check asserts the 001–004 fields are still present and unchanged alongside the new `materials` object. |
| "Shadows are cast, not merely enabled" (US4-S2) is not readable from a config flag | `shadowsEnabled: true` proves nothing; a bias that removes every shadow passes it. The assertion has to compare rendered luminance with and without an occluder, which is a render-loop fact no vitest run can reach. | US4 adds a harness-only probe in `src/systems/lighting/register.ts` that renders a declared floor region twice — occluder shown, occluder hidden — and returns both mean luminances to `tools/smoke-checks/lighting.mjs`, which asserts the occluded sample is measurably darker and that the unlit-corner sample is not pure black (US4-S3). |
