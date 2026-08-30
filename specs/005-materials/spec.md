---
state: ready
depends_on_landed: ["004-interaction"]
---

# Feature Specification: Procedural Materials and Lighting

**Feature Branch**: `005-materials`

**Created**: 2026-08-29

**Status**: Draft

**Input**: Milestone M4 of the Wolfenstein-style FPS brief. Skins the merged geometry of
M1 without disturbing its draw-call budget: a pure, seeded texture generator that emits
albedo, normal and roughness maps at 512px for five named materials with no canvas and no
three.js in the generating path; per-tile UVs that tile correctly across merged runs;
shadow-mapped point lights, ambient and fog. This is the first spec whose output is
judged by eye, so its acceptance is written against texel values and diagnostics counts
rather than against appearance.

## Clarifications

### Session 2026-08-29

- Q: Where does texture generation live, given Constitution III names "texture pixel generation" as testable pure logic? → A: In a module that returns plain `Uint8ClampedArray` RGBA buffers of a declared size — no canvas, no `document`, no `three` import. A separate thin adapter wraps a buffer into a `DataTexture`. Every texel is therefore assertable under `npm run test`.
- Q: Seeded or arbitrary noise? → A: Seeded, explicitly. Every generator takes `(seed, size)` and the same pair MUST produce a byte-identical buffer, so a texture regression is a diff rather than an opinion.
- Q: How is the normal map derived? → A: From the same height field that drove the albedo, by central-difference slope, encoded tangent-space with +Z out of the surface. Not from albedo luminance — that double-counts colour as depth and makes a dark brick read as a deep hole.
- Q: Does texturing change the draw-call budget? → A: No. Materials attach to the per-wall-type meshes 002 already merged. The `<20 draw calls` ceiling from 002 FR-010 still holds after this spec lands, and the smoke gate keeps asserting it.
- Q: What is the fallback if a map type cannot be produced? → A: A flat normal and a declared constant roughness, plus a line in `DECISIONS.md`. Shipping a surface with no texture at all is not an allowed outcome; degrading one map is.
- Q: Is 512px negotiable? → A: The number lives in one constant. Lowering it is a `DECISIONS.md` entry, not a code change scattered across five call sites.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Deterministic procedural texture generation (Priority: P1)

As the build system, I generate five named wall materials — brick, stone, wood, steel and
blood-stone — from code alone: each a seeded function of `(seed, size)` returning a raw
RGBA buffer and the height field behind it, with no image file, no canvas and no three.js
anywhere in the generating path.

**Why this priority**: Every other story in this spec consumes these buffers. It is also
the story that discharges the project's defining constraint — Constitution II is either
true here or the repository has an art pipeline it was built to avoid.

**Independent Test**: Under `npm run test`, import the generator with no DOM and no
three.js present; call each material at the declared size, assert the buffer length is
`size * size * 4`, assert every channel is within `0..255`, assert two calls with the
same seed hash identically and two calls with different seeds do not, and assert the
material table names exactly the five materials.

**Acceptance Scenarios**:

1. **Given** the texture generator module, **When** its import graph is inspected,
   **Then** it imports neither `three`, nor `document`, nor `HTMLCanvasElement`, and is
   importable from a vitest file that defines no `window`.
2. **Given** the material table, **When** read, **Then** it declares exactly the entries
   `brick`, `stone`, `wood`, `steel` and `blood-stone`, each carrying its own seed and its
   own generation parameters in that one table rather than at its call sites.
3. **Given** any declared material, **When** generated at the declared size, **Then** the
   returned albedo buffer has length `size * size * 4`, contains no `NaN`, and every
   channel value lies in `0..255` inclusive.
4. **Given** the same material generated twice with the same seed and size, **When** the
   two buffers are hashed, **Then** the hashes are equal; **And** given a different seed,
   **Then** the hashes differ.
5. **Given** any two distinct materials generated at the same size, **When** their mean
   channel values are compared, **Then** they differ by more than a declared threshold —
   five materials that all resolve to the same grey is a passing type-check and a failed
   milestone.
6. **Given** a generated material, **When** its buffer is examined for spatial structure,
   **Then** the variance across 16x16 tiles is non-zero for at least three quarters of
   those tiles, so a material cannot pass by being a flat fill.
