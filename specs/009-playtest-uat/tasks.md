---
description: "Task list for 009-playtest-uat: Recorded Playthrough as a UAT Artifact"
---

# Tasks: Recorded Playthrough as a UAT Artifact

**Input**: Design documents from `/specs/009-playtest-uat/`

**Prerequisites**: plan.md (required), spec.md (required for user stories)

**Tests**: Included, for the half of this spec that is DOM-free. Objective derivation and
ordering, verdict computation, timeline offset arithmetic and report rendering are pure
functions and get failing tests first under Article III. The browser-driving half is
verified by running the command: it either played the level or it did not, and the
recording is the evidence.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to
- Exact file paths are given in every description

## Path Conventions

Single project. Everything this spec adds lives under `tools/` and `tests/unit/`; **no file
under `src/` is created or edited by any task here**, which is the spec's defining property
and not an accident of scoping. `tools/**/*.mjs` and `tools/**/*.ts` are already inside
`tsconfig.json`'s include, so `npm run typecheck` covers the runner without configuration.

---

## Phase 1: User Story 1 - The playthrough runner (Priority: P1) 🎯 MVP

**Goal**: One command builds the page, opens a real browser on the host display, and an
agent walks the level to the elevator using only the input events the game already binds.

**Independent Test**: Invoke the command on a host with a display and assert it exits zero
with `__diag.run.state === 'complete'` and `__diag.player.pointerLocked` true; invoke it
with no display and assert it refuses by name and exits non-zero.

### Implementation for User Story 1

- [x] T001 [US1] Extract the loopback static server over `dist/` and `resolveBrowser()` out of `tools/smoke.mjs` into a new `tools/serve.mjs`, and edit `tools/smoke.mjs` to import them rather than declare them. Behaviour must not change: `npm run smoke` passes before and after, and the browser-discovery rules 008 T022 established (`CHROME_PATH`, then a walk of every `chromium*` build under `PLAYWRIGHT_BROWSERS_PATH`, never downloading, never skipping) are moved verbatim so the two harnesses cannot drift (FR-001, plan.md Structure Decision).
- [x] T002 [P] [US1] Create `tools/play/nav-entry.ts` re-exporting only what the runner routes with — `LEVEL_GRID`, `PLAYER_SPAWN`, `TILE_SIZE`, `ENEMY_SPAWNS`, `ITEM_SPAWNS`, `DOOR_LOCKS` from `src/level.ts`; `findPath` and `isUnreachable` from `src/enemy/pathing.ts`; `openableTiles` from `src/run/completable.ts`; `findExitTile` from `src/run/elevator.ts`; `tileKey` from `src/player/tiles.ts`. It declares nothing of its own. Its whole import graph is DOM-free and three.js-free, which is what makes it compilable in isolation (FR-004, FR-006).
- [x] T003 [US1] In `tools/play/navigate.mjs`, compile `tools/play/nav-entry.ts` to one ESM file with the `esbuild` already present under `node_modules`, into a temporary location, and import it. Compile once per invocation and reuse it; a compile failure aborts the invocation naming the entry rather than falling back to a second pathfinder (FR-004, plan.md Complexity Tracking).
- [x] T004 [US1] Implement pointer lock and frame pacing in `tools/play/driver.mjs`: click the game canvas to request the lock, confirm `__diag.player.pointerLocked` is true before returning, and provide the primitive every later command is issued against — spend N of the page's own animation frames, or spend frames until a predicate over `window.__diag` holds or a declared bound expires. A lock that is refused or later revoked is raised as a harness fault, never as a gameplay result (FR-002, FR-003, US1-S3, Edge Cases).
- [x] T005 [US1] Extend `tools/play/driver.mjs` with the input vocabulary, each command issued as the DOM event the game already binds and each spanning rendered frames: hold and release the movement codes `src/player/keyboard.ts` binds; turn the camera by mouse movement under the lock, converting a desired yaw delta to a pixel delta through a sensitivity measured once at startup rather than assumed; issue the interact command through a code `src/interaction/bindings.ts` binds; press and release the fire button; select a weapon by its digit code. `window.__playerDrive` is never called (FR-002, US1-S4).
- [x] T006 [US1] Implement `walkLeg` in `tools/play/navigate.mjs`: ask the compiled `findPath` for a route from the player's current tile to a target tile over `LEVEL_GRID` and the live open-tile state read from `__diag`, then walk it with the driver — turn toward the next waypoint, hold forward, watch `__diag.player.x/z` advance, and stop on arrival within a declared radius. A route reported unreachable, or a leg whose bound expires with the player not advancing, fails the attempt naming the leg and the position it stopped at (FR-003, FR-004, US1-S5, US1-S6, Edge Cases).
- [x] T007 [US1] Implement `tools/play.mjs`: parse arguments, refuse with a named message and a non-zero exit when no display is available, run `npm run build` as `tools/smoke.mjs:59` already does, start the server from `tools/serve.mjs`, launch Chromium **headed** at a declared viewport, wait for `__diag.ready`, acquire the lock, walk to the level's single exit tile, issue the interact command, and wait for `__diag.run.state === 'complete'`. Orchestration only: it holds no knowledge of the level (FR-001, FR-005, US1-S1, US1-S2, US1-S7).
- [x] T008 [P] [US1] Add the `play` script to `package.json` pointing at `tools/play.mjs`, beside `smoke`. It is added to `package.json` and to **nothing else**: `ergane.yaml` must not learn about it, because a headed command cannot run in the bwrap runtime and must never become a required check (FR-001, Constitution III).
- [x] T009 [US1] Exclude the output directory twice: add it plus `*.webm` and `*.mp4` to `.gitignore`, and add the directory to the skip list in `tools/check-no-binaries.mjs` beside `node_modules`, `dist` and `.git`. Do **not** add video extensions to that file's forbidden list — that would fail the smoke gate on the runner's own output. Prove it: populate the directory and run `npm run smoke`, which must pass, and `git status`, which must report clean (FR-005, US1-S8, SC-007).
- [x] T010 [P] [US1] Append one line to `DECISIONS.md` for each fork this story decides that spec.md left open — how the look sensitivity is calibrated rather than assumed, the bound a leg is given before it is declared stuck, and the radius at which arrival at a tile is accepted. The headed-only, real-input, build-output, two-tier-verdict, retry-budget and single-directory decisions already landed with the spec as `operator` lines; do not restate them (Article VIII).
- [x] T011 [P] [US1] Add a section to `README.md` beside "Checking it" describing what `npm run play` does, what it writes, and that it requires a display and is deliberately not a gate.

