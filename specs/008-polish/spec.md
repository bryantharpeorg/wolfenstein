# Feature Specification: Elevator Exit, Audio and Post-Processing

**Feature Branch**: `008-polish`

**Created**: 2026-08-29

**Status**: Draft

**Input**: Milestone M7 of the Wolfenstein-style FPS brief. Makes the level finishable and
then makes it feel finished: the `E` tile becomes an elevator that ends the run, a stats
screen reports what the run was worth, WebAudio synthesizes every sound from oscillators
and noise buffers because Constitution II forbids an audio file, and a toggleable
post-processing chain adds bloom, SSAO, motion blur and film grain. The two presentation
stories carry explicit fallback criteria: a silent event and a disabled effect are
legitimate outcomes recorded in `DECISIONS.md`, a black screen is not.

## Clarifications

### Session 2026-08-29

- Q: What ends the level? → A: The interact command from 004, issued at the `E` tile. One command path — the elevator is a thing you use, not a trigger volume you fall into, so the outcome is stated like every other interaction in 004.
- Q: Is completion instant? → A: No. Pressing the switch enters an `exiting` state that plays a declared elevator travel duration before `complete`, using the same elapsed-time interpolation 004 fixed for doors.
- Q: Where do sounds come from? → A: WebAudio oscillators, noise buffers and envelopes built at runtime. No `.mp3`, `.wav` or `.ogg` at any path (Constitution II).
- Q: How does audio behave under the browser's autoplay policy? → A: The context is created suspended and resumed on the first user gesture. Startup MUST NOT depend on audio, and a blocked context is a silent game, never a failed load.
- Q: Is audio asserted in the smoke gate? → A: Its wiring is, not its sound. The harness asserts the context state, the synthesized-buffer inventory and that no console error came from the audio path; it never listens.
- Q: What happens if an effect will not run on the active backend? → A: It is disabled, the scene still renders, and the omission is one line in `DECISIONS.md` plus an entry in `window.__diag.post.fallbacks`. Post-processing never gets to take the game down with it.
- Q: Does this spec change gameplay balance? → A: No. It reads counters 004 and 007 already maintain; it does not recompute kills, secrets or score.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Elevator exit ends the run (Priority: P1)

As a player, I reach the elevator at the far end of the maze, press use, the doors travel
and the level ends — which is the first time in this project that the game can be *won*
rather than merely survived.

**Why this priority**: This is the milestone's DONE condition — "level completable start
to finish" — and the last missing edge of the gameplay loop 007 closed on the losing side.
Nothing else in this spec is reachable by a player who cannot finish.

**Independent Test**: In the headless harness, script the player from spawn to the `E`
tile through the doors and keys the shipped layout requires, issue the interact command,
and assert the run state moves `playing` → `exiting` → `complete` with the elevator's
travel taking its declared duration; then assert no further damage, firing or guard
movement resolves.

**Acceptance Scenarios**:

1. **Given** the player adjacent to the level's single `E` tile, **When** the interact
   command is issued, **Then** it resolves through 004's one command path, the outcome is
   the declared `exit-used`, and the run state becomes `exiting`.
2. **Given** the player not adjacent to the `E` tile, **When** the interact command is
   issued, **Then** the outcome is 004's `no-target` and the run state is unchanged — the
   elevator cannot be triggered from across the room.
3. **Given** the run in `exiting`, **When** the declared elevator travel duration elapses,
   **Then** the run state becomes `complete`; **And** when the same duration is stepped as
   1 ms deltas and as 500 ms deltas, **Then** the transition occurs after the same total
   elapsed time within 1e-6.
4. **Given** the run in `exiting`, **When** the interact command is issued again, **Then**
   the outcome is the declared `already-exiting`, no second transition fires, and the
   travel is not restarted.
5. **Given** the run in `complete`, **When** further frames render, **Then** the render
   loop continues, no guard moves or fires, no damage is applied to the player, and the
   player's own fire command resolves nothing.
6. **Given** the player at zero health, **When** the interact command is issued at the
   elevator, **Then** it is refused — a dead player does not complete the level.
7. **Given** the run timer, **When** read at `complete`, **Then** it reports wall-clock
   milliseconds from spawn or the most recent restart to the moment `complete` was
   entered, is monotonic non-decreasing while `playing`, and stops advancing once
   `complete` is entered.
8. **Given** the shipped level, **When** a path from the player spawn to the `E` tile is
   computed with 006's pathing across empty, open-door and opened-secret tiles, **Then**
   one exists — the level is provably completable before a human ever plays it.