7. **Given** the declared size constant, **When** the source is searched, **Then** `512`
   appears as that one named constant and not as a literal at any call site.
8. **Given** all five materials generated at load, **When** the elapsed time is measured,
   **Then** the total completes within a declared budget and happens exactly once per
   page load, never inside the frame loop.

---

### User Story 2 - Normal and roughness maps from the height field (Priority: P1)

As the renderer, each material arrives with a tangent-space normal map derived from its
own height field and a roughness map that makes steel read as smooth and stone as rough,
so the level lights like a surface rather than like wallpaper.

**Why this priority**: Albedo alone at 512px looks flat under a moving point light, which
is precisely the lighting M4 introduces. This is also the spec's least guessable API
surface, which is why it carries an explicit fallback rather than a stall.

**Independent Test**: Under `npm run test`, generate each material's normal map from a
known height field; assert a flat region encodes to `(128, 128, 255)` within one unit,
assert a synthetic ramp of known slope encodes to the hand-computed vector, assert every
decoded normal is unit length within tolerance, and assert the roughness means order
correctly across materials.

**Acceptance Scenarios**:

1. **Given** a height field that is constant, **When** its normal map is derived,
   **Then** every texel encodes to `(128, 128, 255)` within ±1 per channel — a flat
   surface is flat.
2. **Given** a height field that is a linear ramp of known slope, **When** its normal map
   is derived, **Then** the encoded vector at an interior texel equals the hand-computed
   tangent-space normal for that slope within a declared tolerance, and its Z component is
   positive everywhere.
3. **Given** any generated normal map, **When** each texel is decoded from `0..255` back
   to `-1..1` and its length measured, **Then** the length is 1 within a declared
   tolerance for every texel.
4. **Given** the normal derivation, **When** inspected, **Then** it reads the material's
   height field and not the luminance of its albedo.
5. **Given** each material's roughness map, **When** its mean is measured, **Then**
   `steel` is strictly smoother than `stone` and `stone` is strictly rougher than `wood`,
   and every value lies within the declared `0..1` range after decoding.
6. **Given** the three maps for one material, **When** their dimensions are compared,
   **Then** all three are the declared size and are addressable by the same UV, so no
   sampling offset exists between albedo and its normal.
7. **Given** a material whose normal or roughness derivation cannot be completed, **When**
   the build proceeds, **Then** that material ships with a flat normal and a declared
   constant roughness, renders with its albedo, and the degradation is recorded as one
   line in `DECISIONS.md` and reported in `window.__diag.materials.fallbacks` — an
   untextured surface is never an allowed outcome.
8. **Given** the generated map set for all five materials, **When** total texture memory
   is computed from the declared size and channel count, **Then** it is reported in
   diagnostics so a resolution change is visible as a number rather than as a stutter.

---

### User Story 3 - Materials bound to merged geometry without breaking the budget (Priority: P1)

As a player, every surface in the level is textured — walls by type, doors, secrets,
floor and ceiling — with the texture tiling once per world tile so a merged 20-tile wall
run reads as twenty bricks rather than one stretched brick, and the whole level still
costs fewer than 20 draw calls.

**Why this priority**: This is the milestone's DONE condition ("fully textured, no
untextured surfaces") and the point where M1's draw-call achievement is most easily
thrown away — a naive per-tile material assignment turns 4096 tiles into 4096 meshes.

**Independent Test**: Build the level's geometry in a unit test and assert every emitted
face carries UVs whose span equals its world-space extent in tiles; then load the built
page headlessly and assert `window.__diag.drawCalls` is still under 20 and
`window.__diag.materials.untexturedMeshes` is 0.

**Acceptance Scenarios**:

1. **Given** the level's wall type IDs from 002, **When** materials are bound, **Then**
   every declared wall type ID maps to exactly one of the five materials through the
   material table, and a type ID with no mapping falls back to 002's declared default
   material rather than rendering untextured.
2. **Given** the shipped level, **When** the scene is walked after load, **Then** the
   count of meshes whose material carries no albedo map is zero, reported as
   `window.__diag.materials.untexturedMeshes`.
3. **Given** door and secret meshes from 004, **When** rendered, **Then** each carries a
   declared material from the same table, distinguishable from the wall type beside it so
   a door reads as a door before it is touched.
