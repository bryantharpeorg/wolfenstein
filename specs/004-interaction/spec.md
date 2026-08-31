---
state: landed
depends_on_landed: ["003-player"]
---

# Feature Specification: Doors, Keys and Secrets

**Feature Branch**: `004-interaction`

**Created**: 2026-08-29

**Status**: Draft

**Input**: Milestone M3 of the Wolfenstein-style FPS brief. Turns the static level of M1
and the walking player of M2 into a place with state in it: `D` tiles become sliding
doors driven by a pure, unit-testable state machine; silver and gold key pickups gate
locked doors that report *why* they refused rather than failing silently; `S` tiles
become push-wall secrets that permanently open the map. Interaction facts are added to
`window.__diag` so "every door and secret in the level works" is a headless assertion.

## Clarifications

### Session 2026-08-29

- Q: Is interacting a three.js concern? → A: No. Door state, key inventory and refusal reasons live in pure modules with no DOM and no three.js import (Constitution III). The render layer only reads state and moves meshes.
- Q: What is the interact binding? → A: `Space` or `E`, one command, handled once. No separate "use key" binding; the door decides whether it is locked, not the input layer.
- Q: Are keys consumed by opening a door? → A: No. Keys are retained (Wolfenstein convention), so a spent-key bug cannot masquerade as level design. `keyConsumed` in diagnostics proves retention.
- Q: Can a moving door crush the player? → A: No. A closing door that would intersect the player capsule reverses to opening and reports `crush-reversed`. Blocking is enforced by collision, not by killing.
- Q: Do secrets count twice if pushed twice? → A: No. A secret transitions once, on first push, and stays open permanently; the counter is monotonic.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Door state machine (Priority: P1)

As the game, I have a door module that owns `D` tiles as explicit state — `closed`,
`opening`, `open`, `closing` — advanced by elapsed time rather than by frame count, so a
door takes the same wall-clock duration to slide at 30 fps as at 240 fps, and a player's
`Space`/`E` press is answered by a stated outcome rather than by silence.

**Why this priority**: The milestone's headline behaviour. It is also the first pure
state machine in the project, so it establishes the pattern M5's guard AI reuses; a door
that animates inside the render loop cannot be tested at all.

**Independent Test**: `npm run test` on a suite that imports the door module with no DOM
and no three.js present; step it with synthetic deltas and assert state transitions,
interpolated position at named times, dwell timing, and every refusal reason below.

**Acceptance Scenarios**:

1. **Given** the door module, **When** its import graph is inspected, **Then** it
   imports neither `three` nor any DOM API and is importable from a vitest file that
   defines no `window`.
2. **Given** a `closed` door at an adjacent tile, **When** the interact command is
   issued, **Then** the outcome is `opened`, state becomes `opening`, and the door's
   travel progress advances from 0 toward 1 over a declared duration.
3. **Given** a door in `opening` with progress `p`, **When** elapsed time doubles,
   **Then** progress doubles (to a maximum of 1) — motion is a function of accumulated
   seconds, and stepping the same total time as 1 ms ticks versus 500 ms ticks yields a
   final progress equal within 1e-6.
4. **Given** a door that has reached fully open, **When** `dwellMs` elapses with no
   further input, **Then** state becomes `closing`, and after the travel duration it is
   `closed` with progress 0.
5. **Given** a door in `opening` or `closing`, **When** the interact command is issued,
   **Then** the outcome is that state's moving refusal — `blocked-moving` when `opening`,
   `refusing-closing` when `closing` (S6) — and the state and progress are unchanged:
   a moving door does not reverse or re-trigger.
6. **Given** a door in `closing`, **When** the interact command is issued, **Then** the
   outcome is `refusing-closing` and the door completes its close; it cannot be
   re-opened until it reports `closed`.
7. **Given** a door fully open, **When** the interact command is issued, **Then** the
   dwell timer resets and the outcome is `opened-now`, so a player lingering in a
   doorway is not repeatedly clipped by an auto-closing door.
8. **Given** a set of doors advanced with mixed delta times summing to the same total,
   **When** their progress values are compared, **Then** all deltas are clamped to a
   declared maximum step and no door jumps past a state transition it should have
   reported.
9. **Given** two adjacent `D` tiles both opened, **When** each door's travel volume is
   computed, **Then** neither travels into the other's tile; the second refuses with
   `blocked-neighbour` and remains `closed`.

---

### User Story 2 - Keys and locked doors (Priority: P1)

