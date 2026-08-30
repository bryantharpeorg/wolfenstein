---
description: "Task list for 008-polish: Elevator Exit, Audio and Post-Processing"
---

# Tasks: Elevator Exit, Audio and Post-Processing

**Input**: Design documents from `/specs/008-polish/`

**Prerequisites**: plan.md (required), spec.md (required for user stories)

**Tests**: Included. Constitution Article III requires test-first for DOM-free,
three.js-free logic, and most of this spec is exactly that: run state, elevator
resolution, completability, the stats projection, the rating table, sound synthesis, the
voice pool, trigger mapping, post effect state and cost sampling.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to
- Exact file paths are given in every description

## Path Conventions

Single project. `src/`, `tests/`, `tools/` at repository root, per plan.md. New behaviour
arrives as `src/systems/<name>/register.ts`, discovered by glob in `src/boot/discover.ts`,
so adding a system edits no shared wiring file. Each story here owns exactly one system
directory, one diagnostics slice and one smoke-check file.

---

## Phase 1: User Story 1 - Elevator exit ends the run (Priority: P1) 🎯 MVP

**Goal**: The `E` tile is usable through 004's one interact command path, moves the run
`playing → exiting → complete` over a declared travel duration, and stops every actor
without stopping the frame loop.

**Independent Test**: Script the player from spawn to the `E` tile through the doors and
keys the shipped layout requires, issue the interact command, and assert the run state
moves `playing` → `exiting` → `complete` with the travel taking its declared duration;
then assert no further damage, firing or guard movement resolves.

### Tests for User Story 1

> Write these first and confirm they fail before implementing.

- [ ] T001 [P] [US1] `tests/unit/run-state.test.ts`: the run-state machine transitions `playing → exiting → complete` after the declared travel duration, the same total elapsed time stepped as 1 ms and as 500 ms deltas transitions within 1e-6, the run timer is monotonic non-decreasing while `playing` and stops advancing at `complete`, and a second interact while `exiting` neither re-transitions nor restarts the travel (FR-002, FR-004, US1-S3, US1-S4, US1-S7).
- [ ] T002 [P] [US1] `tests/unit/elevator.test.ts`: the elevator resolver returns `exit-used` adjacent and alive, `no-target` when not adjacent, `already-exiting` when the run is already `exiting`, and refuses at zero health — pure input to output, no DOM and no three.js import (FR-001, US1-S1, US1-S2, US1-S4, US1-S6).
- [ ] T003 [P] [US1] `tests/unit/run-gating.test.ts`: the gating predicates permit guard movement, guard fire, damage application and player fire in `playing`, and refuse all four in `complete`, while nothing in the module can stop the frame loop (FR-003, US1-S5).
- [ ] T004 [P] [US1] `tests/unit/level-completable.test.ts`: a path from the shipped `src/level.ts` player spawn to its single `E` tile exists across empty, open-door and opened-secret tiles — the level is provably completable before a human plays it (FR-001, US1-S8, SC-001).

### Implementation for User Story 1

