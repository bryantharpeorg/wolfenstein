---
state: ready
depends_on_landed: ["002-map-geometry"]
---

# Feature Specification: Player Movement and Camera

**Feature Branch**: `003-player`

**Created**: 2026-08-29

**Status**: Draft

**Input**: Milestone M2 of the Wolfenstein-style FPS brief. Puts the player inside the
level built by M1: a pointer-locked first-person camera with configurable, frame-rate
independent mouse look; a capsule collider resolved as a grid-swept AABB against the
64x64 level grid that cannot tunnel through a wall at any speed or delta-time spike; and
locomotion feel — yaw-relative WASD, sprint, and head-bob driven by measured motion rather
than by held keys.

## Clarifications

### Session 2026-08-29

- Q: True capsule solver or something cheaper? → A: Capsule footprint approximated as a circle of radius 0.3 world units, resolved as an axis-aligned box swept along the intended displacement and substepped to at most 0.25 units per step. Deterministic, pure-math, testable — no physics library (Constitution I).
- Q: What counts as blocking? → A: Any non-empty grid tile except a tile the level flags as open-by-state. Doors and secrets are solid here; M3 owns opening them.
- Q: Fixed timestep or variable? → A: Variable frame delta, with movement integrated in bounded substeps so behaviour is identical at 15 fps and 240 fps. The collider MUST NOT assume a small delta.
- Q: Is head-bob a camera-position change or a view-model effect? → A: Camera-position offset only, amplitude and frequency driven by measured horizontal speed, zero when speed is below a declared epsilon.
- Q: What if pointer lock is refused? → A: The game still renders and reports the state in `__diag`; keyboard movement continues to work. No crash, no silent dead input.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - First-person camera and mouse look (Priority: P1)

As a player, clicking the canvas locks the pointer and moving the mouse turns the camera —
yaw and pitch with independently configurable sensitivity, pitch clamped so the view can
never flip upside down, Esc releasing the pointer back to the browser.

**Why this priority**: Without a camera the level from M1 is unobservable in play, and no
later spec — interaction, aiming, enemy line-of-sight — has a viewpoint to reason about.
It is also where the classic frame-rate-dependent-mouse bug lives, so it must be right
from the first commit.

**Independent Test**: Drive the built page headlessly: request pointer lock, dispatch
synthetic `mousemove` deltas totalling a known amount at two different simulated frame
intervals, and assert the resulting yaw/pitch match to within a declared tolerance; then
dispatch Esc and assert pointer lock was released.

**Acceptance Scenarios**:

1. **Given** the running page without pointer lock, **When** the canvas is clicked,
   **Then** pointer lock is requested, and `window.__diag.player.pointerLocked` becomes
   true once granted.
2. **Given** pointer lock active, **When** a horizontal mouse delta of 100 units is
   applied at the default sensitivity, **Then** yaw changes by exactly
   `100 * sensitivityYaw` radians in the direction that turns the view right, modulo 2π.
3. **Given** pointer lock active, **When** a vertical mouse delta of 100 units is
   applied, **Then** pitch changes by `100 * sensitivityPitch` and the camera's up vector
   remains the world up axis.
4. **Given** pitch at or beyond the clamp after repeated upward deltas, **When** further
   upward deltas are applied, **Then** pitch stays within ±89 degrees of horizontal, the
   camera never inverts, and no NaN appears in the camera matrix.
5. **Given** the same total mouse delta applied over 1 frame and over 20 frames, **When**
   the resulting yaw and pitch are compared, **Then** they differ by less than 1e-6 radians
   — accumulated deltas, not per-frame velocity.
6. **Given** `sensitivityYaw` and `sensitivityPitch` changed at runtime to half their
   values, **When** the same mouse delta is applied, **Then** the angular change halves,
   without a page reload.
7. **Given** pointer lock active, **When** Esc is pressed, **Then** pointer lock is
   released, `pointerLocked` becomes false, and subsequent mouse movement does not change
   yaw or pitch.
8. **Given** the browser denies or errors the pointer-lock request, **When** the click
   occurs, **Then** no uncaught exception reaches `window.__diag.errors`,
   `pointerLocked` stays false, and WASD movement still moves the player.

---

### User Story 2 - Collision that never clips (Priority: P1)

