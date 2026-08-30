---
state: ready
depends_on_landed: ["004-interaction"]
---

# Feature Specification: Enemy Guards and Pathing

**Feature Branch**: `006-enemies`

**Created**: 2026-08-29

**Status**: Draft

**Input**: Milestone M5 of the Wolfenstein-style FPS brief. Adds hostile guards to the
level built by `001`–`004`: a deterministic state machine, A* grid pathing with
line-of-sight raycasts, hitscan attacks with distance damage falloff, and billboard
rendering from a procedurally drawn sprite sheet at 8 view angles. The decision-making
and navigation halves are pure modules — no DOM, no three.js — so they run under
`npm run test`; only the billboard renderer touches the scene.

## Clarifications

### Session 2026-08-29

- Q: Are guards authored as data or placed by hand? → A: Placed from the `enemySpawns` list `level.ts` exports alongside the grid — not from a grid cell, because 002 fixes the grid alphabet at `0`, `1`..`9`, `D`, `S`, `E` and a spawn is not a tile type. Guard count is whatever that list declares, which 002 FR-003 constrains to between 6 and 10 inclusive.
- Q: Does enemy AI need to be reproducible across runs? → A: Yes. Every guard decision derives from a seeded PRNG plus tick count and player position. Given the same seed and the same inputs, a test can assert the exact state at tick N.
- Q: What bounds pathing cost? → A: A node-expansion cap declared in one constant. On exceeding it, A* reports "unreachable" rather than continuing; a guard must never be able to stall a frame.
- Q: Are enemy sprites image files? → A: No. Constitution II — the sprite sheet is drawn into a canvas at load time by code.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Guard state machine (Priority: P1)

As the game, I need a guard whose behaviour is a table of states and transitions with
named guards on each edge — idle, alert, chase, attack, death — so that enemy behaviour
is a lookup over data rather than a nest of conditionals, and so a unit test can drive
it with synthetic player positions and ticks.

**Why this priority**: Every other story in this spec consumes guard state. Pathing is
invoked by `chase`, attacks are gated by `attack`, the sprite sheet needs `death` to
exist. Nothing downstream can be written before the state list and its edges are fixed.

**Independent Test**: Under `npm run test`, import the guard module with no DOM and no
three.js, feed it a synthetic grid, a seeded PRNG, and scripted player positions per
tick; assert the exact state after each tick for a scripted scenario covering all five
states and every legal transition. Then assert that re-running the same script with the
same seed yields an identical state trace, and with a different seed yields a differing
trace only at the ticks where randomness was requested.

**Acceptance Scenarios**:

1. **Given** the guard module, **When** its state list is read, **Then** it declares
   exactly `idle`, `alert`, `chase`, `attack`, `death` and exports a transition table in
   which each entry names `from`, `to`, and the predicate guarding the edge.
2. **Given** a guard in `idle` at tick N with no player visible and no sound event,
   **When** the tick is stepped, **Then** the guard remains `idle` and its facing follows
   the idle patrol script for its seed rather than being frozen.
3. **Given** a guard in `idle`, **When** line-of-sight to the player becomes true,
   **Then** the guard moves to `alert` on that same tick and records the last known
   player position.
4. **Given** a guard in `alert`, **When** the alert duration elapses with line-of-sight
   still true, **Then** the guard moves to `chase`; **And** when line-of-sight is lost
   before that, **Then** it moves toward the last known position and returns to `idle`
   after reaching it or after a declared timeout.
5. **Given** a guard in `chase`, **When** the player enters the attack range declared in
   the table and line-of-sight holds, **Then** the guard moves to `attack`.
6. **Given** a guard in `attack`, **When** the player leaves attack range or line-of-sight
   breaks, **Then** the guard returns to `chase` after its current shot cooldown ends.
7. **Given** a guard in any state, **When** it takes lethal damage, **Then** it moves to
   `death`, and no transition out of `death` exists in the table.
8. **Given** the transition table, **When** inspected, **Then** every state except
   `death` is reachable from `idle` on some input, and there is no state with zero
   incoming edges other than the spawn state.
9. **Given** two identical step sequences with seed `1234`, **When** both are run,
   **Then** the recorded state traces are byte-identical strings.

---

### User Story 2 - A* pathing and line-of-sight on the 64x64 grid (Priority: P1)

