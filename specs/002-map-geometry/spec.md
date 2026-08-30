---
state: landed
depends_on_landed: ["001-scaffold"]
---

# Feature Specification: Level Map and Merged Geometry

**Feature Branch**: `002-map-geometry`

**Created**: 2026-08-29

**Status**: Draft

**Input**: Milestone M1 of the Wolfenstein-style FPS brief. Turns the empty lit scene of
M0 into a place: a hand-authored 64x64 grid level expressed as data in a pure module,
merged wall/floor/ceiling geometry emitted at one draw call per material rather than one
mesh per cube, and level facts added to `window.__diag` so the smoke harness can assert
map integrity without a human looking at a screen.

## Clarifications

### Session 2026-08-29

- Q: Is the map id Software's E1M1? → A: No. Constitution VI — an original layout designed by hand in this file, in the *spirit* of E1M1 (grid maze, right angles, locked doors, secrets, elevator exit).
- Q: How large is the playable footprint of a 64x64 grid? → A: At least 40x40 tiles of contiguous walkable space. The remaining tiles may be solid rock; a 64x64 border of solid wall is required so nothing can leave the map.
- Q: Are doors and secrets *built* here? → A: No. This spec marks them in data (`D`, `S`) and renders them closed as an ordinary wall. M3 owns their behaviour.
- Q: What tile dimensions does geometry use? → A: 1 world unit per tile edge, floor at y=0, ceiling at y=2. Fixed by this spec; later specs read from it.
- Q: Does the level module import three.js? → A: No — parsing and validation are pure (Constitution III). Geometry building is a separate module that does import three.js.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Level data format and validator (Priority: P1)

As the build system, I read a level from `src/level.ts` as plain data — a 64x64 grid
where `0` is empty floor, `1..n` are wall type IDs, `D` is a door, `S` is a secret
push-wall, `E` is the exit, plus a player spawn point and item/enemy spawn markers — and
a validator that refuses a malformed map before any geometry is built from it.

**Why this priority**: Every later spec reads this grid — M2 collides against it, M3
opens doors in it, M5 pathfinds across it. If the format is wrong or ambiguous, all of
them are wrong, and a bad map is the kind of bug that hides until playtest.

**Independent Test**: Run `npm run test` on a suite that imports `src/level.ts` with no
DOM and no three.js present; assert the grid parses to 64 rows of 64 cells, that
`validateLevel()` returns no errors for the shipped layout, and that it returns a named
error for each of the malformed grids in Edge Cases below.

**Acceptance Scenarios**:

1. **Given** `src/level.ts`, **When** its import graph is inspected, **Then** it
   imports neither `three` nor any DOM API, and it is importable from a vitest file
   that defines no `window`.
2. **Given** the exported grid, **When** read, **Then** it is 64 rows by 64 columns of
   single-character cells drawn from `0`, `1`..`9`, `D`, `S`, `E`, authored in-file as
   a string array or numeric rows — not loaded from a file and not generated at runtime.
3. **Given** the shipped layout, **When** counted, **Then** it declares at least 4 wall
   type IDs, at least 4 `D` cells, at least 2 `S` cells, exactly 1 `E` cell, and every
   tile on the grid's outer border is non-empty.
4. **Given** the exported spawn data, **When** read, **Then** it names a player spawn
   tile that is empty and facing a declared yaw; between 6 and 10 enemy spawn tiles
   inclusive that are empty and mutually at least 3 tiles apart; at least 12 item spawn
   tiles each on an empty tile with a kind drawn from the declared set `health`, `ammo`,
   `treasure`, `silver-key`, `gold-key`, containing exactly one `silver-key`, exactly one
   `gold-key` and at least 3 `treasure`; and a door-lock table naming every `D` tile's
   lock kind from `none`, `silver`, `gold`, with at least one silver-locked and at least
   one gold-locked door.
5. **Given** `validateLevel()`, **When** run against the shipped layout, **Then** it
   returns an empty error list and reports the counts of floor tiles, wall tiles by type,
   doors, secrets, and exits.