**Checkpoint**: The level can be watched being beaten. Nothing is recorded and nothing is
scored yet.

---

## Phase 2: User Story 2 - The full-completion objective set (Priority: P1)

**Goal**: The agent clears the level rather than crossing it — every guard, secret,
treasure and key — with the objective set derived from the level's own tables.

**Independent Test**: Complete a run and assert the objective set contains one objective per
enemy marker, per secret tile and per treasure entry, with no count written into the runner,
and that each was confirmed against the counter that owns it.

### Tests for User Story 2

> Write these first and confirm they fail before implementing.

- [ ] T012 [P] [US2] `tests/unit/play-objectives.test.ts`: against the shipped `src/level.ts`, the derived objective set contains exactly one guard objective per `ENEMY_SPAWNS` marker, one secret objective per `S` tile of `LEVEL_GRID`, one treasure objective per `treasure` entry of `ITEM_SPAWNS` and one exit objective; adding a marker to a fixture grid adds exactly one objective; and no count appears as a literal in the module under test (FR-006, US2-S1, US2-S2, SC-004).
- [ ] T013 [P] [US2] `tests/unit/play-objectives.test.ts` (ordering cases): for every locked entry in `DOOR_LOCKS`, the objective collecting the key that entry names precedes any objective whose route passes through that door; and a health or ammunition objective is inserted when the corresponding declared threshold is crossed (FR-008, FR-009, US2-S7, US2-S9).

### Implementation for User Story 2