As a chasing guard, I need a path across the level's 64x64 grid that avoids walls and
respects door state, plus a line-of-sight raycast that says whether I can actually see
the player — both bounded so no map can make me hang a frame.

**Why this priority**: Pathing is what separates a guard from a target. It is also the
pure-module half of the milestone's risk: an unbounded A* on a 4096-cell grid is the one
thing in this spec that can freeze the game, so it must be written and tested first
alongside the state machine it serves.

**Independent Test**: Under `npm run test`, import the pathing module with no DOM and no
three.js; assert exact paths on hand-drawn grids, assert an explicit unreachable result
when start and goal are separated by a wall ring, assert that a closed door is impassable
and an open one is passable, assert line-of-sight agrees with hand-computed answers for
open / blocked / diagonal-gap cases, and assert that a grid built to be pathological
returns within the node-expansion cap.

**Acceptance Scenarios**:

1. **Given** a 64x64 grid with a known wall layout, **When** `findPath(start, goal)` is
   called, **Then** it returns an ordered list of orthogonally adjacent cells from start
   to goal that contains no wall cell, or a declared `unreachable` result.
2. **Given** start and goal separated by a closed ring of walls, **When** `findPath` is
   called, **Then** it returns `unreachable` rather than an empty array, a partial path,
   or `null`.
3. **Given** a grid whose only route passes through a door tile, **When** that door's
   state is closed, **Then** `findPath` returns `unreachable`; **And** when its state is
   open, **Then** the returned path traverses that tile.
4. **Given** a 2000-cell grid with no valid route constructed to maximise search,
   **When** `findPath` is called, **Then** it returns within the node-expansion cap and
   reports nodes expanded as an integer not exceeding that cap.
5. **Given** a guard at cell A and the player at cell B with no wall between them,
   **When** `hasLineOfSight(A, B)` is called, **Then** it returns true; **And** given one
   intervening wall cell, it returns false.
6. **Given** a closed door on the segment between A and B, **When**
   `hasLineOfSight(A, B)` is called, **Then** it returns false; **And** with that door
   open, it returns true.
7. **Given** two cells touching only at a diagonal corner where both orthogonal neighbours
   are walls, **When** `hasLineOfSight` is evaluated across that corner, **Then** it
   returns false (no corner-cutting sight).
8. **Given** the line-of-sight implementation, **When** inspected, **Then** it steps cell
   by cell (Bresenham or DDA) and allocates no array per call.
9. **Given** `findPath` called twice with identical grid and door states, **When** both
   results are compared, **Then** the returned paths are identical.

---

### User Story 3 - Hitscan attacks with damage falloff (Priority: P2)

As a guard, I shoot along a ray toward the player: the shot stops at the first wall, is
blocked by cover, and does less damage the farther away the target is, according to a
declared falloff curve. Six to ten guards stand in the level doing this.

**Why this priority**: It requires US1's states and US2's line-of-sight to exist before
an attack means anything. It is P2 because a player can be hunted by chasing guards that
do no damage and still exercise the whole of US1 and US2 — lethality refines a working
system rather than enabling one.

**Independent Test**: Under `npm run test`, call the attack module with synthetic guard
and player positions on a known grid; assert the exact damage number at each declared
falloff breakpoint, assert zero damage and a `blocked` result when a wall or a closed
door lies between attacker and target, and assert the placed-guard count read from the
level matches the spawn markers and falls between 6 and 10.

**Acceptance Scenarios**:

1. **Given** a guard in `attack` with the player at distance `d` and clear line-of-sight,
   **When** the guard fires, **Then** damage equals the value produced by the declared
   falloff curve for that distance, evaluated from the curve table rather than an inline
   literal.
2. **Given** the falloff curve, **When** sampled at its declared minimum and maximum
   range breakpoints, **Then** damage at the near breakpoint is strictly greater than
   damage at the far breakpoint, and both are greater than zero.
3. **Given** a wall cell between guard and player, **When** the guard fires, **Then** the
   shot reports `blocked`, deals zero damage, and reports the distance along the ray at
   which it terminated.
4. **Given** a closed door between guard and player, **When** the guard fires, **Then**
   the shot reports `blocked` and deals zero damage.
5. **Given** a guard with the player behind cover such that no line-of-sight exists,
   **When** the guard's attack tick runs, **Then** no shot is emitted and the guard does
   not enter `attack`.