4. **Given** floor and ceiling geometry from 002, **When** rendered, **Then** each carries
   its own declared material and neither samples a wall texture.
5. **Given** a merged wall run spanning N tiles, **When** its UVs are read, **Then** the
   UV span across that run equals N — one texture repeat per world tile — so tiling is
   continuous across the merge and no face is stretched.
6. **Given** two adjacent faces of the same material meeting at a corner, **When**
   sampled at the shared edge, **Then** their UVs agree at that edge within a declared
   epsilon; the texture does not visibly break at a merge boundary.
7. **Given** the textured level, **When** `window.__diag.drawCalls` is read at any camera
   position, **Then** it remains below 20 — the ceiling 002 FR-010 established survives
   this spec.
8. **Given** the five materials, **When** the uploaded texture count is read, **Then**
   exactly one set of maps exists per material, shared by every mesh using it, rather than
   one set per mesh.
9. **Given** the running page, **When** the viewport is resized, **Then** no texture is
   regenerated and generation time in diagnostics is unchanged.
10. **Given** any textured surface viewed at a grazing angle across the level's longest
    corridor, **When** rendered, **Then** mipmaps and a declared anisotropy level are in
    effect and the surface does not alias into noise.

---

### User Story 4 - Shadow-mapped lights, ambient and fog (Priority: P2)

As a player, the level is lit rather than merely visible: point lights cast shadows onto
walls and floor, an ambient term keeps unlit corners readable rather than black, and fog
closes the long sight-lines so the maze has depth.

**Why this priority**: The level is playable and fully textured after US3, so this is
refinement of a working system. It is also the story most likely to trade frame budget
for looks, which is why its cost is asserted and its fallback is declared.

**Independent Test**: Load the built page headlessly and read the new diagnostics — light
count, shadow-map size, shadows-enabled flag, fog parameters — asserting each matches its
declared constant; then assert that `fps` after this story remains at or above the
harness floor and that `drawCalls` is still under 20.

**Acceptance Scenarios**:

1. **Given** the running page, **When** the scene's lights are counted, **Then** at least
   two point lights exist, their count and shadow-map size are read from declared
   constants, and both values are reported in diagnostics.
2. **Given** a point light with a wall between it and the floor beyond, **When** a frame
   renders, **Then** that floor region is measurably darker than the same region with the
   wall removed — shadows are cast, not merely enabled.
3. **Given** an unlit corner of the level, **When** sampled, **Then** it is not pure black:
   the declared ambient term keeps geometry readable, so a player cannot walk into an
   invisible wall.
4. **Given** the fog parameters, **When** read, **Then** they are declared constants, and
   the exit tile remains discernible from the far end of the longest sight-line in the
   shipped level rather than being fogged out of existence.
5. **Given** the fully lit and textured level, **When** `window.__diag.fps` is read after
   120 frames, **Then** it remains at or above the floor declared by 001's harness.
6. **Given** shadow-mapped point lights that cannot be made to work on the active backend
   within this story, **When** the build proceeds, **Then** the level ships with ambient
   and fog only, every surface still textured, and the omission is recorded as one line in
   `DECISIONS.md` and surfaced in `window.__diag.materials.fallbacks` — the epic degrades
   rather than stalling.
7. **Given** `window.__diag.materials`, **When** read after the first frame, **Then** it
   carries `generatedMs`, `textureCount`, `bytes`, `untexturedMeshes`, `lights`,
   `shadowsEnabled`, `fallbacks` and a per-material list of `{name, hasNormal,
   hasRoughness}`, additive over the 001–004 contracts with no existing field renamed,
   removed or repurposed.
8. **Given** the smoke harness after this story, **When** it runs against a build where
   any mesh is untextured or draw calls reach 20, **Then** it exits non-zero and prints
   which condition failed.

---

### Edge Cases

- WebGL fallback path with a lower texture-unit budget than WebGPU → the material count is
  five, well inside every browser's minimum, and both backends are exercised by 001's two
  smoke passes; a backend-specific material failure fails the gate rather than silently
  dropping a map.
- A wall type ID present in the grid with no entry in the material table → 002's declared
  default material is used, the substitution is recorded in `__diag.materials.fallbacks`,
  and `untexturedMeshes` stays 0.