- [ ] T014 [US2] Implement derivation in `tools/play/objectives.mjs` — read the level tables through the module `tools/play/nav-entry.ts` already compiles and emit one objective per guard marker, secret tile, treasure entry and the exit, each carrying its tile and the `__diag` counter that confirms it. Pure: no page, no browser, so T012 tests it directly (FR-006, US2-S1, US2-S2).
- [ ] T015 [US2] Implement ordering in `tools/play/objectives.mjs` — key objectives ahead of any objective routed through the door their `DOOR_LOCKS` entry names, and the health and ammunition thresholds declared in one place at the top of the file with the pickup objectives they insert (FR-008, FR-009, US2-S7, US2-S9).
- [ ] T016 [US2] Implement `tools/play/combat.mjs` — engage one guard: read its position from `__diag.enemies`, turn the camera to its bearing through the driver's look command, select a weapon holding ammunition through its digit binding if the current one is empty, press and release fire, and confirm the kill by `__diag.combat.kills` rising. Never issue a fire command while `__diag.run.state` is not `playing` (FR-007, US2-S3, US2-S4, US2-S5).
- [ ] T017 [US2] Drive the ordered objective set from `tools/play.mjs`: for each objective, walk its leg and then complete it — a guard through `tools/play/combat.mjs`, a secret, key or treasure through the interact command or by standing on the tile, each confirmed against its own counter. A refused interaction records `__diag.interaction.lastReason` and fails the objective by name rather than being retried blindly against the same tile (FR-007, FR-008, US2-S6, US2-S8, Edge Cases).

**Checkpoint**: The agent clears the level. Nothing is recorded and nothing is scored yet.

---

## Phase 3: User Story 3 - Recording and timeline (Priority: P1)

**Goal**: Every attempt leaves a video and an index into it.

**Independent Test**: Complete an invocation and assert a video exists for every attempt
including failed ones, that every objective, transition and fault carries a millisecond
offset from that attempt's recording start, and that console messages and uncaught page
errors are captured per attempt with their offsets.

### Tests for User Story 3

> Write this first and confirm it fails before implementing.

- [ ] T018 [P] [US3] `tests/unit/play-timeline.test.ts`: an event appended to a timeline carries its offset from that attempt's recording start rather than from process start or from the previous event; events are ordered by offset; and a timeline of an attempt that failed before its first objective is empty rather than absent (FR-011).

### Implementation for User Story 3

- [ ] T019 [US3] Record video per attempt in `tools/play.mjs` by giving each attempt its own browser context configured to record at the declared viewport, opened before the first input command and closed after the stats screen is composited or the attempt fails — a failed attempt's recording is finalized and kept, since a failed attempt with no video is the one outcome that teaches nothing (FR-010, US3-S1, US3-S2, Edge Cases).
- [ ] T020 [US3] Implement `tools/play/record.mjs` — the timeline: an append-only list of objectives completed, run state transitions and faults, each stamped with its offset in milliseconds from the moment that attempt's recording started, so any reported event is found in the video by seeking to its offset (FR-011, US3-S3, US3-S4).
- [ ] T021 [US3] Capture every console message and every uncaught page error per attempt in `tools/play/record.mjs`, each with its timeline offset, and write them beside that attempt's recording. This is also the source the hard criteria in US4 read for "recorded an error" (FR-012, US3-S5).

**Checkpoint**: Every attempt is watchable and indexed. Nothing is scored yet.

---

## Phase 4: User Story 4 - The playtest record and its verdict (Priority: P1)

**Goal**: The command is a test — it decides pass or fail on declared grounds, writes both
records, and never leaves a half-written directory that reads as a result.

**Independent Test**: Invoke the command and assert the output directory holds the
machine-readable result and the human-readable report, that the verdict follows the declared
hard and soft criteria, that the exit code follows the hard criteria alone, and that an
interrupted invocation leaves no directory that reads as completed.

### Tests for User Story 4

> Write these first and confirm they fail before implementing.

- [ ] T022 [P] [US4] `tests/unit/play-verdict.test.ts`: an attempt reaching `complete` with no recorded error and no uncaught page error passes whatever its completion percentages; an attempt that did not reach `complete`, or that recorded either kind of error, fails; a shortfall on any completion percentage is reported and spends no further attempt; and the exit code is non-zero exactly when no attempt satisfied every hard criterion (FR-016, US4-S5, US4-S6, US4-S7, US4-S8).
- [ ] T023 [P] [US4] `tests/unit/play-report.test.ts`: the rendered report names the verdict, each criterion with its measured value, and the timeline with its offsets; and a verdict reached on other than the first attempt states the number of attempts used in the verdict line itself (FR-015, US4-S4, US4-S9).

### Implementation for User Story 4