As a player, I cannot walk through a wall, sprint through a wall, or teleport through a
wall when the browser stalls for half a second — because displacement is swept against the
grid in bounded substeps and each substep resolves per axis, rather than being added to the
position and checked afterwards.

**Why this priority**: Wall clipping is the failure mode that makes the milestone's DONE
condition ("you can walk the whole map and cannot escape it") false, and it is invisible to
a type check and to a casual playtest — it appears exactly when frame times spike. This is
the single most test-heavy module in the project precisely because the bug class is
intermittent.

**Independent Test**: Unit-test the pure collision module directly: for a battery of
start tiles, directions and displacement magnitudes up to 50 units in a single call —
including deltas spanning several tiles at once — assert the resolved position never ends
inside a non-empty tile and never crosses a solid tile boundary that lies between start
and target.

**Acceptance Scenarios**:

1. **Given** the collision module, **When** its import graph is inspected, **Then** it
   imports neither `three` nor any DOM API, takes the level grid as an argument rather
   than a global, and is fully exercised under `npm run test`.
2. **Given** a player at the centre of an empty tile with a wall directly north, **When**
   a displacement of 5 units north is resolved in one call, **Then** the resulting
   position's north face stops flush against that tile boundary with penetration no
   greater than 1e-6 units.
3. **Given** any start position, direction and single-call displacement up to 50 units,
   **When** resolution completes, **Then** the resolved circle of radius 0.3 lies entirely
   within walkable tiles — asserted over a generated battery of at least 500 cases.
4. **Given** a diagonal move into a corner where two walls meet, **When** resolved,
   **Then** the player slides along whichever axis remains free and does not stop dead or
   come to rest overlapping a solid tile.
5. **Given** a delta-time spike of 1000 ms with sprint held, **When** one frame is
   integrated, **Then** the displacement is substepped into increments no larger than 0.25
   units and the resolved position is walkable — the player cannot cross a one-tile wall in
   that frame.
6. **Given** the same input sequence of key states and deltas, **When** simulated once at
   16 ms per frame and once at 250 ms per frame with identical total elapsed time,
   **Then** final positions differ by no more than 0.3 units and both are walkable.
7. **Given** a start position that is inside a solid tile because of bad level data,
   **When** resolution runs, **Then** the player is pushed to the nearest walkable
   position along the axis of least penetration within one call, no exception is thrown,
   and `window.__diag.player.stuck` becomes true.
8. **Given** a resolved movement, **When** read back, **Then** the module reports the
   per-axis blocked flags (whether north/south/east/west movement was stopped), so callers
   can drive footstep and bump feedback without re-deriving it.

---

### User Story 3 - Locomotion feel (Priority: P2)

As a player, WASD moves me relative to where I am looking, Shift sprints at a distinct
faster speed, and the camera bobs in step with how fast I am actually travelling — settling
to level the instant I stop, rather than swaying while I hold a key against a wall.

**Why this priority**: The milestone is achievable without it, and a bob driven by input
state instead of measured velocity feels wrong in a way that is easy to fix later. It is
P2 because correctness of camera and collision outranks feel, not because it is optional.

**Independent Test**: In the headless harness, hold a movement key against a wall and
assert the bob offset stays at zero despite non-zero input; then hold it in open space and
assert the bob offset oscillates with a period consistent with the declared cadence and
returns to zero within a declared settle time after release.

**Acceptance Scenarios**:

1. **Given** yaw of 0, **When** `W` is held for one frame, **Then** the player moves along
   the camera's forward horizontal vector; **And** with yaw rotated 90 degrees the same key
   produces a displacement rotated 90 degrees about the player.
2. **Given** `W` and `S` held simultaneously, or `A` and `D`, **When** integrated, **Then**
   the horizontal displacement is zero — no diagonal leak from the uncancelled pair.
3. **Given** `W` and `A` held together, **When** integrated, **Then** the displacement
   magnitude equals the single-key speed and not √2 times it.
4. **Given** Shift pressed while moving, **When** speed is read, **Then** it equals the
   declared sprint speed, which is between 1.6x and 2.0x the walk speed, and the two speeds
   are declared as named constants in one place.
5. **Given** the player standing still on flat floor, **When** 120 frames elapse with no
   input, **Then** the head-bob offset is exactly zero for every one of those frames.