- Texture generation throwing for one material → that material falls back to a flat colour
  with a recorded reason; the page still renders and the remaining four are unaffected.
- Generation budget exceeded on a slow machine → generation is measured and reported, not
  raced; exceeding the budget records a diagnostic rather than aborting the load, because a
  slow load is not a broken build.
- Seams at merged-run boundaries where UVs restart → UVs are computed in world-tile space
  (US3-S5), so a merge boundary is not a UV boundary; a visible seam is a UV bug and is
  asserted against in unit tests rather than reviewed by eye.
- Normal map derived at a texel on the buffer's edge → central difference wraps, because
  the textures tile; an edge texel must not encode a cliff that shows as a bright line at
  every tile boundary.
- Shadow acne or peter-panning from a badly chosen bias → bias is a declared constant, and
  the shadow assertion (US4-S2) compares lit versus occluded regions so a bias that
  removes the shadow entirely fails the story.
- Fog density tuned so high that the exit is unreachable by sight → US4-S4 asserts the
  exit stays discernible; fog is atmosphere, never a stealth difficulty change.
- Point lights added faster than the frame budget allows → light count is a declared
  constant and `fps` is asserted after the story, so a lighting regression surfaces in the
  same gate that catches a broken renderer.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The texture generator MUST be a module that imports neither `three` nor any
  DOM API, returning raw `Uint8ClampedArray` RGBA buffers plus the height field they were
  derived from, and MUST be exercisable under `npm run test`.
- **FR-002**: The generator SHALL declare exactly five materials — `brick`, `stone`,
  `wood`, `steel`, `blood-stone` — in one exported table carrying each material's seed and
  parameters, with no generation parameter duplicated at a call site.
- **FR-003**: Generation MUST be deterministic: the same `(seed, size)` pair SHALL produce
  a byte-identical buffer across runs, and distinct seeds SHALL produce differing buffers.
- **FR-004**: Map resolution SHALL be 512x512, declared as a single named constant, and all
  maps MUST be generated exactly once per page load within a declared time budget, never
  inside the frame loop.
- **FR-005**: Each material SHALL carry a tangent-space normal map derived by central
  difference from that material's own height field — not from albedo luminance — encoding a
  flat region as `(128, 128, 255)` within ±1 and decoding to unit length within a declared
  tolerance at every texel.
- **FR-006**: Each material SHALL carry a roughness map whose decoded values lie in `0..1`
  and whose means order such that `steel` is smoother than `stone` and `stone` is rougher
  than `wood`.
- **FR-007**: Where a normal or roughness map cannot be produced for a material, the build
  SHALL ship that material with a flat normal and a declared constant roughness, MUST still
  render its albedo, and SHALL record the degradation in `DECISIONS.md` and in
  `window.__diag.materials.fallbacks`; a surface with no albedo map is never an allowed
  outcome.
- **FR-008**: Every wall type ID declared by 002 SHALL map to exactly one material through
  the material table, with an unmapped ID falling back to 002's declared default material;
  doors, secrets, floor and ceiling SHALL each carry a declared material, and the count of
  meshes with no albedo map MUST be zero.
- **FR-009**: Geometry UVs SHALL be computed in world-tile space at one texture repeat per
  tile edge, so that a merged run of N tiles spans N UV units and adjacent faces of the
  same material agree at a shared edge within a declared epsilon.
- **FR-010**: The textured level MUST report fewer than 20 draw calls from
  `window.__diag.drawCalls` at any camera position, and exactly one set of maps per
  material SHALL be uploaded and shared by every mesh using it.
- **FR-011**: Textures SHALL be mipmapped with a declared anisotropy level and MUST NOT be
  regenerated on window resize.
- **FR-012**: The scene SHALL include at least two shadow-mapped point lights whose count,
  shadow-map size and depth bias are declared constants, such that a surface occluded from
  a light is measurably darker than the same surface unoccluded.
- **FR-013**: The scene SHALL declare an ambient term that keeps unlit geometry readable
  rather than black, and fog whose parameters are declared constants and which MUST leave
  the exit tile discernible along the shipped level's longest sight-line.