6. **Given** the level's spawn markers, **When** guards are instantiated, **Then** the
   live guard count equals the number of markers and is at least 6 and at most 10.
7. **Given** a guard at a spawn marker, **When** the grid cell under that marker is a
   wall, **Then** startup records an error naming the marker's coordinates rather than
   silently dropping the guard or throwing uncaught.
8. **Given** two guards with line-of-sight to the player, **When** both fire on the same
   tick at different distances, **Then** each shot's damage is computed from its own
   distance.

---

### User Story 4 - Billboard rendering from a procedural sprite sheet (Priority: P2)

As a player, an enemy looks like a solid object from every bearing: the guard renders as
a camera-facing billboard whose frame is selected from 8 view angles in a sprite sheet
drawn by code at load time, so it never spins like a flat card as I circle it.

**Why this priority**: A guard that cannot be seen is untestable by eye and cannot be
shot at by a human, but the whole AI exists and runs headlessly without any pixels. This
is the presentation layer over three working stories, so it lands last.

**Independent Test**: Load the built page headlessly, read `window.__diag.enemies` after
`ready`, then drive the camera through a full 360-degree turn in eight steps and assert
the reported view-angle index visits each of the eight values; additionally assert under
`npm run test` that the sprite-sheet generator returns the declared canvas dimensions and
that no image file exists anywhere in the tree.

**Acceptance Scenarios**:

