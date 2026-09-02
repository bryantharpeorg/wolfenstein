---
state: ready
depends_on_landed: ["008-polish"]
---

# Feature Specification: Recorded Playthrough as a UAT Artifact

**Feature Branch**: `009-playtest-uat`

**Created**: 2026-09-02

**Status**: Draft

**Input**: Operator request, 2026-09-02. The repository verifies itself thoroughly and
shows nothing. `npm run smoke` is the gate that decides every landing, and
`tools/smoke-checks/run.mjs` already drives the shipped level to the elevator — but it
moves the player with `window.__playerDrive` batched inside a single `page.evaluate`, so
no frame renders during a leg, no guard takes a tick, the camera never turns, and the
whole of it evaporates into a CI log. There is no artifact a human can accept on. This
spec adds a second launching point beside the gate: `npm run play`, which plays the level
to full completion through the same keyboard and mouse a person uses, records the screen,
and writes the recording beside a structured verdict. It is user acceptance testing in its
simplest honest form — a video and a result, from one command.

## Clarifications

### Session 2026-09-02

- Q: Headed or headless? → A: Headed, on the host display, and it refuses to run without one. The gate's FPS floor is 5 (`tools/smoke-floor.mjs`) precisely because headless Chromium rasterizes this game in software; a headless recording is a slideshow. A tool whose entire output is a video must not ship footage that misrepresents the frame rate.
- Q: Is this a gate? → A: No. Headed means it cannot run in Ergane's bwrap runtime or in CI, so it is an operator command and `ergane.yaml` never learns about it. It must never become a way around `npm run smoke` (Constitution III).
- Q: Real input, or the existing drive seam? → A: Real input, exclusively. Measured on the built page on 2026-09-02: a synthesized `keydown('KeyW')` held 700 ms moved the player `z 10.5 → 8.35` — 2.15 units at `WALK_SPEED` 3, through the real collider; a click on `#game-canvas` **is granted pointer lock** (`document.pointerLockElement === "game-canvas"`); and synthesized mouse movement under that lock turns the camera (`yaw 0 → −0.216 rad` over 360 px). Every input the game binds is therefore drivable, so no harness seam is needed and none is added.
- Q: What does the run have to achieve? → A: Full completion — every guard, every secret, every treasure, both keys, then the exit. The level's own rating table gives the top band only at a mean of 100 across all three axes, so a complete run is a claim the game itself scores.
- Q: How does the agent know where to walk? → A: The game's own `findPath`, compiled for the runner from the existing source. A second A* implementation in `tools/` would be a copy of a module that can drift from the one guards actually use.
- Q: What happens when the player dies? → A: The attempt failed and is kept. Up to a declared three attempts, and the report states how many were used, because a pass on the third attempt and a pass on the first are different facts about the game.
- Q: Does a missed treasure turn the result red? → A: No. Reaching `complete` with no errors is a hard criterion; how much of the level was cleared is measured, reported and never fatal — a UAT that fails on the hardest optional objective stops being run.
- Q: Where does the output go? → A: One directory in the working tree, replaced each invocation, gitignored and skipped by the binary-asset walker. A recording is build output in exactly the sense `dist/` is.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The playthrough runner (Priority: P1)

As an operator, I run one command and watch an agent play the game — moving, turning,
opening doors and riding the elevator — in a real browser window on my own machine,
through the same input path I would use myself.

**Why this priority**: Nothing else in this spec exists without a run. It is also the only
story carrying genuine unknowns, all of them about driving a real browser, and it is the
story that establishes the spec's defining property: the agent plays the game rather than
scripting it.

**Independent Test**: Invoke the command on a host with a display and assert the process
exits zero, a browser window ran, `__diag.player.pointerLocked` was true, and
`__diag.run.state` reached `complete`; then invoke it with no display available and assert
it refuses by name rather than running.

**Acceptance Scenarios**:

1. **Given** a host with a display, **When** the command is invoked, **Then** it builds the
   page, serves the built output over loopback, launches a headed browser against it, and
   the run reaches `__diag.run.state === 'complete'`.
2. **Given** a host with no display available, **When** the command is invoked, **Then** it
   refuses with a message naming the reason and exits non-zero, and no recording is
   written — a software-rendered run is never substituted for a recorded playthrough.