- [ ] T005 [US1] Implement `src/run/state.ts` — the `playing | dead | exiting | complete` machine, the run timer in wall-clock milliseconds from spawn or the most recent restart, and elevator travel interpolated from accumulated elapsed seconds; `step()` returns the transition it made so a later story can observe `complete` without editing this file (FR-002, FR-004, US1-S3, US1-S7).
- [ ] T006 [P] [US1] Implement `src/run/elevator.ts` — adjacency to the single `E` tile read from `src/level.ts` and the declared outcomes `exit-used`, `no-target` and `already-exiting`, refusing at zero health; no DOM and no three.js import so it runs under `npm run test` (FR-001, US1-S1, US1-S2, US1-S4, US1-S6).
- [ ] T007 [P] [US1] Implement `src/run/gating.ts` — the predicates the guard, damage and fire paths consult so that in `complete` no guard moves or fires, no damage is applied and the player's fire command resolves nothing, expressed as pure functions of run state (FR-003, US1-S5).
- [ ] T008 [P] [US1] Implement `src/run/completable.ts` — reachability from the player spawn to the `E` tile over 006's pathing, treating empty, open-door and opened-secret tiles as passable, exported for T004 and for US2's smoke check (FR-001, US1-S8, SC-001).
- [ ] T009 [US1] Implement `src/systems/elevator/register.ts` — at setup, register `src/run/elevator.ts` as a target of 004's single interact resolution path rather than adding a second command path; each frame, step `src/run/state.ts` with the frame delta so the render loop keeps running through `exiting` and `complete` (FR-001, FR-002, FR-003, US1-S1, US1-S5).
- [ ] T010 [US1] Consult `src/run/gating.ts` from the guard-step and fire-resolution systems 006 and 007 landed under `src/systems/`, so a completed run stops actors by predicate rather than by unregistering a system or returning early from the loop (FR-003, US1-S5).
- [ ] T011 [US1] Handle the restart-mid-`exiting` edge case in `src/run/state.ts`: the reset returns the run to `playing` with the elevator closed and the pending `complete` transition discarded rather than firing after the reset (FR-002, Edge Cases).

**Checkpoint**: The level can be finished. `__diag` still reports what 001–007 gave it;
the run is not yet legible from outside.

---

## Phase 2: User Story 2 - Stats screen and run diagnostics (Priority: P1)

**Goal**: Completion shows what the run was worth, every figure sourced from a counter an
earlier spec already owns, and restart from that screen is 007's reset with one counter
added.

**Independent Test**: Drive a scripted headless run to completion, read
`window.__diag.run`, and assert every displayed statistic equals the corresponding counter
in `__diag.combat` and `__diag.interaction`; then issue restart from the stats screen and
assert the reset is 007's, field for field.

### Tests for User Story 2

> Write these first and confirm they fail before implementing.

- [ ] T012 [P] [US2] `tests/unit/run-stats.test.ts`: the projection copies kills, secrets, treasure and score from the counters it is handed without recomputing any of them, and renders the declared placeholder rather than `NaN` or a division error when a denominator is zero (FR-005, FR-006, US2-S1, US2-S2, US2-S3).
- [ ] T013 [P] [US2] `tests/unit/rating.test.ts`: the declared band table selects a rating from kill, secret and treasure percentages, and a perfect run on all three axes selects the top band (FR-005, US2-S4).
- [ ] T014 [P] [US2] `tests/unit/run-completions.test.ts`: the completion counter increments once per completed run, survives the reset, and after a completion, a restart and a second completion reads 2 while every other figure reflects the second run only (FR-007, US2-S6, US2-S8).

### Implementation for User Story 2