6. **Given** the player walking at walk speed, **When** 120 frames elapse, **Then** the bob
   offset oscillates symmetrically about zero with a peak-to-peak amplitude between 0.02
   and 0.08 world units and completes 3 to 5 cycles per second of travel.
7. **Given** the player moving at half speed, **When** compared to full walk speed,
   **Then** both bob amplitude and bob frequency are lower than at full speed, being driven
   by measured velocity rather than by key state.
8. **Given** a movement key held while the player is pressed against a wall so measured
   speed is zero, **When** 60 frames elapse, **Then** the bob offset remains exactly zero.
9. **Given** the player stops moving, **When** 250 ms has elapsed, **Then** the bob offset
   has returned to within 1e-4 of zero rather than holding its last value.

---

### Edge Cases

- Tab backgrounded for 30 seconds then restored, producing a multi-second delta → the
  frame delta is clamped to a declared maximum before integration, and the substep rule in
  US2 keeps the player inside walkable space regardless; no accumulated burst of movement
  on refocus.
- Simultaneous opposite keys (`W`+`S`) → zero displacement (US3-S2), and the bob stays at
  zero because measured speed is zero.
- Pointer lock denied, revoked by the browser, or lost to an OS focus change →
  `pointerLocked` reflects reality, mouse deltas are ignored while unlocked, no error is
  recorded, and clicking again re-acquires lock.
- Spawn tile inside a wall because of bad level data → resolved out along least
  penetration (US2-S7), reported via `__diag.player.stuck`, and the harness fails if
  `stuck` is true on the shipped layout — rather than trapping the camera in rock.
- Collision against a door tile mid-slide: a door marked closed behaves as solid, so a
  diagonal slide into it resolves along the free axis; when M3 opens it, the same call must
  return an unblocked result with no change to this module's signature.
- Player exactly on a tile boundary, or position holding a floating-point value like
  0.9999999 adjacent to a wall → resolution is stable and does not jitter or report a
  spurious block; boundary comparisons use a declared epsilon rather than `===`.
- Sprint into a corner at a large delta → substeps resolve one axis at a time and the
  player ends in a walkable tile, never inside the corner.
- Frame delta of zero (two rAF callbacks in the same millisecond) → no division by zero,
  no NaN in position or camera, bob unchanged.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The application SHALL request pointer lock on canvas click and expose its
  state as `window.__diag.player.pointerLocked`; Esc MUST release it.
- **FR-002**: Mouse look SHALL drive yaw and pitch from accumulated raw mouse deltas, with
  `sensitivityYaw` and `sensitivityPitch` independently configurable at runtime without a
  reload, such that a given total delta produces the same angular change regardless of how
  many frames it is spread across.
- **FR-003**: Pitch SHALL be clamped to ±89 degrees of horizontal so the camera cannot flip,
  keeping the camera's up vector aligned to world up and free of NaN at the clamp.
- **FR-004**: A denied, errored or browser-revoked pointer lock MUST NOT throw uncaught,
  MUST leave `pointerLocked` false, and MUST NOT disable keyboard movement.
- **FR-005**: Player collision SHALL be a capsule footprint of radius 0.3 world units
  resolved as an axis-aligned box swept against the 64x64 level grid, in a module that
  imports neither `three` nor any DOM API and takes the grid as a parameter.
- **FR-006**: Movement integration SHALL substep every displacement into increments no
  larger than 0.25 units, resolving per axis, so that a single call of any magnitude —
  including one produced by a clamped multi-second delta spike at sprint speed — cannot
  place the player in or beyond a solid tile.
- **FR-007**: Collision resolution SHALL treat every non-empty grid tile as blocking,
  including closed doors and secrets, and SHALL accept the level's open/closed state as an
  input so M3 can open doors without changing this module's signature.
- **FR-008**: The resolver SHALL report per-axis blocked flags for the resolved move, so
  callers can drive footstep and bump feedback without re-deriving collision.
- **FR-009**: Given a start position inside a solid tile, the resolver SHALL push the
  player to the nearest walkable position along the axis of least penetration within one
  call, throw no exception, and set `window.__diag.player.stuck` true.
- **FR-010**: Movement SHALL be frame-rate independent: the same sequence of inputs over
  the same total elapsed time SHALL produce final positions within 0.3 units whether
  simulated at 16 ms or 250 ms per frame, and the frame delta SHALL be clamped to a
  declared maximum before integration.