- [ ] T024 [US4] Implement the criteria and the verdict in `tools/play/verdict.mjs` — hard: reached `complete`, an empty `__diag.errors`, no uncaught page error; soft: kill, secret and treasure percentages, the rating, the frame rate and the duration. Pure functions of measured values, so T022 tests them without a browser (FR-016, US4-S5, US4-S6, US4-S7).
- [ ] T025 [US4] Render the machine-readable result in `tools/play/verdict.mjs` — the verdict, the attempts used, every hard and soft criterion with its measured value, the final `__diag.run`, `__diag.combat` and `__diag.interaction` figures, the lines `window.__run.lines()` composited, the commit the build came from and whether the working tree was dirty, and the browser and renderer used. The frame rate reported is the game's own `__diag.fps`, labelled so it is never read as the recording's frame rate (FR-014, US4-S3).
- [ ] T026 [US4] Render the human-readable report in `tools/play/verdict.mjs` — the verdict, the attempts used, each criterion with its value, and the timeline with its offsets (FR-015, US4-S4).
- [ ] T027 [US4] Implement the attempt loop in `tools/play.mjs`: retry only on a hard failure or a harness fault, to a declared maximum of three; a soft shortfall spends no attempt. Exit non-zero when no attempt satisfied every hard criterion, and carry the attempt count into the verdict itself so a pass that took three tries never reads as a pass that took one (FR-016, US4-S6, US4-S7, US4-S8, US4-S9).
- [ ] T028 [US4] Assemble the record in a temporary directory and move it into place as the last act of the invocation, replacing any previous invocation's directory rather than merging with it, so an interrupted run leaves nothing that reads as a completed result (FR-013, US4-S1, US4-S2, SC-008).
- [ ] T029 [P] [US4] Update the build-state paragraph in `specs/README.md` to record that 009 has landed and what it ships. The table row itself landed with the spec, as did the note that this is the first spec no gate executes; this task reports the outcome, which is the half that can only be written once it is true.

**Checkpoint**: `npm run play` is a UAT. It plays, records, scores and reports.

---

## Dependencies

### Story completion order

`US1 → { US2, US3 } → US4`, exactly as spec.md's `## Work Graph` declares. US1 is the
foundation and carries every browser unknown. US2 and US3 touch disjoint files and depend
only on US1, so they may be dispatched concurrently. US4 reports on what all three produce.

### Cross-spec prerequisites

`depends_on_landed: ["008-polish"]`. This spec drives 003's player and input adapters, 004's
interact path and counters, 006's pathing and guard roster, 007's weapons and health, and
008's elevator, run diagnostics and stats screen — the last of which is the newest and is
what `__diag.run` and `window.__run.lines()` come from.

### Shared files (genuine contention, handled by the ordering above)

- `tools/smoke.mjs` — edited by exactly one task, T001 (US1), which removes code rather than
  adding it. No other task in this spec touches the gate.
- `tools/play.mjs` — created in T007 (US1), extended in T017 (US2), T019 (US3) and T027/T028
  (US4). It is the one genuinely shared file, which is why every extension to it is the last
  task of its story.
- `tools/play/driver.mjs` — created in T004 (US1), extended in T005 (US1). No other story
  edits it; US2's combat consumes it.
- `tools/play/navigate.mjs` — created in T003 (US1), extended in T006 (US1).
- `tools/play/objectives.mjs` — created in T014 (US2), extended in T015 (US2).
- `tools/play/verdict.mjs` — created in T024 (US4), extended in T025 and T026 (US4).
- `tests/unit/play-objectives.test.ts` — written by T012 and extended by T013, both US2.
- `DECISIONS.md` — appended by T010 (US1) only. Append-only by Article VIII.
- **`src/` — edited by no task in this spec.** See plan.md's Structure Decision: the
  measurements in spec.md's Clarifications exist to justify not adding a seam here.

### Parallel Opportunities

Within a story only, on the tasks marked [P]: T002 alongside T001, then T008/T010/T011 once
T007 lands; T012 and T013 together in US2; T018 alone in US3; T022 and T023 together, then
T029 in US4. Nothing crosses a story boundary.

## Notes

- Test-first is mandatory for anything DOM-free (Article III). In this spec that is
  objective derivation and ordering, the verdict, the timeline and the report — everything
  that decides, as opposed to everything that drives.
- Never weaken a gate to make it pass. This spec has a specific temptation: it must never
  become a substitute for `npm run smoke`, and T009 must not silence the binary-asset walker
  by any means other than excluding the output directory the way `dist/` is excluded.
- The command drives real input and adds no seam under `src/`. A task that finds itself
  wanting a `window.__playerLook` has taken a wrong turn — the measurements in spec.md's
  Clarifications show the real path works.
- Commit once per task (ergane's inner loop; Article VII).
- No source file over 400 lines (Article IV); split as part of the task that would exceed it.