As a player, I find silver and gold key pickups and carry them in an inventory; a locked
door without its matching key refuses to open and tells me which key it wants, and that
refusal reaches the HUD and diagnostics as a distinct reason instead of an unexplained
dead keypress.

**Why this priority**: Locked doors are the level's gating mechanism — without them the
map is one open room and M1's `reachability` rule has no teeth. Same pure-module shape as
US1, so it costs little to do properly and everything to retrofit.

**Independent Test**: `npm run test` on a suite that imports the key inventory and the
locked-door decision path; assert pickup adds exactly one key, a locked door refuses with
the named missing key, possession of that key flips the outcome to success, and the key
is still present after the door opens.

**Acceptance Scenarios**:

1. **Given** the key inventory module, **When** its import graph is inspected, **Then**
   it imports neither `three` nor any DOM API and holds only counts keyed by `silver`
   and `gold`.
2. **Given** an empty inventory, **When** a silver key pickup at an occupied tile is
   collected, **Then** the inventory reports one `silver`, the pickup is marked consumed,
   and collecting it a second time in the same session does not yield two keys.
3. **Given** a door declared locked to `gold` and an inventory with no gold key, **When**
   the interact command is issued, **Then** the outcome is `locked-missing-key` naming
   `gold`, the door stays `closed`, and its progress remains 0.
4. **Given** the same door and an inventory holding one `gold` key, **When** the interact
   command is issued, **Then** the outcome is `opened`, state becomes `opening`, and the
   inventory still reports one `gold` key afterwards (`keyConsumed: false`).
5. **Given** a silver-locked door and an inventory holding only a gold key, **When** the
   interact command is issued, **Then** the outcome is `locked-missing-key` naming
   `silver` — possession of any key is not sufficient.
6. **Given** the shipped layout, **When** validated, **Then** every locked door's
   required key kind has at least one corresponding pickup reachable from the player
   spawn without passing through that door, and a violation is reported as a named
   `key-placement` error rather than producing an unwinnable map.
7. **Given** any interact command resolved against a door, **When** the outcome is read,
   **Then** it is one of the declared reasons (`opened`, `opened-now`, `blocked-moving`,
   `refusing-closing`, `blocked-neighbour`, `locked-missing-key`, `no-target`) — never an
   empty result.
8. **Given** the running page, **When** a locked door is refused at headless test time,
   **Then** `window.__diag.interaction.lastReason` equals `locked-missing-key` and
   `lastRefusalKeyKind` equals the missing key.

---

### User Story 3 - Secret push-walls and completion counters (Priority: P2)

As a player, I press against an `S` tile and it slides back two tiles, permanently
opening space that was not reachable before; as the verification system, I read
`secretsFound` / `secretsTotal` so level completion is a number rather than a hunch.

**Why this priority**: The milestone's third named feature, but nothing else depends on
it — doors and keys already make the level playable. It lands last because it reuses
US1's motion model and US2's interaction dispatch.

**Independent Test**: `npm run test` on a suite that pushes each shipped secret tile and
asserts it travels exactly 2 tiles, reports `secretsFound` incrementing by exactly 1 per
secret, never decreases, and reaches `secretsTotal`; then re-push an already-open secret
and assert the counter is unchanged.

**Acceptance Scenarios**:

1. **Given** an `S` tile adjacent to the player, **When** the interact command is issued,
   **Then** the wall begins sliding away from the player and comes to rest displaced by
   exactly 2 tiles along its declared axis.
2. **Given** a secret mid-slide, **When** read, **Then** its displacement is a fraction
   of 2 tiles interpolated over elapsed seconds — the same time-based rule US1-S3 asserts
   for doors.
3. **Given** a fully opened secret, **When** any further interact command is issued at
   that tile, **Then** the outcome is `already-open`, displacement stays at 2 tiles, and
   no reverse motion occurs — secrets do not close.
4. **Given** the shipped layout with `secretsTotal` greater than 0, **When** every secret
   is pushed once in a test, **Then** `window.__diag.interaction.secretsFound` equals
   `secretsTotal` and each push incremented the counter by exactly 1.
5. **Given** a counter value after any sequence of pushes, **When** read again after
   re-pushing an already-open secret, **Then** it is unchanged — `secretsFound` is
   monotonic non-decreasing and never exceeds `secretsTotal`.