---

### User Story 2 - Stats screen and run diagnostics (Priority: P1)

As a player, finishing the level shows me what the run was worth — elapsed time, guards
killed out of total, secrets found out of total, treasure found out of total, score, and a
rating — and lets me start again from that screen.

**Why this priority**: Completion with no readout is a level that ends by going quiet. It
is also where the counters every earlier spec maintained are finally reconciled against
each other, which is the cheapest place in the project to catch a counter that has been
lying since M3.

**Independent Test**: Drive a scripted headless run to completion, read
`window.__diag.run`, and assert every displayed statistic equals the corresponding counter
in `__diag.combat` and `__diag.interaction`; then issue restart from the stats screen and
assert the reset is 007's, field for field.

**Acceptance Scenarios**:

1. **Given** the run state `complete`, **When** the stats screen renders, **Then** it
   displays elapsed time, kills over total guards, secrets found over `secretsTotal`,
   treasure found over `treasureTotal`, and score.
2. **Given** the stats screen, **When** each displayed value is compared to its source,
   **Then** kills equals `__diag.combat.kills`, secrets equals
   `__diag.interaction.secretsFound`, treasure equals `__diag.combat.treasureFound` and
   score equals `__diag.combat.score` — the screen reports counters, it does not recompute
   them.
3. **Given** every percentage the screen shows, **When** its denominator is zero, **Then**
   it renders a declared placeholder rather than `NaN` or a division error.
4. **Given** the declared rating bands, **When** a run's kill, secret and treasure
   percentages are supplied, **Then** the rating is selected from a declared table, and a
   perfect run on all three axes selects the top band.
5. **Given** the stats screen, **When** its glyphs are inspected, **Then** they come from
   007's code-defined stroke table, and no font file exists at any path.
6. **Given** the restart command issued from the stats screen, **When** it resolves,
   **Then** it performs exactly 007's FR-011 reset, the run state returns to `playing`,
   the run timer restarts from zero, and `completions` has incremented by one.
7. **Given** `window.__diag.run`, **When** read, **Then** it carries `state` (`playing`,
   `dead`, `exiting`, `complete`), `elapsedMs`, `kills`, `guardsTotal`, `secretsFound`,
   `secretsTotal`, `treasureFound`, `treasureTotal`, `score`, `rating` and `completions`,
   additive over the 001–007 contracts with no existing field renamed, removed or
   repurposed.
8. **Given** a completed run followed by a restart and a second completion, **When**
   `completions` is read, **Then** it is 2, and every other field reflects the second run
   rather than accumulating across both.

---

### User Story 3 - Procedural audio (Priority: P2)

As a player, the level has a voice — each weapon cracks differently, doors grind, my
footsteps keep time with my stride, and a low drone sits under all of it — and every one
of those sounds is built from oscillators and noise at load time, not loaded from a file.

**Why this priority**: The game is completable and legible without a single sound, so this
refines a finished loop. It carries a fallback because a WebAudio graph that produces
silence throws nothing, logs nothing and passes every gate — it is the least
self-reporting surface in the project.

**Independent Test**: Under `npm run test`, assert the synthesis module builds each
declared sound's buffer or node graph description as pure data with the declared duration
and envelope, with no `AudioContext` required; then under `npm run smoke`, assert the
context exists, is suspended before any gesture, lists the declared sound inventory, and
recorded no console error.

**Acceptance Scenarios**:

1. **Given** the repository, **When** searched for files with extension `mp3`, `wav`,
   `ogg` or `m4a`, **Then** none exist at any path, and every sound is produced by
   oscillators, noise buffers and envelopes built in code.
2. **Given** the declared sound inventory, **When** read, **Then** it names at least
   gunfire per weapon kind, a door sound, a footstep and an ambient drone, each with a
   declared duration and envelope in one table.
3. **Given** the three weapons, **When** their gunfire sounds are compared, **Then** each
   has a distinct declared parameter set — three weapons that share one sound is a
   passing build and a failed story.
4. **Given** a resolved shot, a door state change, and a measured footstep cadence,
   **When** each occurs, **Then** the corresponding sound is triggered by that event and
   not by the key that caused it, so a refused shot or a blocked door is silent.
5. **Given** the page loaded with no user gesture yet, **When** the audio context state is
   read, **Then** it is `suspended`, no sound has played, and startup completed normally —
   nothing in the load path awaits audio.
6. **Given** the first user gesture, **When** it occurs, **Then** the context resumes, and
   a browser that refuses to resume leaves the game fully playable and silent with no
   uncaught exception and no entry in `__diag.errors`.