- **FR-014**: Where shadow-mapped point lights cannot be made to work on the active
  backend, the build SHALL ship ambient and fog with every surface still textured and
  SHALL record the omission in `DECISIONS.md` and in
  `window.__diag.materials.fallbacks`.
- **FR-015**: The application SHALL extend `window.__diag` with a `materials` object
  carrying `generatedMs`, `textureCount`, `bytes`, `untexturedMeshes`, `lights`,
  `shadowsEnabled`, `fallbacks` and a per-material list of `{name, hasNormal,
  hasRoughness}`, additive over the 001–004 contracts — no existing field renamed, removed
  or repurposed.
- **FR-016**: The smoke harness MUST fail, citing the failing condition, when
  `__diag.materials.untexturedMeshes` is greater than zero, when `__diag.drawCalls` reaches
  20, or when `__diag.fps` falls below the declared floor after this spec lands.

### Key Entities

- **MaterialTable**: the one exported record of the five materials, each with seed,
  generation parameters, roughness range and the wall type IDs it serves. Single source of
  truth for every binding decision in this spec.
- **TextureMaps**: `{albedo, normal, roughness, height}` raw buffers at the declared size —
  pure data, produced with no canvas and no three.js, hashable in a test.
- **HeightField**: the per-material scalar field that drives both the albedo's shading and
  the normal map's slope; deriving normals from anything else is forbidden by FR-005.
- **TileUV**: the world-tile-space UV convention — one repeat per tile edge — that makes
  merged geometry tile correctly.
- **LightingRig**: declared point-light count, shadow-map size, bias, ambient level and fog
  parameters. Constants in one place so tuning is one edit.
- **MaterialDiagnostics**: the `window.__diag.materials` object, additive over 001–004.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: All five materials generate at 512x512 with byte-identical output across two
  runs at the same seed, asserted by hash equality under `npm run test`.
- **SC-002**: Every mesh in the shipped level carries an albedo map —
  `__diag.materials.untexturedMeshes` reads 0 headlessly.
- **SC-003**: `window.__diag.drawCalls` remains below 20 after texturing, measured at the
  spawn tile and at three further camera positions.
- **SC-004**: A flat height field encodes to `(128, 128, 255)` and a known ramp encodes to
  its hand-computed normal, both asserted in unit tests; every generated normal decodes to
  unit length within tolerance.
- **SC-005**: `npm run test` includes at least 12 passing assertions over texture
  generation, determinism, normal encoding and roughness ordering.
- **SC-006**: An occluded floor region measures darker than the same region unoccluded,
  demonstrating shadows are cast rather than configured.
- **SC-007**: Zero binary asset files exist in the tree after this spec lands — five
  materials, three maps each, all generated from code.
- **SC-008**: Any fallback taken under FR-007 or FR-014 appears both in `DECISIONS.md` and
  in `__diag.materials.fallbacks`, so what was traded away is readable without reading the
  diff.

## Assumptions

- 001–004 have landed: `window.__diag`, the smoke harness, merged per-wall-type geometry
  under 20 draw calls, a walking player, and door and secret meshes all exist and pass.
- 002's flat-colour materials are replaced here, not supplemented; the per-wall-type mesh
  split it established is the binding surface this spec attaches to.
- Tile scale is 1 world unit per edge with ceiling at y=2 (fixed by 002), which is what
  makes "one texture repeat per tile" a well-defined UV rule.
- Enemy sprite sheets are out of scope; 006 draws its own sheet with canvas 2D and does not
  consume this spec's material table.
- HUD glyphs and the weapon view-model are out of scope; 007 owns them.
- Headless Chromium under software rendering will not hit the target frame rate of the real
  hardware; the FPS assertions in this spec are against 001's declared harness floor, not
  against 120 fps.
- Physically-based response is three.js's standard material behaviour; this spec supplies
  maps and lights, and does not introduce a custom shading model.

## Work Graph

```yaml
US1:
  depends_on: []
  implements: [FR-001, FR-002, FR-003, FR-004]
US2:
  depends_on: [US1]
  implements: [FR-005, FR-006, FR-007]
US3:
  depends_on: [US2]
  implements: [FR-008, FR-009, FR-010, FR-011]
US4:
  depends_on: [US3]
  implements: [FR-012, FR-013, FR-014, FR-015, FR-016]
```