6. **Given** a secret whose 2-tile travel path contains solid wall tiles or another
   secret, **When** the push begins, **Then** travel stops at the first blocked position,
   the outcome is `blocked-geometry`, the remaining distance is reported in diagnostics,
   and no tile is displaced into solid rock.
7. **Given** an opened secret, **When** grid collision is re-queried for its origin tile,
   **Then** that tile reports as walkable, so the player can actually walk through the
   opening rather than seeing a hole they cannot enter.
8. **Given** the running page after this story, **When** `window.__diag.interaction` is
   read, **Then** it carries `doorsTotal`, `doorsOpen`, `secretsFound`, `secretsTotal`,
   `keys` (counts per kind), `lastReason`, and `lastRefusalKeyKind`, additive over 001's
   and 002's fields.

---

### Edge Cases

- Door closing while the player stands in the doorway → the close is aborted at the
  moment the travel volume would intersect the player capsule, state reverses to
  `opening`, and `crush-reversed` is reported; the player is never trapped or crushed.
- Player standing inside a `D` tile at the instant it opens → opening proceeds, and on
  the next close attempt the same capsule test blocks it with `crush-reversed`.
- Two `D` tiles adjacent (a corner pair) → each owns its own tile and travel direction;
  the second to be commanded refuses with `blocked-neighbour` rather than overlapping the
  first. Diagnostics never show both doors claiming the same destination tile.
- Key spent versus retained → keys are retained after use (`keyConsumed: false`), so a
  player who leaves and returns can re-open the door; a test asserts inventory count is
  identical before and after opening.
- Secret wall with solid geometry behind it (mis-designed map) → travel halts at the
  obstruction with `blocked-geometry` and reports remaining distance; `validateLevel()`
  additionally flags any `S` tile whose 2-tile path is not clearable as a named
  `secret-placement` error.
- Player interacts with nothing in range → outcome `no-target`, no state change, no error
  logged to `__diag.errors`.
- Interact spam (100 presses in one frame) → at most one state transition per door per
  frame; the module is idempotent within a single update.
- Door or secret tile on the map border with walkable space on only one side → validation
  error naming `door-placement`, reusing 002's adjacency rule.
- A secret that opens into the room containing the exit → legal, and counted; secrets are
  not required for completion, only measured (`secretsFound` may legitimately be less than
  `secretsTotal`).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Door state SHALL live in a pure module with no DOM and no three.js import,
  exposing exactly the states `closed`, `opening`, `open`, `closing`, and MUST be
  unit-testable under `npm run test`.
- **FR-002**: Door travel SHALL be interpolated as a function of accumulated elapsed
  seconds toward a declared travel duration, such that stepping equal total time at any
  delta size yields identical final progress within 1e-6; per-frame deltas MUST be
  clamped to a declared maximum.
- **FR-003**: A door in `opening` SHALL reject the interact command with the
  outcome `blocked-moving`, leaving state and progress unchanged, and a door in `closing`
  SHALL report `refusing-closing` rather than re-opening until it reaches `closed`.
- **FR-004**: A door that reaches fully open SHALL remain open for a declared dwell time
  and then transition to `closing` without further input; re-interacting while open SHALL
  reset the dwell timer with outcome `opened-now`.
- **FR-005**: Interact SHALL be bound to both `Space` and `E`, resolved through a single
  command path, and MUST NOT be duplicated across separate handlers.
- **FR-006**: Every interact resolution against a door SHALL return one declared reason
  from the enumerated set in US2-S7, and MUST NOT return an empty or silent result.
- **FR-007**: Key inventory SHALL be a pure data module holding counts keyed by `silver`
  and `gold`, with no DOM and no three.js import.
- **FR-008**: Silver and gold key pickups SHALL exist as level entities; collecting one
  SHALL add exactly one key of its kind, mark the pickup consumed, and be idempotent on
  re-collection.
- **FR-009**: A door locked to a key kind SHALL refuse with `locked-missing-key` naming
  that kind when the inventory lacks it, remain `closed` with progress 0, and open
  normally once the matching key is held.
- **FR-010**: Keys SHALL be retained after opening a door — inventory counts MUST be
  unchanged by a successful unlock, reported as `keyConsumed: false`.
- **FR-011**: `validateLevel()` SHALL be extended to report a named `key-placement` error
  when a locked door's required key has no pickup reachable from spawn without passing
  through that door.
- **FR-012**: Secret (`S`) tiles SHALL slide exactly 2 tiles along a declared axis when
  the interact command is issued while the player is adjacent, using the same elapsed-time
  interpolation as FR-002.