7. **Given** more simultaneous sound triggers than the declared voice cap, **When** they
   fire on one frame, **Then** the oldest voices are stopped so the live count never
   exceeds the cap, and the master gain keeps the summed signal below the declared ceiling.
8. **Given** any sound's envelope, **When** it starts and ends, **Then** it ramps over a
   declared attack and release rather than switching gain instantaneously — no click at
   either edge.
9. **Given** a sound that cannot be synthesized, **When** the build proceeds, **Then** that
   event is silent, everything else still plays, and the omission is recorded as one line
   in `DECISIONS.md` and in `window.__diag.audio.fallbacks` — a missing sound never blocks
   the epic.

---

### User Story 4 - Toggleable post-processing chain (Priority: P2)

As a player on hardware that has the budget for it, the level gets bloom on the muzzle
flash, ambient occlusion in the corners, motion blur on a fast turn and a film grain over
all of it — and I can switch each of the four off independently when I would rather have
the frames.

**Why this priority**: Pure presentation over a complete game, and the single highest-risk
surface for a silent failure — a broken post chain renders a black screen that compiles,
type-checks and reports a healthy frame rate. It lands last, behind a fallback, so it can
be dropped without taking the milestone with it.

**Independent Test**: Load the built page headlessly and read `window.__diag.post`; assert
all four effects are listed with their default states; toggle each on and off through the
declared binding and assert after every toggle that a frame still renders, `__diag.errors`
is empty, and the reported effect state matches what was requested.

**Acceptance Scenarios**:

1. **Given** `window.__diag.post`, **When** read after the first frame, **Then** it lists
   exactly `bloom`, `ssao`, `motionBlur` and `filmGrain`, each with a boolean enabled state
   and each defaulting to a value declared in one place.
2. **Given** any of the four effects, **When** its declared toggle is used, **Then** that
   effect's state flips, the other three are unchanged, and the change takes effect without
   a page reload.
3. **Given** any effect toggled on, **When** the next frame renders, **Then** the frame
   completes, `window.__diag.ready` stays true, and no entry is added to
   `__diag.errors` — an effect that cannot render must be reported, never merely dark.
4. **Given** all four effects enabled, **When** frame time is measured over 120 frames,
   **Then** the cost is reported as `__diag.post.frameCostMs` against the same measurement
   with all four disabled, so a regression is a number rather than a feeling.
5. **Given** all four effects disabled, **When** `__diag.fps` is read, **Then** it is at or
   above the floor declared by 001's harness — the game without post-processing is never
   slower than the game was before this spec.
6. **Given** bloom enabled and a muzzle flash from 007, **When** the flash frame renders,
   **Then** measured brightness around the flash exceeds the same region with bloom
   disabled — the effect is applied, not merely constructed.
7. **Given** either renderer backend from 001, **When** the page loads, **Then** the post
   chain initializes on that backend or disables itself cleanly, and the scene renders
   either way.
8. **Given** an effect that cannot be made to work on the active backend, **When** the
   build proceeds, **Then** that effect is disabled and listed in
   `window.__diag.post.fallbacks`, the omission is recorded as one line in `DECISIONS.md`,
   and the remaining effects and the scene still render.
9. **Given** the post chain active, **When** the viewport is resized, **Then** every render
   target is resized within one frame, the scene still renders, and no error is recorded.
10. **Given** the post chain and the HUD from 007, **When** a frame renders, **Then** the
    HUD is legible above the effects and `__diag.drawCalls` is reported so the budget
    remains observable.

---

### Edge Cases

- Player presses use at the elevator while a guard's shot is in flight that would kill them
  → the shot resolves in the same tick; if health reaches zero the run enters `dead` and
  the exit is refused (US1-S6), so a run cannot be both won and lost.
- Elevator reached without finding any secret or killing any guard → legal; the stats
  screen shows zero percentages and the rating table's lowest band, and no percentage
  divides by zero (US2-S3).
- Restart issued mid-`exiting` → the reset applies and the run returns to `playing` with
  the elevator closed; the pending `complete` transition is discarded rather than firing
  after the reset.
- Autoplay policy blocks the context for the entire session → the game is fully playable
  and silent; `__diag.audio.contextState` reports `suspended` and the smoke gate treats that
  as a pass, because headless Chromium has no gesture to give.
- Tab backgrounded with the drone playing → the context is suspended with the tab and
  resumed on return without a click or a doubled voice.