6. **Given** a grid with zero `E` cells, **When** validated, **Then** the error list
   contains an entry naming `exit`, and geometry building from that grid throws rather
   than rendering.
7. **Given** a grid with two `E` cells, **When** validated, **Then** the error list
   names `exit` and cites both offending coordinates.
8. **Given** a player spawn unreachable from the exit by 4-neighbour moves across empty,
   door and secret tiles, **When** validated, **Then** the error list names `reachability`.
9. **Given** a grid that is not square, or not 64x64, **When** validated, **Then** the
   error list names `dimensions` and no exception escapes the validator.
10. **Given** an enemy or item spawn on a non-empty tile, or a wall cell whose type ID
    has no entry in the material table, **When** validated, **Then** each is reported as
    a separate named error citing its coordinates.

---

### User Story 2 - Merged geometry at one draw call per material (Priority: P1)

As the renderer, I receive the level as three merged `BufferGeometry` objects — walls,
floor, ceiling — so that the whole map costs one draw call per wall material instead of
one mesh per cube, and only faces that border visible space are emitted at all.

**Why this priority**: This is the milestone's stated DONE condition (`<20 draw calls`)
and the difference between a level that runs and a level that compiles. Forty-plus
thousand potential cube faces at one mesh each would put the frame budget on its head,
and nothing downstream can compensate for it.

**Independent Test**: Build geometry from the shipped grid in a unit test with three.js
imported directly; assert the emitted vertex/index counts equal the hand-computable
figure for visible faces only, and separately read `window.__diag.drawCalls` from the
running page and assert it is under 20.

**Acceptance Scenarios**:

1. **Given** the shipped grid, **When** wall geometry is built, **Then** exactly one
   mesh exists per distinct wall type ID present in the level, each with a
   `BufferGeometry`, and the sum of their draw calls is at most 9.
2. **Given** a solid 3x3 block of wall tiles inside open space, **When** its geometry is
   built, **Then** exactly 12 vertical faces are emitted — the perimeter — and zero faces
   between two adjacent solid tiles.
3. **Given** a wall tile with all four neighbours solid, **When** geometry is built,
   **Then** that tile contributes zero vertices.
4. **Given** floor and ceiling geometry, **When** built, **Then** each is a single mesh
   covering every empty tile exactly once at y=0 and y=2 respectively, with no duplicated
   or overlapping quads.
5. **Given** the running page after this story, **When** `window.__diag.drawCalls` is
   read at any camera position, **Then** it is fewer than 20.
6. **Given** the running page, **When** the camera is placed in the spawn tile, **Then**
   walls, floor and ceiling are all present as solid surfaces with correct winding — no
   face is invisible from the side a player would see it from.
7. **Given** geometry build time for the shipped 64x64 grid, **When** measured once at
   load, **Then** it completes in under 100 ms and happens exactly once, not per frame.

---

### User Story 3 - Level visibility diagnostics (Priority: P2)

As the verification system, I read level facts from `window.__diag` — tile counts, wall
face count, visible region bounds, and the validator's report — so map integrity is a
headless assertion rather than someone walking the map in a browser.

**Why this priority**: The geometry can look right at spawn and be missing a wing. This
story makes that detectable by machine, which is how every later spec verifies it did not
break the map. It is P2 only because US1 and US2 deliver the playable milestone without
it.

**Independent Test**: Run `npm run smoke` and assert the new level fields are present and
match the counts computed independently in the harness from the grid; then deliberately
corrupt one row behind a test flag and assert the harness exits non-zero citing the
level error.

**Acceptance Scenarios**:

1. **Given** `window.__diag.level`, **When** read after the first frame, **Then** it is
   an object with at least `floorTiles` (integer), `wallTilesByType` (object keyed by
   wall type ID), `doorTiles` (integer), `secretTiles` (integer), `exitTiles` (integer)
   and `wallFaces` (integer).
2. **Given** the same object, **When** read, **Then** it also carries `bounds` — `{minX,
   maxX, minZ, maxZ}` integers naming the tile range of walkable space — and `valid`
   (boolean) plus `errors` (array of strings), the latter being `validateLevel()`'s
   output verbatim.