- [ ] T015 [US2] Implement `src/run/stats.ts` — the pure projection of elapsed time, kills over total guards, secrets over `secretsTotal`, treasure over `treasureTotal` and score into a `RunStats` value, with the declared zero-denominator placeholder; it reads counters and owns none (FR-005, FR-006, US2-S1, US2-S2, US2-S3).
- [ ] T016 [P] [US2] Implement `src/run/rating.ts` — the declared rating band table mapping kill, secret and treasure percentages to a rating, as data in one place rather than branches at a call site (FR-005, US2-S4).
- [ ] T017 [P] [US2] Implement `src/run/completions.ts` — the completion counter incremented on the `complete` transition `src/run/state.ts` returns, and exempt from 007's reset (FR-007, US2-S6, US2-S8).
- [ ] T018 [US2] Implement `src/run/diag.ts` — declare the `run` slice (`state`, `elapsedMs`, `kills`, `guardsTotal`, `secretsFound`, `secretsTotal`, `treasureFound`, `treasureTotal`, `score`, `rating`, `completions`) and attach it to `window.__diag`, augmenting 001's `Diagnostics` interface by module augmentation from this file so no shared diagnostics module is edited; additive over 001–007 with nothing renamed, removed or repurposed (FR-008, US2-S7).
- [ ] T019 [US2] Implement `src/systems/stats-screen/register.ts` — render the stats screen on `complete` from 007's code-defined stroke glyph table, introducing no second text renderer and no font file, composited above the HUD so it stays legible (FR-005, US2-S1, US2-S5, Edge Cases).
- [ ] T020 [US2] In `src/systems/stats-screen/register.ts`, populate `window.__diag.run` each frame from `src/run/stats.ts`, `src/run/rating.ts` and `src/run/completions.ts`, so the displayed values and the reported values have one source (FR-006, FR-008, US2-S2, US2-S7).
- [ ] T021 [US2] In `src/systems/stats-screen/register.ts`, bind restart from the stats screen to 007's FR-011 reset exactly — no second reset path — then restart the run timer at zero and increment `completions` by one per completed run (FR-007, US2-S6, SC-003).
- [ ] T022 [US2] Extend `tools/smoke.mjs` with a single hook that discovers and runs every `tools/smoke-checks/*.mjs` against the loaded page, adding the page-driving phase if 002–007 have not already — resolving the browser from `PLAYWRIGHT_BROWSERS_PATH` / `CHROME_PATH` and failing with a message naming the missing browser rather than attempting a download or skipping the assertion (FR-008, plan.md Complexity Tracking).
- [ ] T023 [US2] Add `tools/smoke-checks/run.mjs` — drive a scripted run from spawn to the elevator, assert `__diag.run.state` reaches `complete`, then assert field for field that kills equals `__diag.combat.kills`, secrets equals `__diag.interaction.secretsFound`, treasure equals `__diag.combat.treasureFound` and score equals `__diag.combat.score`, failing on any disagreement (FR-008, US2-S2, SC-001, SC-002).

**Checkpoint**: The run is finishable and readable, and the gate proves both. The game is
complete without a sound or an effect; everything after this refines a finished loop.

---

## Phase 3: User Story 3 - Procedural audio (Priority: P2)

**Goal**: Every weapon, door, footstep and the ambient bed has a voice built from
oscillators and noise at runtime, triggered by resolved events, capped and ramped — and a
context that never resumes leaves a fully playable silent game.

**Independent Test**: Under `npm run test`, assert the synthesis module builds each
declared sound as pure data with the declared duration and envelope, with no
`AudioContext` required; then under `npm run smoke`, assert the context exists, is
suspended before any gesture, lists the declared inventory, and recorded no console error.

### Tests for User Story 3

> Write these first and confirm they fail before implementing.

- [ ] T024 [P] [US3] `tests/unit/sound-table.test.ts`: the declared inventory names at least gunfire per weapon kind, a door sound, a footstep and an ambient drone, each with a duration and an envelope in that one table, and the three weapons' gunfire carry distinct parameter sets (FR-010, US3-S2, US3-S3, SC-004).
- [ ] T025 [P] [US3] `tests/unit/synth.test.ts`: each declared sound's buffer is built from oscillator and noise math to the declared duration at a supplied sample rate with no `AudioContext` constructed, and its gain ramps over the declared attack and release rather than switching instantaneously at either edge (FR-009, FR-013, US3-S1, US3-S8).
- [ ] T026 [P] [US3] `tests/unit/voice-pool.test.ts`: more simultaneous triggers than the declared cap stop the oldest voices so the live count never exceeds the cap, and the summed gain stays below the declared ceiling (FR-013, US3-S7).
- [ ] T027 [P] [US3] `tests/unit/audio-triggers.test.ts`: a resolved shot, a door state change and a measured footstep cadence each map to their sound, while a refused shot and a blocked door map to nothing — the trigger is the resolved event, never the key that requested it (FR-011, US3-S4).