- Chaingun held at its full rate → the voice cap (US3-S7) stops the oldest gunfire voices
  rather than stacking gain until the output clips.
- Post chain enabled on the WebGL fallback where an effect has no implementation → that
  effect disables itself and is listed in `fallbacks`; the other three and the scene are
  unaffected.
- All four effects toggled on and off 100 times in one session → no render target is leaked;
  the reported target count returns to its baseline, so a toggle is not a slow memory leak.
- Motion blur with a stationary camera → contributes no visible change and no error; an
  effect that only manifests under motion must still be safe at rest.
- Stats screen rendered while the post chain is active → the screen is composited above the
  effects and remains legible, since it is the last thing a completed run shows.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The `E` tile SHALL be usable through 004's single interact command path,
  returning the declared outcome `exit-used` when the player is adjacent and alive,
  `no-target` when not adjacent, `already-exiting` when the run is already `exiting`, and
  MUST refuse when player health is zero.
- **FR-002**: Using the elevator SHALL move the run state from `playing` to `exiting`, and
  after a declared travel duration interpolated from accumulated elapsed seconds — equal
  within 1e-6 whether stepped at 1 ms or 500 ms deltas — to `complete`.
- **FR-003**: In the `complete` state the render loop MUST continue while no guard moves or
  fires, no damage is applied to the player, and the player's fire command resolves
  nothing.
- **FR-004**: A run timer SHALL report wall-clock milliseconds from spawn or the most
  recent restart, MUST be monotonic non-decreasing while `playing`, and MUST stop advancing
  once `complete` is entered.
- **FR-005**: The stats screen SHALL display elapsed time, kills over total guards, secrets
  found over `secretsTotal`, treasure found over `treasureTotal`, score and a rating drawn
  from a declared band table, rendering a declared placeholder rather than `NaN` when any
  denominator is zero.
- **FR-006**: Every value the stats screen displays MUST equal the corresponding counter in
  `__diag.combat` and `__diag.interaction`; the screen SHALL NOT recompute kills, secrets,
  treasure or score.
- **FR-007**: Restart from the stats screen SHALL perform exactly 007's reset, return the
  run state to `playing`, restart the run timer at zero, and increment `completions` by one
  per completed run.
- **FR-008**: The application SHALL extend `window.__diag` with a `run` object carrying
  `state`, `elapsedMs`, `kills`, `guardsTotal`, `secretsFound`, `secretsTotal`,
  `treasureFound`, `treasureTotal`, `score`, `rating` and `completions`, additive over the
  001–007 contracts, and the smoke harness MUST drive a scripted run to `complete` and fail
  when any stats value disagrees with its source counter.
- **FR-009**: All audio MUST be synthesized at runtime from oscillators, noise buffers and
  envelopes; no `.mp3`, `.wav`, `.ogg` or `.m4a` file SHALL exist at any path.
- **FR-010**: A single declared sound table SHALL name at least gunfire per weapon kind, a
  door sound, a footstep and an ambient drone, each with its duration and envelope, and
  each weapon's gunfire MUST carry a distinct parameter set.
- **FR-011**: Sounds SHALL be triggered by the resolved event — a shot that fired, a door
  that changed state, a measured footstep cadence — and MUST NOT be triggered by the input
  that requested it, so a refused shot or a blocked door is silent.
- **FR-012**: The audio context SHALL be created suspended and resumed on the first user
  gesture; startup MUST NOT await audio, and a context that never resumes MUST leave the
  game fully playable and silent with no uncaught exception and no entry in
  `__diag.errors`.
- **FR-013**: Concurrent voices MUST be capped at a declared maximum by stopping the oldest
  voices, master gain MUST keep the summed signal below a declared ceiling, and every voice
  SHALL ramp over a declared attack and release rather than switching gain
  instantaneously; a sound that cannot be synthesized SHALL be silent and recorded in
  `DECISIONS.md` and in `window.__diag.audio.fallbacks`.
- **FR-014**: The post-processing chain SHALL provide exactly `bloom`, `ssao`,
  `motionBlur` and `filmGrain`, each independently toggleable at runtime without a page
  reload through a declared binding, with default states declared in one place.
- **FR-015**: After any toggle the page MUST still render a frame with `__diag.ready` true
  and no new entry in `__diag.errors`, and every render target MUST be resized within one
  frame of a viewport change without leaking targets across repeated toggles.
- **FR-016**: The chain MUST initialize on both renderer backends from 001 or disable
  itself cleanly on the one it cannot support; an effect that cannot run SHALL be disabled
  and listed in `window.__diag.post.fallbacks` with one line recorded in `DECISIONS.md`,
  and the scene MUST still render.