3. **Given** every field added by this story, **When** compared to 001's contract
   (`ready`, `renderer`, `fps`, `frameTimeMs`, `drawCalls`, `errors`), **Then** no
   existing field is removed, renamed, or given a new meaning, and the additions live
   under `window.__diag.level` rather than at its top level.
4. **Given** the shipped layout, **When** the harness recomputes tile counts from the
   grid source, **Then** each value equals the corresponding `__diag.level` field.
5. **Given** a deliberately corrupted grid behind a build flag, **When** `npm run smoke`
   runs, **Then** it exits non-zero and prints at least one entry from
   `__diag.level.errors`.
6. **Given** the running page, **When** 120 frames have elapsed, **Then**
   `__diag.level` is stable — identical across reads — while `fps` and `frameTimeMs`
   continue to change.

---

### Edge Cases

- Grid with no `E`, or more than one → validation error naming `exit`; the page renders a
  human-readable failure into the document body instead of a partial level, reusing 001's
  renderer-failure path.
- Grid that is not square, or square but not 64x64 → validation error naming `dimensions`;
  no geometry is built and no exception escapes to the console.
- Degenerate all-empty map (zero wall tiles) → validates as a dimensional failure rather
  than producing empty geometry with an unlit void; the border rule makes this unreachable
  in the shipped layout but the validator must still refuse it.
- A `D` or `S` cell whose four neighbours are all empty (a door standing in open space,
  swinging on nothing) → validation error naming `door-placement`; doors and secrets must
  have solid tiles on exactly two opposite sides forming a one-tile-thick wall.
- A wall type ID with no material entry → validation error naming the ID; geometry
  building falls back to a declared default wall material so the map still renders, and
  records the fallback in `__diag.level.errors`.
- Player spawn enclosed by walls with no path to the exit → reachability error; if the
  page is loaded anyway behind a flag, it reports the failure rather than trapping the
  camera inside solid rock.
- A single-tile-wide corridor whose two ends are both sealed → validates structurally but
  is reported by the reachability check when it isolates the spawn or the exit.
- Grid larger than the geometry build can hold in one buffer (64x64 = 4096 tiles) → not a
  concern at this size; the build must nonetheless be O(visible faces) and not allocate
  per-tile objects that survive the build.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `src/level.ts` SHALL export a 64x64 grid of single-character cells drawn
  from `0`, `1`..`9`, `D`, `S`, `E`, authored in-file as a string array or numeric rows,
  declaring at least 4 wall type IDs, at least 4 doors, at least 2 secrets and exactly one
  exit.
- **FR-002**: The level layout SHALL be original work designed by hand for this file, in
  the spirit of a grid maze with right angles, locked doors, secrets and an elevator
  exit, and MUST NOT reproduce id Software's E1M1 layout or data.
- **FR-003**: `src/level.ts` SHALL export player spawn (tile plus facing yaw), between 6
  and 10 enemy spawn tiles inclusive, and at least 12 item spawn tiles each carrying a kind
  from the declared set `health`, `ammo`, `treasure`, `silver-key`, `gold-key` — exactly one
  of each key kind and at least 3 `treasure` — all on empty tiles. It SHALL also export a
  door-lock table naming every `D` tile's lock kind from `none`, `silver`, `gold`, with at
  least one silver-locked and one gold-locked door; these are the counts `006` and `007`
  derive their guard and pickup populations from, so this file is the only place they are
  declared.
- **FR-004**: The level module MUST import neither `three` nor any DOM API, and MUST be
  importable and unit-testable under `npm run test`.
- **FR-005**: A `validateLevel()` function SHALL verify squareness, the 64x64 dimensions,
  a single exit, spawn reachability to the exit by 4-neighbour moves across empty, door
  and secret tiles, spawn placement on empty tiles, door and secret wall-adjacency, a
  lock-table entry for every `D` tile, and a material entry for every wall type ID —
  returning named errors with coordinates rather than throwing.
- **FR-006**: The level SHALL define a material entry for every declared wall type ID and
  declare a default material used when an ID has none.