3. **Given** the loaded page, **When** the runner issues its first command, **Then** the
   game canvas has been clicked and `__diag.player.pointerLocked` reads true before any
   look command is issued.
4. **Given** any movement, look, interact, fire or weapon-selection command, **When** it is
   issued, **Then** it arrives as the same DOM event a player's hardware produces and is
   bound by the module that already binds it; **And** `window.__playerDrive` is never
   called, and no new input seam exists anywhere under `src/`.
5. **Given** a command that spans distance or time, **When** it is issued, **Then** it is
   paced against the page's own animation frames, so frames render, guards take ticks and
   doors interpolate while it runs.
6. **Given** two consecutive objectives, **When** the runner moves between them, **Then**
   the route comes from the game's own pathfinder over the level grid and the live
   open-tile state, and a leg reported unreachable fails the attempt naming the leg.
7. **Given** the exit tile, **When** the interact command is issued adjacent to it and the
   elevator travel elapses, **Then** the run state reaches `complete`.
8. **Given** a completed invocation, **When** the repository is inspected, **Then** the
   output directory is excluded from version control, is skipped by the binary-asset
   walker, and `npm run smoke` passes with that directory populated.

---

### User Story 2 - The full-completion objective set (Priority: P1)

As an operator, the run I watch is not a dash for the exit — the agent clears the level:
every guard killed, every secret pushed, every treasure collected, both keys taken, and
only then the elevator.

**Why this priority**: A run that only reaches the exit exercises movement, doors and the
elevator. A run that clears the level additionally exercises combat, hitscan, the HUD,
damage, pickups and every counter the stats screen reports — which is nearly the whole
game, verified by one artifact a person can watch.

**Independent Test**: Complete a run and assert the objective set was derived from the
level's own tables, that the count of guard objectives equals the marker count, secret
objectives equal the `S` tile count and treasure objectives equal the treasure entries;
then assert each was confirmed against the counter that owns it.

**Acceptance Scenarios**:

1. **Given** the shipped level, **When** the objective set is built, **Then** it is derived
   from the level's own data — the enemy markers, the `S` tiles of the grid, the treasure
   item entries and the single `E` tile — and contains no hardcoded count.
2. **Given** a level that gains one guard marker, **When** the objective set is built,
   **Then** it contains one more guard objective, with no edit to the runner.
3. **Given** a guard objective, **When** it is pursued, **Then** the camera is turned to
   that guard's bearing read from the diagnostics roster, the fire command is issued
   through its real binding, and completion is confirmed by the kill counter rising.
4. **Given** a weapon with no ammunition remaining, **When** a guard objective is pursued,
   **Then** a weapon that has ammunition is selected first, through its real binding.
5. **Given** a run state that is not `playing`, **When** any fire command would be issued,
   **Then** none is — the agent does not shoot at a stats screen.
6. **Given** a secret objective, **When** it is pursued, **Then** the interact command is
   issued at the `S` tile and completion is confirmed by the secrets-found counter rising.
7. **Given** a locked door on the route, **When** the objective order is built, **Then** the
   objective collecting the key that door's lock table entry names precedes it.
8. **Given** a refused interaction, **When** it is observed, **Then** the reason published
   by the interaction diagnostics is recorded and reported rather than the command being
   retried blindly against the same tile.
9. **Given** health below its declared threshold or the selected weapon's ammunition below
   its own, **When** the next objective is chosen, **Then** the corresponding pickup is
   collected first, each threshold declared in one place.

---

### User Story 3 - Recording and timeline (Priority: P1)

As an operator, I get a video of what happened and a list of what happened, and the two
line up — every event in the list names the moment in the video where I can watch it.

**Why this priority**: The recording *is* the artifact this spec exists to produce. A video
with no index is something you scrub through hoping; a video with offsets is something you
navigate.

**Independent Test**: Complete an invocation and assert a video file exists for every
attempt including failed ones, that the timeline lists every objective, transition and
fault with a millisecond offset from that attempt's recording start, and that console
messages and uncaught page errors are captured per attempt with their offsets.

**Acceptance Scenarios**:

1. **Given** any attempt, **When** it ends by any means, **Then** a video file for that
   attempt exists at the declared viewport size, and a failed attempt's recording is kept.
2. **Given** an attempt, **When** its recording is examined, **Then** it began before the
   first input command was issued and ended after the stats screen was composited or the
   attempt failed.
3. **Given** any objective completed, state transition or fault, **When** the timeline is
   read, **Then** that event carries its offset in milliseconds from the start of that
   attempt's recording.
4. **Given** any timeline offset, **When** the video is sought to it, **Then** the event
   named at that offset is what the frame shows.
5. **Given** every console message and every uncaught page error, **When** an attempt runs,
   **Then** each is captured with its timeline offset and written beside that attempt's
   recording.

---

### User Story 4 - The playtest record and its verdict (Priority: P1)

As an operator, the command tells me pass or fail on grounds I declared, writes a record I
can read and a record a machine can read, and never leaves me a half-written directory
that looks like a result.

**Why this priority**: This is the story that makes the output a *test* rather than a
recording. It is last because it reports on what the other three produce.

**Independent Test**: Invoke the command and assert the output directory holds a
machine-readable result and a human-readable report; assert the verdict is computed from
the declared hard and soft criteria; assert an interrupted invocation leaves no directory
that reads as a result; and assert the process exit code follows the hard criteria alone.

**Acceptance Scenarios**:

1. **Given** an invocation, **When** it finishes, **Then** exactly one output directory
   exists, holding this invocation's attempts and replacing any previous invocation's.
2. **Given** an invocation interrupted before it finishes, **When** the working tree is
   inspected, **Then** no directory that reads as a completed result was left behind — the
   record is assembled elsewhere and moved into place only once.
3. **Given** the machine-readable result, **When** it is read, **Then** it carries the
   verdict, the attempts used, every hard and soft criterion with its measured value, the
   final run, combat and interaction figures, the lines the stats screen composited, the
   commit the build came from and whether the tree was dirty, and the browser and renderer
   used.
4. **Given** the human-readable report, **When** it is read, **Then** it names the verdict,
   the attempts used, each criterion with its value, and the timeline with its offsets.
5. **Given** an attempt that reached `complete` with no recorded error and no uncaught page
   error, **When** the verdict is computed, **Then** it passes, whatever the completion
   percentages were.
6. **Given** an attempt that did not reach `complete`, or that recorded an error, **When**
   the verdict is computed, **Then** that attempt failed and another may be attempted, up
   to the declared maximum.
7. **Given** an attempt that reached `complete` with a shortfall on any completion
   percentage, **When** the verdict is computed, **Then** the shortfall is reported and no
   further attempt is spent on it.
8. **Given** an invocation where no attempt satisfied every hard criterion, **When** the
   process exits, **Then** the exit code is non-zero.
9. **Given** an invocation that passed on other than its first attempt, **When** the report
   is read, **Then** the number of attempts used is stated in the verdict itself — a pass
   that took three tries never reads as a pass that took one.

---

### Edge Cases

- Pointer lock is refused by the browser or revoked mid-run → a harness fault, not a
  gameplay result: the attempt is abandoned and retried within the declared maximum rather
  than reported as a game defect, because the game is not what failed.
- A guard kills the player mid-route → the attempt failed on a hard criterion, its
  recording is kept, and the next attempt starts from a fresh page.
- The player is wedged on geometry and stops advancing → the leg's own bound expires, the
  attempt fails naming the leg and the position, and the recording shows the wedge.
- A guard wanders onto the tile the runner is walking to → the collider refuses the step;
  the leg's bound expires and the attempt fails naming the leg rather than pushing forever.
- Every guard is dead before the last treasure is collected → legal; objectives are a set
  to be cleared, not an order to be preserved beyond the key-before-locked-door rule.
- The last guard dies out of the camera's view → the kill counter is what confirms the
  objective, so a kill the video did not frame still counts.
- The elevator is used with a treasure uncollected → the run completes; the treasure axis
  falls short, which is a soft criterion and is reported, not retried.
- An attempt fails after the recording has started → the recording is finalized and kept;
  a failed attempt with no video is the one outcome that teaches nothing.