- **FR-017**: With all four effects disabled, `__diag.fps` MUST remain at or above 001's
  declared harness floor; with all four enabled, the added cost SHALL be reported as
  `__diag.post.frameCostMs` measured against the disabled baseline.
- **FR-018**: The application SHALL extend `window.__diag` with an `audio` object carrying
  `contextState`, the synthesized sound inventory, live voice count and `fallbacks`, and a
  `post` object carrying each effect's enabled state, `frameCostMs` and `fallbacks`, both
  additive over the 001–007 contracts; the smoke harness MUST fail on any console error
  originating in the audio or post path.

### Key Entities

- **RunState**: `playing | dead | exiting | complete` — the run's lifecycle, owned by this
  spec, extending the alive/dead pair 007 established.
- **ElevatorSwitch**: the `E` tile as an interactable, its travel duration and its declared
  outcomes (`exit-used`, `already-exiting`).
- **RunStats**: elapsed time, kills, secrets, treasure, score and rating — a projection of
  counters owned by 004 and 007, never a second source of truth.
- **RatingTable**: the declared bands mapping kill, secret and treasure percentages to a
  rating.
- **SoundTable**: the declared inventory of synthesized sounds — gunfire per weapon, door,
  footstep, drone — each with duration, envelope and parameters.
- **VoicePool**: live voice count, declared cap and master gain ceiling; what keeps a held
  chaingun from clipping the output.
- **PostChain**: the four effects, their default states, their render targets and the
  `fallbacks` list that records anything the active backend could not run.
- **RunDiagnostics**: the `window.__diag.run`, `window.__diag.audio` and
  `window.__diag.post` objects, additive over 001–007.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A scripted headless run reaches the elevator from spawn — through the doors
  and keys the shipped layout requires — and `__diag.run.state` reaches `complete`,
  demonstrating the level is completable start to finish.
- **SC-002**: Every stats value equals its source counter in `__diag.combat` and
  `__diag.interaction`, asserted field for field at completion.
- **SC-003**: Restart from the stats screen produces 007's exact reset and a second
  completion increments `completions` to 2 without accumulating the first run's figures.
- **SC-004**: No `.mp3`, `.wav`, `.ogg` or `.m4a` file exists in the tree, checked inside
  the smoke gate, while `__diag.audio` lists at least six synthesized sounds.
- **SC-005**: The page loads, plays and completes with the audio context never resuming,
  with no uncaught exception and no entry in `__diag.errors`.
- **SC-006**: Each of the four effects is toggled on and off headlessly, and after all
  eight toggles a frame still renders with `__diag.errors` empty.
- **SC-007**: With all effects disabled, `__diag.fps` is at or above 001's harness floor;
  with all enabled, `__diag.post.frameCostMs` is reported as a number.
- **SC-008**: Any fallback taken under FR-013 or FR-016 appears in both `DECISIONS.md` and
  the corresponding `fallbacks` array, so what was traded away is readable without reading
  the diff.

## Assumptions

- 001–007 have landed: diagnostics and the smoke harness, the validated level and its `E`
  tile, a colliding player, 004's interact command path and door and secret counters, 005's
  materials and lighting, 006's guards, and 007's weapons, health, restart and HUD glyph
  table.
- The stats screen reuses 007's code-defined glyph table rather than introducing a second
  text renderer.
- Restart semantics are 007's FR-011 exactly; this spec adds a caller, not a second reset.
- Headless Chromium has no user gesture, so the audio context stays suspended for the whole
  smoke run; audio assertions are about wiring and inventory, never about sound.
- Post-processing implementations differ between the WebGPU and WebGL backends; FR-016's
  per-backend disable is why that difference cannot stall the epic.
- Effect tuning values — bloom threshold, SSAO radius, grain intensity, blur strength — are
  declared constants; the tests assert togglability and cost reporting, not tuned
  magnitudes.
- Music is out of scope. The ambient drone is a synthesized bed, not a composition.

## Work Graph

```yaml
US1:
  depends_on: []
  implements: [FR-001, FR-002, FR-003, FR-004]
US2:
  depends_on: [US1]
  implements: [FR-005, FR-006, FR-007, FR-008]
US3:
  depends_on: [US2]
  implements: [FR-009, FR-010, FR-011, FR-012, FR-013]
US4:
  depends_on: [US3]
  implements: [FR-014, FR-015, FR-016, FR-017, FR-018]
```