- **FR-007**: Wall geometry SHALL be built as merged `BufferGeometry`, one mesh per wall
  type ID present in the level, never one mesh per tile.
- **FR-008**: Geometry building SHALL emit only faces adjacent to walkable space — no
  face between two solid tiles, and zero vertices for a fully enclosed tile — at 1 world
  unit per tile with floor y=0 and ceiling y=2.
- **FR-009**: Floor and ceiling SHALL each be a single mesh covering every walkable tile
  exactly once, with no overlapping quads.
- **FR-010**: The rendered level MUST report fewer than 20 draw calls from
  `window.__diag.drawCalls` at any camera position.
- **FR-011**: The application SHALL extend `window.__diag` with a `level` object carrying
  `floorTiles`, `wallTilesByType`, `doorTiles`, `secretTiles`, `exitTiles`, `wallFaces`,
  `bounds`, `valid` and `errors`, additive to 001's contract — no existing field renamed,
  removed, or repurposed.
- **FR-012**: The smoke harness SHALL fail with the level error text cited when
  `__diag.level.valid` is false or any entry appears in `__diag.level.errors`.

### Key Entities

- **LevelGrid**: 64x64 single-character cells — `0` empty, `1`..`9` wall type IDs, `D`
  door, `S` secret push-wall, `E` exit. Data only; owned by `src/level.ts`.
- **SpawnSet**: player spawn tile and facing yaw, 6-10 enemy spawn tiles, item spawn tiles
  with a kind from `health`, `ammo`, `treasure`, `silver-key`, `gold-key`, and the door-lock
  table mapping each `D` tile to `none`, `silver` or `gold`. Consumed by M2 (placement),
  M3 (locks and keys), M5 (guards), M6 (pickups).
- **ValidationReport**: `{ valid, errors[] }` from `validateLevel()`, each error carrying
  a category name and coordinates. Surfaced verbatim in `__diag.level`.
- **MergedGeometry**: three built buffers — walls per material, floor, ceiling — the unit
  that makes the draw-call budget achievable.
- **LevelDiagnostics**: the `window.__diag.level` object, additive over 001's contract.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The shipped level renders as solid 3D geometry from the spawn tile with
  `window.__diag.drawCalls` below 20, read headlessly.
- **SC-002**: Wall face count equals the hand-computed count for a perimeter-only build of
  the grid, verified in a unit test — proving interior faces are culled rather than made
  invisible.
- **SC-003**: `npm run test` includes at least 10 passing assertions over level parsing
  and validation, including one per malformed-grid case in Edge Cases.
- **SC-004**: A corrupted grid row causes `npm run smoke` to exit non-zero citing the
  validator's error, demonstrated once and kept as a harness assertion.
- **SC-005**: At least 40x40 tiles of contiguous walkable space exist in the shipped
  layout, reported by `__diag.level.bounds`.
- **SC-006**: Zero binary asset files are added; the entire level is data and generated
  geometry.

## Assumptions

- 001 has landed: the render loop, `window.__diag`, and `npm run smoke`/`npm run test`
  exist and pass. This spec extends them rather than re-establishing them.
- Tile scale (1 unit per edge, 2 units of ceiling height) is fixed here and reused by M2's
  collider and M3's door travel distances; a change to it is a cross-spec decision for
  `DECISIONS.md`.
- Doors and secrets render as closed wall tiles in this spec; their meshes, animation and
  input handling belong to M3.
- Item and enemy spawn markers are data-only here — nothing consumes them until M5/M6 — but
  they are validated now so those specs do not have to change the format.
- Wall materials in this spec may be flat colours; procedural textures arrive in M4 and
  must attach to the same per-type meshes without changing the draw-call budget.

## Work Graph

```yaml
US1:
  depends_on: []
  implements: [FR-001, FR-002, FR-003, FR-004, FR-005, FR-006]
US2:
  depends_on: [US1]
  implements: [FR-007, FR-008, FR-009, FR-010]
US3:
  depends_on: [US2]
  implements: [FR-011, FR-012]
```