- The output directory already exists from a previous invocation → it is replaced, not
  merged, so no artifact of a previous run is ever read as part of this one.
- The runner is invoked with the working tree dirty → permitted, and the record says so,
  because a UAT result whose provenance is unstated is not evidence.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A declared npm script SHALL build the page, serve the built output over
  loopback, and launch a browser against it with a visible rendering surface on the host
  display; with no display available it MUST refuse with a message naming the reason and
  exit non-zero rather than running a software-rendered substitute.
- **FR-002**: The playthrough SHALL drive the game exclusively through the input events the
  game already binds — pointer lock acquired by clicking the game canvas, movement by
  `keydown`/`keyup` on the codes the keyboard adapter binds, look by mouse movement under
  that lock, interaction by the codes the interaction bindings declare, and fire and weapon
  selection by their own bindings — and MUST NOT call `window.__playerDrive` or introduce
  any new input seam under `src/`.
- **FR-003**: Every command SHALL be paced against the page's own animation frames so that
  frames render, guards take ticks and doors interpolate while it runs; the runner MUST
  confirm the pointer is locked before issuing any look command and MUST classify a refused
  or revoked lock as a harness fault rather than a gameplay result.
- **FR-004**: Routing between objectives SHALL use the game's own pathfinding module over
  the level grid and the live open-tile state, compiled for the runner from that same
  source rather than reimplemented, and a leg the pathfinder reports unreachable MUST fail
  the attempt naming the leg.
- **FR-005**: The playthrough SHALL reach the run state `complete` by issuing the interact
  command at the level's single exit tile; the directory it writes MUST be excluded from
  version control and skipped by the binary-asset walker, so that no recording can be
  staged for commit and the smoke gate passes with that directory populated.
- **FR-006**: The objective set SHALL be derived at run time from the level's own data —
  every enemy marker, every secret tile of the grid, every treasure item entry and the
  single exit tile — and MUST NOT carry a hardcoded count of any of them.
- **FR-007**: A guard objective SHALL be completed by turning the camera to that guard's
  bearing as published in the diagnostics roster, issuing the fire command through its real
  binding, and confirming the kill against the kill counter; the runner MUST select a
  weapon holding ammunition before firing and MUST NOT issue a fire command while the run
  state is not `playing`.
- **FR-008**: A secret objective SHALL be completed by the interact command at its tile and
  confirmed against the secrets-found counter; an objective that collects the key a locked
  door's lock-table entry names MUST precede any objective routed through that door, and a
  refused interaction MUST be reported with the reason the interaction diagnostics publish
  rather than retried blindly.
- **FR-009**: A health pickup SHALL be collected when health falls below a declared
  threshold and an ammunition pickup when the selected weapon's ammunition falls below its
  own, both thresholds declared in one place.
- **FR-010**: Every attempt SHALL be recorded to a video file at a declared viewport size,
  beginning before the first input command and ending after the stats screen is composited
  or the attempt fails, and the recording of a failed attempt MUST be kept.
- **FR-011**: The runner SHALL record a timeline of every objective completed, every run
  state transition and every fault, each carrying its offset in milliseconds from the start
  of that attempt's recording, so any reported event can be located in the video by seeking
  to its offset.
- **FR-012**: Every console message and every uncaught page error SHALL be captured per
  attempt with its timeline offset and written beside that attempt's recording.
- **FR-013**: The runner SHALL write one output directory per invocation, replacing any
  previous invocation's, assembled in a temporary location and moved into place only once
  the invocation has finished, so that an interrupted invocation leaves no directory that
  reads as a completed result.
- **FR-014**: The record SHALL include a machine-readable result carrying the verdict, the
  attempts used, every hard and soft criterion with its measured value, the final run,
  combat and interaction figures, the lines the stats screen composited, the commit the
  build came from and whether the working tree was dirty, and the browser and renderer the
  run used.
- **FR-015**: The record SHALL include a human-readable report naming the verdict, the
  attempts used, each criterion with its measured value, and the timeline with its offsets.