- **FR-011**: WASD movement SHALL be relative to camera yaw in the horizontal plane, SHALL
  cancel opposite key pairs to exactly zero displacement, and SHALL normalise diagonals so
  no combination exceeds the current base speed.
- **FR-012**: Shift SHALL select a sprint speed declared as a named constant at between
  1.6x and 2.0x the walk speed, with both speeds declared in one place.
- **FR-013**: Head-bob SHALL be a camera-position offset computed from measured horizontal
  velocity — not from key state — with amplitude scaling with speed, exactly zero while
  measured speed is below a declared epsilon, and returning within 1e-4 of zero no later
  than 250 ms after movement stops.
- **FR-014**: The application SHALL extend `window.__diag` additively with a `player`
  object carrying `x`, `z`, `yaw`, `pitch`, `speed`, `sprinting` (booleans),
  `pointerLocked` (boolean), `stuck` (boolean) and `bobOffset` (number), without renaming,
  removing or repurposing any field owned by 001 or 002.
- **FR-015**: The smoke harness SHALL fail with a cited reason if, after scripted movement
  across the shipped level, `__diag.player.stuck` is true or the reported position lies on
  a non-walkable tile of the level grid.

### Key Entities

- **PlayerState**: `x`, `z`, `yaw`, `pitch`, horizontal `speed`, `sprinting`, `bobOffset` —
  the single source of truth for where the viewpoint is, read by M5 for line-of-sight and
  by M6 for HUD and weapon attachment.
- **Collider**: pure function `(grid, position, displacement, openState) -> {position,
  blockedAxes}` — swept, substepped, per-axis. No three.js, no globals, the project's
  most heavily unit-tested module.
- **InputState**: current key set and accumulated mouse deltas since the last integration,
  plus pointer-lock status; the only bridge between DOM events and player physics.
- **MovementParams**: named speed constants (walk, sprint), mouse sensitivities, collider
  radius, substep size, delta clamp, bob amplitude/frequency/settle — declared once so
  tuning never chases literals across files.
- **PlayerDiagnostics**: the `window.__diag.player` object, additive over 001 and 002.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A scripted headless walk of at least 200 tiles across the shipped level ends
  with `__diag.player.stuck` false and every sampled position on a walkable tile.
- **SC-002**: The collision suite contains at least 500 generated displacement cases, each
  asserting the resolved position is walkable, all passing under `npm run test`.
- **SC-003**: Identical input sequences at 16 ms and 250 ms per frame converge to within
  0.3 units of final position, and identical mouse deltas at any frame rate agree to
  within 1e-6 radians.
- **SC-004**: No camera flip is reachable — pitch stays within ±89 degrees under an
  unbounded scripted vertical mouse delta.
- **SC-005**: Head-bob measures exactly zero across 120 idle frames and across 60 frames of
  a key held against a wall, proving it is velocity-driven.
- **SC-006**: The player cannot leave the level: after scripted movement in every
  direction at sprint speed for 10 seconds each, the reported position remains inside the
  walkable bounds M1 reports.

## Assumptions

- 001 and 002 have landed: the render loop, `window.__diag`, the smoke harness, and a
  validated 64x64 level with a player spawn tile and facing yaw all exist and pass.
- Tile scale from 002 is reused unchanged — 1 world unit per tile edge, eye height inside
  the 2-unit ceiling; collider radius 0.3 leaves clearance in single-tile corridors.
- Vertical movement (jumping, slopes) is out of scope; the player stays on the floor plane
  at a fixed eye height for the whole project.
- Mouse sensitivity values are runtime constants with declared defaults rather than a saved
  settings file; persistence is not part of any milestone in this brief.
- Pointer lock behaviour varies slightly across browsers; the harness asserts the Chromium
  contract, and FR-004's denial path covers the rest.

## Work Graph

```yaml
US1:
  depends_on: []
  implements: [FR-001, FR-002, FR-003, FR-004]
US2:
  depends_on: [US1]
  implements: [FR-005, FR-006, FR-007, FR-008, FR-009, FR-010, FR-015]
US3:
  depends_on: [US2]
  implements: [FR-011, FR-012, FR-013, FR-014]
```