- **FR-013**: An opened secret SHALL remain open permanently; further interaction SHALL
  report `already-open` with no reverse motion, and its origin tile SHALL report walkable
  to grid collision afterwards.
- **FR-014**: Secret travel SHALL halt at the first obstructed position with outcome
  `blocked-geometry` and a reported remaining distance, and `validateLevel()` SHALL flag an
  `S` tile whose 2-tile path cannot clear as `secret-placement`.
- **FR-015**: A closing door SHALL abort and reverse to `opening` with outcome
  `crush-reversed` whenever its travel volume would intersect the player capsule; doors
  MUST NOT crush or trap the player.
- **FR-016**: Two adjacent doors SHALL NOT occupy the same destination tile; a commanded
  pair SHALL refuse the second with `blocked-neighbour`.
- **FR-017**: The application SHALL extend `window.__diag` with an `interaction` object
  carrying `doorsTotal`, `doorsOpen`, `secretsFound`, `secretsTotal`, `keys`,
  `lastReason`, `lastRefusalKeyKind` and `keyConsumed`, additive over the 001 and 002
  contracts — no existing field renamed, removed, or repurposed.
- **FR-018**: The smoke harness SHALL fail when `__diag.interaction.secretsFound` exceeds
  `secretsTotal`, when `doorsOpen` is not an integer, or when any entry appears in
  `__diag.errors`.

### Key Entities

- **DoorState**: `closed | opening | open | closing`, plus `progress` (0..1), elapsed
  dwell, axis and travel duration. Owned by the pure door module; read by the render layer.
- **InteractOutcome**: the enumerated result of one interact command — `opened`,
  `opened-now`, `blocked-moving`, `refusing-closing`, `blocked-neighbour`,
  `locked-missing-key`, `crush-reversed`, `already-open`, `blocked-geometry`, `no-target`.
- **KeyInventory**: counts per kind (`silver`, `gold`); pure data, retained on use.
- **SecretWall**: an `S` tile with axis, displacement (0..2 tiles), and a monotonic
  found flag contributing to `secretsFound`.
- **InteractionDiagnostics**: the `window.__diag.interaction` object, additive over 001
  and 002.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Every `D` tile in the shipped level transitions closed → opening → open →
  closing → closed under a scripted test with no human input, reported as
  `doorsTotal === doorsCycled`.
- **SC-002**: Door travel duration measured at 1 ms and 500 ms deltas differs by less
  than 1e-6 in final progress, proving frame-rate independence.
- **SC-003**: Every locked door in the shipped level refuses with `locked-missing-key`
  before its key is granted and opens after, asserted for each locked door in one test.
- **SC-004**: `secretsFound` reaches `secretsTotal` when all secrets are pushed, and stays
  unchanged when any secret is pushed a second time.
- **SC-005**: `npm run test` includes at least 12 passing assertions over door state, key
  inventory and secret push, one per refusal reason.
- **SC-006**: A closing door reverses with `crush-reversed` in a scripted crush scenario,
  demonstrated once and kept as a regression test.
- **SC-007**: Zero binary asset files are added; doors, keys and secrets are data, state
  and geometry only.

## Assumptions

- 001–003 have landed: `window.__diag`, `npm run smoke`, `npm run test`, the merged level
  geometry, and a player capsule with grid-swept collision whose "adjacent tile" query
  this spec reads from.
- Tile scale is 1 world unit per edge with ceiling at y=2 (fixed by 002), so a door's
  travel distance is 1 tile and a secret's is 2 tiles.
- Door and secret meshes are built here but may reuse 002's flat-colour materials; M4
  re-skins them without changing this spec's state machine.
- Door sounds belong to M7; this spec emits the outcome that triggers one, not the audio.
- Key and door counts come from the shipped layout authored in 002, which declares at least
  4 doors and 2 secrets and exports the door-lock table naming each `D` tile's kind (`none`,
  `silver`, `gold`) with at least one of each locked kind. This spec reads that table; it
  does not invent a second place to declare a lock.

## Work Graph

```yaml
US1:
  depends_on: []
  implements: [FR-001, FR-002, FR-003, FR-004, FR-005, FR-006, FR-015, FR-016]
US2:
  depends_on: [US1]
  implements: [FR-007, FR-008, FR-009, FR-010, FR-011]
US3:
  depends_on: [US2]
  implements: [FR-012, FR-013, FR-014, FR-017, FR-018]
```