### Implementation for User Story 3

- [ ] T028 [US3] Implement `src/audio/sound-table.ts` — the single declared inventory of at least six synthesized sounds (gunfire per weapon kind, door, footstep, drone), each with duration, envelope and parameters, with each weapon's gunfire distinct (FR-010, US3-S2, US3-S3, SC-004).
- [ ] T029 [P] [US3] Implement `src/audio/synth.ts` — oscillator, noise-buffer and envelope sample math returning `Float32Array` data for a supplied sample rate, constructing no `AudioContext` so it runs under `npm run test` (FR-009, US3-S1, US3-S8).
- [ ] T030 [P] [US3] Implement `src/audio/voice-pool.ts` — the declared voice cap with oldest-first eviction and the master gain budget that keeps a held chaingun from clipping the output (FR-013, US3-S7, Edge Cases).
- [ ] T031 [P] [US3] Implement `src/audio/triggers.ts` — the pure mapping from resolved event to sound id, including the footstep cadence accumulated over distance travelled rather than over key-down time (FR-011, US3-S4).
- [ ] T032 [US3] Implement `src/audio/context.ts` — the only WebAudio-aware module: create the context suspended, resume it on the first user gesture, build every buffer from `src/audio/synth.ts`, route voices through the master gain, and record any sound that cannot be synthesized (or a context that cannot be constructed) as a `fallbacks` entry rather than an error; startup must not await it (FR-009, FR-012, FR-013, US3-S5, US3-S6, US3-S9).
- [ ] T033 [US3] Implement `src/audio/diag.ts` — declare and attach `window.__diag.audio` with `contextState`, the synthesized sound inventory, the live voice count and `fallbacks`, augmenting 001's `Diagnostics` interface by module augmentation from this file rather than editing the shared diagnostics module (FR-018, US3-S5, US3-S9).
- [ ] T034 [US3] Implement `src/systems/audio/register.ts` — subscribe to the resolved shot, door state change and footstep cadence from `src/audio/triggers.ts`, play through `src/audio/context.ts` under the voice cap, suspend and resume with tab visibility without doubling the drone, and update `window.__diag.audio` each frame (FR-011, FR-012, FR-013, FR-018, US3-S4, US3-S6, Edge Cases).
- [ ] T035 [US3] Add `.m4a` to the forbidden extension set in `tools/check-no-binaries.mjs` and cover it in `tests/unit/check-no-binaries.test.ts` — FR-009 names four audio extensions and the shipped list omits this one (FR-009, US3-S1, SC-004).
- [ ] T036 [US3] Add `tools/smoke-checks/audio.mjs` — assert `__diag.audio.contextState` is `suspended` before any gesture and treat that as a pass, assert the inventory lists at least six synthesized sounds, and fail on any console error originating in the audio path (FR-012, FR-018, US3-S5, SC-004, SC-005).
- [ ] T037 [US3] Append one line per audio fallback taken to `DECISIONS.md` — the append-only decision log Article VIII fixes, written at the end of the file — naming the silent sound and its one-clause rationale, matching the entry `src/audio/context.ts` records in `__diag.audio.fallbacks` (FR-013, US3-S9, SC-008).

**Checkpoint**: The level has a voice, or a recorded reason why part of it does not. The
game is playable and silent either way.

---

## Phase 4: User Story 4 - Toggleable post-processing chain (Priority: P2)

**Goal**: Bloom, SSAO, motion blur and film grain, each independently toggleable at
runtime, each able to disable itself on a backend that cannot run it, and none able to
turn the screen black without saying so.

**Independent Test**: Load the built page headlessly and read `window.__diag.post`; assert
all four effects are listed with their default states; toggle each on and off through the
declared binding and assert after every toggle that a frame still renders, `__diag.errors`
is empty, and the reported effect state matches what was requested.

### Tests for User Story 4

> Write these first and confirm they fail before implementing.