1. **Given** a guard, **When** rendered, **Then** it is drawn as a camera-facing
   billboard (its quad's normal points at the camera) rather than an axis-aligned card.
2. **Given** the sprite sheet generator, **When** called with a frame count and 8 view
   angles, **Then** it returns a canvas of width `8 * cell` and height `frames * cell`
   drawn entirely by canvas 2D calls, and the repository contains no `.png`, `.jpg`,
   `.jpeg`, `.gif`, `.webp` file at any path.
3. **Given** a viewer bearing of due north relative to a guard, **When** the frame is
   selected, **Then** angle index 0 is chosen; **And** for each of eight evenly spaced
   bearings around the circle, a distinct index in `0..7` is chosen.
4. **Given** the camera orbiting a stationary guard through 360 degrees in eight equal
   steps, **When** `window.__diag.enemies[i].viewAngle` is read at each step, **Then**
   the eight readings are pairwise distinct and consecutive readings never repeat before
   the orbit completes.
5. **Given** a guard killed while chasing, **When** it enters `death`, **Then** the
   rendered frame advances through the declared death frames over its declared duration
   and holds the final death frame afterwards.
6. **Given** a guard in `death` whose animation has completed, **When** further ticks
   pass, **Then** the guard contributes zero to `window.__diag.enemiesAlive`.
7. **Given** 10 guards at 8 angles and the declared frame count, **When** the sheet is
   built, **Then** exactly one texture per guard type is uploaded and
   `window.__diag.drawCalls` increases by no more than one per visible guard.
8. **Given** a guard off-screen behind the camera, **When** a frame renders, **Then** that
   guard issues no draw call.

---

### Edge Cases

- Guard spawn tile unreachable from the player's start tile → pathing reports
  `unreachable` on its first chase attempt, the guard stays `idle`, and
  `window.__diag.enemies` records `pathable: false` for it rather than the game hanging
  or the guard vanishing.
- Guard begins moving through an open door and the door closes mid-traverse → the guard's
  next path request excludes that tile, a new path is computed within one tick of the
  state change, and the guard is not left intersecting the closed door.
- Two guards occupy the same cell (chase convergence on a corridor) → each holds a
  distinct claimed cell; neither is pushed into a wall, and neither stops moving.
- Line-of-sight through a diagonal gap where both orthogonal cells are walls → resolved
  to false by US2-S7's no-corner-cutting rule; guards must not shoot through pinwheels.
- Sprite-sheet memory at 8 angles x N frames x 10 guards → sheets are shared per guard
  type, not per instance, so texture count scales with types rather than with guard count.
- Guard killed during its attack wind-up → the pending shot is cancelled (no damage after
  `death` is entered) and no second `death` transition fires.
- Player teleports (restart, debug warp) while a guard is chasing → the stale path is
  discarded on the next tick rather than followed to the old destination.
- Path request issued every tick for every guard → path requests are throttled per guard
  to a declared interval, and the throttle is reported so a regression is visible.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The guard module MUST implement exactly the states `idle`, `alert`,
  `chase`, `attack`, `death` with an exported transition table of `{from, to, guard}`
  entries, and MUST import neither the DOM nor `three`.
- **FR-002**: Guard state stepping MUST be a pure function of tick count, seeded PRNG
  state, grid, door states, and player position, such that identical seeds and inputs
  produce byte-identical state traces.
- **FR-003**: The pathing module MUST implement A* over the 64x64 level grid returning an
  ordered adjacent-cell path, a declared `unreachable` result when no route exists, and
  MUST treat closed doors as impassable and open doors as passable.
- **FR-004**: Path requests MUST be capped at a declared maximum number of expanded
  nodes, MUST report the count expanded, and MUST return `unreachable` on exhausting the
  cap rather than continuing to search.
- **FR-005**: The pathing module MUST implement `hasLineOfSight(a, b)` as a cell-stepping
  raycast that returns false for any intervening wall, false for a closed door, true when
  only open cells and open doors lie between the endpoints, and false across a diagonal
  corner bounded by two walls.
- **FR-006**: Guards MUST instantiate from the level's spawn markers with the live count
  asserted at no fewer than 6 and no more than 10, and MUST record a named error for any
  marker landing on a wall cell.
- **FR-007**: A guard attack MUST be a ray test that terminates at the first blocking
  geometry, reporting `blocked` with the termination distance and zero damage when
  blocked, and applying damage only when line-of-sight is clear.
- **FR-008**: Attack damage MUST decrease with target distance according to a declared,
  exported falloff curve table, evaluated at that table rather than by inline constants.
- **FR-009**: Enemies MUST render as camera-facing billboards using one procedurally drawn
  sprite sheet per guard type containing 8 view angles and the declared death frames.
- **FR-010**: The billboard renderer MUST select the sprite angle from the viewer's
  bearing so that eight evenly spaced orbit positions yield eight distinct angle indices,
  and MUST issue no draw call for an off-screen guard.
- **FR-011**: The application MUST expose `window.__diag.enemies` (array of `{state, viewAngle, pathable}`) and `window.__diag.enemiesAlive` (integer), extended additively from the `001-scaffold` contract without redefining any existing field.

### Key Entities

- **GuardState**: `idle | alert | chase | attack | death` — the state machine's domain, owned by this spec.
- **TransitionTable**: the exported `{from, to, guard}` list; the single source of truth for legal edges.
- **PathResult**: `{cells: Cell[], nodesExpanded: number}` or `unreachable` — the A* contract.
- **FalloffCurve**: the exported distance-to-damage table consulted by every guard shot.
- **SpriteSheet**: one canvas per guard type, 8 view angles wide, death frames tall, drawn at load time.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A vitest suite with no DOM and no three.js import drives a guard through all
  five states and asserts exact state traces; `npm run test` exits 0.
- **SC-002**: The same seed run twice produces identical state traces across a 600-tick
  scripted scenario, asserted by string equality.
- **SC-003**: A pathological grid causes zero frame-time spikes above the harness floor
  attributable to pathing, and every path request reports nodes expanded at or below the
  declared cap.
- **SC-004**: Headless smoke reports `window.__diag.enemies.length` between 6 and 10
  inclusive and `enemiesAlive` equal to that count at spawn.
- **SC-005**: Orbiting a guard in eight steps yields eight distinct `viewAngle` readings,
  verified by the harness without human input.
- **SC-006**: Zero image files exist in the tree after this spec lands, checked inside the
  smoke gate.

## Assumptions

- The level grid from `001`–`004` exports a 64x64 array and door state readable by the
  pathing module; guard placement reads 002's `enemySpawns` list from that same module
  rather than a second map format or a new grid cell type.
- One guard archetype ships in this spec; the sheet-sharing rule exists so a second type
  costs one texture, not ten.
- Guard movement speed and attack cooldown are gameplay constants declared in the guard
  module and are not specified numerically here; the tests assert relationships (near
  damage > far damage) rather than tuning values.
- The harness can move the headless camera programmatically to drive the orbit assertion.

## Work Graph

```yaml
US1:
  depends_on: []
  implements: [FR-001, FR-002]
US2:
  depends_on: [US1]
  implements: [FR-003, FR-004, FR-005]
US3:
  depends_on: [US2]
  implements: [FR-006, FR-007, FR-008]
US4:
  depends_on: [US3]
  implements: [FR-009, FR-010, FR-011]
```