- **FR-016**: The verdict SHALL be two-tier — reaching `complete`, an empty recorded-error
  list and no uncaught page error are hard criteria that fail an attempt, while completion
  percentages, rating, frame rate and duration are soft criteria that are reported and
  never fail one. An attempt MAY be retried only on a hard failure or a harness fault, up
  to a declared maximum of three; the process SHALL exit non-zero when no attempt satisfied
  every hard criterion, and the stated verdict MUST carry the number of attempts used.

### Key Entities

- **Playthrough**: one invocation of the command — up to three attempts, one record.
- **Attempt**: one loaded page driven from spawn until it completes or fails; the unit a
  recording, a timeline and a console capture belong to.
- **Objective**: one thing the level offers to be cleared — a guard, a secret, a treasure,
  a key or the exit — derived from the level's own data and confirmed by the counter that
  owns it.
- **Leg**: the path between two objectives, produced by the game's own pathfinder and
  walked with real input.
- **Hard Criterion**: a condition whose failure fails an attempt and may spend a retry.
- **Soft Criterion**: a measured value that is reported and never fails an attempt.
- **Verdict**: the two-tier outcome of an invocation, carrying the attempts it took.
- **Playtest Record**: the output directory — per-attempt recordings, console captures, the
  machine-readable result and the human-readable report.
- **Timeline**: the ordered events of one attempt, each stamped with its offset from that
  attempt's recording start.
- **Harness Fault**: a failure that is not a fact about the game — a refused pointer lock, a
  browser that would not launch, a page that never loaded — retryable, and never reported
  as a gameplay result.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: One command on a host with a display produces a video of the level being
  played and completed, and exits zero.
- **SC-002**: The same command on a host with no display refuses by name and exits
  non-zero, having written nothing.
- **SC-003**: Across a passing run, `window.__playerDrive` is never called and no new input
  seam exists under `src/`; every command the agent issued was one the game already bound.
- **SC-004**: The objective set built against the shipped level contains one objective per
  enemy marker, per secret tile, per treasure entry and one for the exit, with no count
  written into the runner.
- **SC-005**: Every attempt, passing or failing, leaves a recording, a console capture and
  a timeline whose offsets locate its events in that recording.
- **SC-006**: The record states the verdict, the attempts used, and every hard and soft
  criterion with its measured value, alongside the commit and dirty state of the tree the
  build came from.
- **SC-007**: `npm run typecheck`, `npm run build`, `npm run test` and `npm run smoke` all
  pass with the output directory populated, and `git status` reports a clean tree after a
  run.
- **SC-008**: An invocation interrupted mid-run leaves no output directory that reads as a
  completed result.

## Assumptions

- 001–008 have landed: the diagnostics surface, the validated level, the collider, the
  interact command path, materials, guards, weapons and the HUD, and the elevator with its
  stats screen.
- The host running the command has a display, a GPU, and a browser with a visible rendering
  surface. This is an operator's machine, never CI: the command is deliberately absent from
  `ergane.yaml` and can never be a required check.
- Pointer lock is granted to a real click on the game canvas, and synthesized mouse
  movement under that lock turns the camera. Both were measured on the built page on
  2026-09-02 and are the reason no input seam is added.
- The recording's frame rate is the browser's screencast rate, not the game's frame rate;
  the frame rate the record reports is the one the game measured, and the two are not the
  same number.
- The agent's *perception* is the diagnostics surface — guard bearings, health, ammunition,
  counters. Only its *input* is constrained to be real. Reading rendered pixels to aim
  would be purer and is out of scope.
- Guard behaviour against a live player is not reproducible run to run: guards react to
  timing this spec does not control. That is why attempts exist and why the attempt count
  is reported rather than hidden.
- A recording is build output in the sense `dist/` is, not a repository asset in the sense
  Constitution II forbids. That distinction is recorded in `DECISIONS.md`.

## Work Graph

```yaml
US1:
  depends_on: []
  implements: [FR-001, FR-002, FR-003, FR-004, FR-005]
US2:
  depends_on: [US1]
  implements: [FR-006, FR-007, FR-008, FR-009]
US3:
  depends_on: [US1]
  implements: [FR-010, FR-011, FR-012]
US4:
  depends_on: [US2, US3]
  implements: [FR-013, FR-014, FR-015, FR-016]
```