- [ ] T038 [P] [US4] `tests/unit/post-state.test.ts`: the state module lists exactly `bloom`, `ssao`, `motionBlur` and `filmGrain` with defaults read from one declared place, toggling one flips that effect and leaves the other three unchanged, and a disabled effect is recorded in `fallbacks` (FR-014, FR-016, US4-S1, US4-S2, US4-S8).
- [ ] T039 [P] [US4] `tests/unit/post-cost.test.ts`: the sampler reduces 120 enabled-frame samples and 120 disabled-frame samples to a `frameCostMs` number, so a regression is reported as a figure rather than a feeling (FR-017, US4-S4).

### Implementation for User Story 4

- [ ] T040 [US4] Implement `src/post/state.ts` — exactly the four effects, their default enabled states and their tuning constants (bloom threshold, SSAO radius, blur strength, grain intensity) declared in this one place, the toggle operation, and the `fallbacks` list; pure data and pure functions, importing no renderer (FR-014, FR-016, US4-S1, US4-S2).
- [ ] T041 [P] [US4] Implement `src/post/cost.ts` — the pure frame-cost sampler producing `frameCostMs` for the enabled chain measured against the disabled baseline over 120 frames (FR-017, US4-S4, US4-S5).
- [ ] T042 [US4] Implement `src/post/render-hook.ts` — the single render indirection, a passthrough to `renderer.render(scene, camera)` until a chain installs itself, so that installing post-processing is not an edit to the frame loop (FR-015, US4-S3).
- [ ] T043 [US4] Route the frame's render call in `src/main.ts` through `src/post/render-hook.ts` — one import and one changed call, no behaviour added to the bootstrap (FR-015, US4-S3).
- [ ] T044 [US4] Implement `src/post/chain.ts` — build the chain for the active backend from 001's selection, constructing each of the four effects independently so one that cannot run on that backend is disabled and listed in `window.__diag.post.fallbacks` while the scene and the remaining effects still render (FR-014, FR-016, US4-S3, US4-S7, US4-S8).
- [ ] T045 [US4] In `src/post/chain.ts`, resize every render target within one frame of a viewport change and dispose targets on toggle-off, so 100 on/off cycles return the target count to its baseline and a toggle is not a slow memory leak (FR-015, US4-S9, Edge Cases).
- [ ] T046 [US4] Implement `src/post/diag.ts` — declare and attach `window.__diag.post` with each effect's enabled state, `frameCostMs` and `fallbacks`, augmenting 001's `Diagnostics` interface by module augmentation from this file rather than editing the shared diagnostics module (FR-018, US4-S1, US4-S4).
- [ ] T047 [US4] Implement `src/systems/post/register.ts` — build the chain at setup, bind the four declared runtime toggles so a flip takes effect without a page reload, forward viewport resizes to `src/post/chain.ts`, keep 007's HUD and US2's stats screen composited above the effects, and publish `__diag.post` and `__diag.drawCalls` each frame (FR-014, FR-015, FR-018, US4-S2, US4-S9, US4-S10).
- [ ] T048 [US4] Add `tools/smoke-checks/post.mjs` — assert the four effects and their defaults are listed, toggle each on and off and assert after all eight toggles that a frame still renders with `__diag.ready` true and `__diag.errors` empty, assert measured brightness around a muzzle flash exceeds the same region with bloom disabled, assert `__diag.fps` clears 001's declared harness floor with all four disabled, and assert `__diag.post.frameCostMs` is reported as a number with all four enabled (FR-015, FR-017, US4-S3, US4-S5, US4-S6, SC-006, SC-007).
- [ ] T049 [US4] Append one line per disabled effect to `DECISIONS.md`, at the end of the append-only log and in the form T037 established, naming the effect, the backend it could not run on and its one-clause rationale, matching the entry `src/post/chain.ts` records in `__diag.post.fallbacks` (FR-016, US4-S8, SC-008).

**Checkpoint**: All four gates green. The level can be finished, read, heard and — where
the backend allows it — seen with effects. Everything traded away is one line in
`DECISIONS.md`.

---

## Dependencies & Execution Order

### User Story Dependencies

Strictly sequential, as declared in the spec's `## Work Graph` block and compiled into
`workgraph.json`:

- **US1** — no dependencies within this spec. Creates the run state every later story reads.
- **US2** — depends on US1. There is no completion to report until the run can reach one,
  and `__diag.run.state` is US1's value.
- **US3** — depends on US2. Its smoke check runs through the discovery hook US2 adds to
  `tools/smoke.mjs`, and its fallback convention is the one US2's completion path made
  observable.
- **US4** — depends on US3. It composites above US2's stats screen, measures bloom against
  007's muzzle flash on a finished run, and adds its check to the same discovery hook.

US1 and US2 are the milestone's DONE condition — "level completable start to finish". US3
and US4 are refinements over a game that is already complete, and each carries an explicit
fallback so it can be reduced to nothing without taking the milestone with it.

### Cross-spec prerequisites

`depends_on_landed: ["007-combat-hud"]`. This spec builds on 002's `E` tile and validated
level, 003's player, 004's interact command path and door and secret counters, 006's
pathing, and 007's weapons, health, restart and glyph table — all of which 007 already
depends on transitively as the last landed milestone in the chain.

### Shared files (genuine contention, handled by the ordering above)

- `src/run/state.ts` — created in T005 (US1), amended in T011 (US1). US2 never edits it:
  T005 makes `step()` return its transition so `src/run/completions.ts` can observe
  `complete` from outside.
- `src/systems/stats-screen/register.ts` — created in T019 (US2), extended in T020 and
  T021 (US2). No other story touches it.
- `src/post/chain.ts` — created in T044 (US4), extended in T045 (US4).
- `tools/smoke.mjs` — extended once, in T022 (US2), with a discovery hook. US3's T036 and
  US4's T048 add files under `tools/smoke-checks/` and edit `smoke.mjs` never.
- `src/diag/diag.ts` — **edited by no task in this spec.** Each story's diagnostics slice
  lives in its own `diag.ts` (T018, T033, T046) and augments the `Diagnostics` interface
  from there; see plan.md's Structure Decision.
- `src/main.ts` — **one line, one task, one story**: T043 (US4) routes the render call
  through `src/post/render-hook.ts`. No other task in this spec touches the bootstrap.
- `DECISIONS.md` — appended by T037 (US3) and T049 (US4). The file is append-only by
  Article VIII and each task writes its own new line at the end of the file, so the two
  appends address disjoint regions and neither rewrites the other's entry.

### Parallel Opportunities

Within a story only, on the tasks marked [P]: T001–T004 in US1, then T006/T007/T008 once
T005 lands; T012–T014 and then T016/T017 in US2; T024–T027 and then T029/T030/T031 in US3;
T038/T039 and then T041 in US4. Nothing crosses a story boundary.

## Notes

- Test-first is mandatory for anything DOM-free and three.js-free (Article III). Run state,
  elevator resolution, gating, completability, stats, rating, completions, sound synthesis,
  the voice pool, triggers, post state and cost sampling are all in that set. WebAudio glue,
  the post chain and the composited screens are verified through `__diag` by the smoke
  harness instead.
- Never weaken a gate to make it pass. A failing gate blocks the commit, not the gate — and
  in this spec that has a specific edge: a silent sound and a disabled effect are legitimate
  outcomes with a recorded fallback, but a narrowed smoke assertion is not.
- A fallback is only a fallback when it is written down twice: one line in `DECISIONS.md`
  and one entry in the matching `fallbacks` array (SC-008).
- Commit once per task (ergane's inner loop; Article VII).
- No source file over 400 lines (Article IV); split as part of the task that would exceed it.
