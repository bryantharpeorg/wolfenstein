---
description: "Task list for 010-crosshair: Crosshair, Spread Feedback and Hit Confirmation"
---

# Tasks: Crosshair, Spread Feedback and Hit Confirmation

**Input**: Design documents from `/specs/010-crosshair/`

**Prerequisites**: plan.md (required), spec.md (required for user stories)

**Tests**: Included, and mandatory for almost all of it. Every decision this spec makes —
reticle geometry, resting gap from a weapon, gap evolution over elapsed seconds, mark
precedence — is a pure function of declared inputs and gets a failing test first under
Article III. Only compositing and draw-call accounting need a browser, and those are read
back from `__diag` by a discovered smoke check.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to
- Exact file paths are given in every description

## Path Conventions

Single project. Six new modules under `src/hud/`, one new system under
`src/systems/crosshair/`, three test files under `tests/unit/`, one smoke check and one
addition to `009`'s runner under `tools/`. `001`'s glob discovery
(`src/boot/discover.ts:12`) finds `src/systems/*/register.ts` at build time, so **no task in
this spec edits `main.ts`, `diag.ts`, `registry.ts` or any other shared boot file**. The
smoke-check runner discovers `tools/smoke-checks/*.mjs` the same way, so that file needs no
wiring either.

---

## Phase 1: User Story 1 - A reticle at the centre of the screen (Priority: P1) 🎯 MVP

**Goal**: A reticle is drawn at the centre of the viewport, from code-defined strokes, on
its own quad, over the post chain, publishing its state — and the draw-call budget still
holds.

**Independent Test**: `npm run test` asserts the geometry module returns four symmetric
strokes for a declared gap with no DOM and no three.js imported; `npm run smoke` asserts
`__diag.crosshair` is published with `hidden` false and `__diag.drawCalls` below 20.

### Tests for User Story 1

- [ ] T001 [P] [US1] `tests/unit/crosshair.test.ts`: for a declared gap and arm length the
  stroke set is exactly four segments, symmetric about the origin in both axes, each
  beginning at the gap and extending outward by the arm length; a zero gap and a zero-height
  viewport each produce finite coordinates and no `NaN`; and the module's import graph
  contains neither `three` nor a DOM API (FR-001, FR-002, US1-S1, US1-S2, Edge Cases).

### Implementation for User Story 1

- [ ] T002 [US1] Create `src/hud/crosshair.ts` — the pure geometry: a gap, an arm length and
  a viewport in, four stroke segments out, as plain numbers. It imports nothing from `three`
  and touches no DOM, which is what lets T001 test it directly. Every mark is a stroke,
  never an image, font or glyph table (FR-001, FR-002, US1-S1, US1-S2).
- [ ] T003 [US1] Create `src/hud/crosshair-constants.ts` holding every tuning value this
  spec introduces — arm length in pixels, stroke weight, colour, the scale applied to the
  weapon's spread to produce a resting gap, the movement-opening ceiling, the per-shot
  recoil amount, the decay and settle times, and the hit and kill mark durations — so
  retuning the reticle is one edit in one file. This task **decides** the forks spec.md left
  open; each value gets a line in `DECISIONS.md` under T009 (FR-007, FR-008, FR-009, FR-010,
  Article VIII, plan.md Complexity Tracking).
- [ ] T004 [US1] Create `src/hud/crosshair-diag.ts` — the `CrosshairDiagnostics` interface
  (at minimum the current gap, the `hidden` flag and whether the sources it reads are
  defined), the field-list constant the smoke harness checks the published object against,
  and the module augmentation adding `crosshair?` to `Diagnostics`. Additive over the
  `001`–`009` contract: no existing field is renamed, removed or repurposed. Follows the
  `src/combat/combat-diag.ts` shape (FR-005, US1-S6).
- [ ] T005 [US1] Create `src/systems/crosshair/register.ts` at **order 92** — after the HUD
  at 90 so it composites the same frame's values, before the stats screen at 95. It builds
  one `CanvasTexture` on one `PlaneGeometry` quad, centres it, sizes it from the camera FOV
  so the arms stay a constant pixel length across resizes and aspect changes, draws the
  strokes from `crosshair.ts`, sets its render order at or above `HUD_RENDER_ORDER` so
  `008`'s chain composites it over rather than through, and publishes the diagnostics from
  `crosshair-diag.ts`. Discovery is by glob, so no shared file is edited (FR-003, FR-004,
  FR-005, US1-S3, US1-S4, US1-S5).
- [ ] T006 [US1] Recompute the stroke set into a buffer the system reuses rather than
  allocating per frame — this runs every frame at order 92, and `005` established
  per-frame derivation cost as the axis that matters on this project (FR-006, plan.md
  Performance Goals).
- [ ] T007 [US1] Create `tools/smoke-checks/crosshair.mjs` with its first assertions only:
  `__diag.crosshair` is published carrying every field `crosshair-diag.ts` declares, and
  `__diag.drawCalls` is below 20 with the crosshair, HUD, view-model, muzzle flash and post
  chain all rendering. Discovered by the runner, so nothing is wired. It fails non-zero
  naming the condition. US4 extends this file; it is created here because US1 is the story
  that spends the draw call (FR-006, US1-S7, SC-005).
- [ ] T008 [P] [US1] Add a section to `README.md` beside the existing HUD description noting
  that the crosshair is drawn from code, reacts to weapon and motion, and can be toggled.
- [ ] T009 [P] [US1] Append one line to `DECISIONS.md` for each fork T003 decides — the gap
  scale, the movement ceiling, the recoil amount, the decay and settle times, the mark
  durations, the arm length and the colour. The reacting-not-static, derived-not-authored,
  own-quad, over-the-post-chain, toggle-only and soft-criteria decisions already landed with
  the spec as `operator` lines; do not restate them (Article VIII).

**Checkpoint**: A reticle is on screen and the budget holds.

---

## Phase 2: User Story 2 - A gap that reads the weapon and the motion (Priority: P1)

**Goal**: The gap is the active weapon's own declared spread, opened by movement and by
each shot, settling when the player stands still.

**Independent Test**: `npm run test` drives the spread stepper with values read from `007`'s
weapon table and asserts the ordering, the monotonic movement response, the recoil decay,
the settle tolerance and the 1 ms/250 ms equivalence — no page, no browser.

### Tests for User Story 2

- [ ] T010 [P] [US2] `tests/unit/crosshair-spread.test.ts`: the three resting gaps order
  strictly pistol < SMG < chaingun, asserted against values read from `007`'s
  `WEAPON_TABLE` rather than restated; the gap increases monotonically with player speed and
  never exceeds the declared ceiling; a shot adds the declared recoil on that frame and
  decays afterward; and after the declared settle time with no movement and no fire the gap
  is within tolerance of the resting gap (FR-007, FR-008, FR-009, FR-010, US2-S1, US2-S3,
  US2-S4, US2-S5, SC-002).
- [ ] T011 [P] [US2] `tests/unit/crosshair-spread.test.ts` (frame-rate cases): the same
  sequence of speeds and shot timings stepped at 1 ms deltas and at 250 ms deltas produces
  gaps differing by at most the declared tolerance; and a weapon switch moves the gap toward
  the new resting value rather than snapping to it (FR-010, US2-S6, US2-S7, SC-004).

### Implementation for User Story 2

- [ ] T012 [US2] Create `src/hud/crosshair-spread.ts` — the pure stepper: active weapon,
  player speed, shots-fired counter and elapsed seconds in, the next gap out. The resting
  gap is derived from `weaponFor(kind).maxSpreadRadians` through `007`'s own accessor and
  scaled by the constant T003 declared. **No value from `WEAPON_TABLE` may appear as a
  literal here** — `weapons.test.ts` already scans every importer for one, and this module
  must survive that scan (FR-007, FR-008, US2-S1, US2-S2, SC-003).
- [ ] T013 [US2] Extend `src/hud/crosshair-spread.ts` with the recoil and decay terms: each
  rise in the shots-fired counter adds the declared recoil, which decays smoothly toward the
  resting gap over elapsed seconds — never over frames, the rule `004` fixed for doors and
  `007` for fire rate (FR-009, FR-010, US2-S4, US2-S6).
- [ ] T014 [US2] Drive the stepper from `src/systems/crosshair/register.ts`: read the active
  weapon and shot counter from `__diag.combat` and the speed from `__diag.player`, step the
  gap by the frame's elapsed seconds, pass the result to the geometry, and publish the
  current gap in `__diag.crosshair`. When `__diag.combat` has not published yet, draw at the
  resting gap rather than throwing, and report the sources as undefined (FR-007, FR-008,
  FR-009, US2-S3, US2-S7, Edge Cases).

**Checkpoint**: The reticle breathes with the weapon and the player's motion.

---

## Phase 3: User Story 3 - Hit and kill confirmation (Priority: P2)

**Goal**: A mark appears the frame a shot connects, a distinct one when it kills, and
neither appears when the run is not being played.

**Independent Test**: `npm run test` drives the mark state machine with rising and static
counters and a run state, asserting which mark is active, that a kill outranks a hit on the
same frame, that it decays, and that death clears it.

### Tests for User Story 3

- [ ] T015 [P] [US3] `tests/unit/crosshair-feedback.test.ts`: a rising `hits` counter
  ignites a hit mark and a rising `kills` counter a kill mark; both rising on one frame
  yields the kill mark alone, never both; a counter rising by more than one in a frame
  ignites exactly one mark; a static counter ignites nothing; the mark decays to `none`
  within its declared duration; and a run state other than `playing`, or a dead player,
  ignites nothing and clears an active mark (FR-011, FR-012, FR-013, US3-S1, US3-S2, US3-S3,
  US3-S4, US3-S5, US3-S6, SC-009).

### Implementation for User Story 3

- [ ] T016 [US3] Create `src/hud/crosshair-feedback.ts` — the pure mark state machine:
  previous and current `hits` and `kills`, the run state, the dead flag and elapsed seconds
  in, one `FeedbackMark` out. Ignition is a counter **rising**, the shape `007`'s muzzle
  flash already uses against `shotsFired`, so a held trigger against a wall lights nothing
  (FR-011, FR-012, FR-013, US3-S1, US3-S2, US3-S5).
- [ ] T017 [US3] Add the two marks to `src/hud/crosshair.ts` as stroke sets distinct in
  shape rather than in brightness — a kill must not read as a bright hit — drawn from code
  like the reticle itself (FR-012, US3-S2, SC-007).
- [ ] T018 [US3] Drive the state machine from `src/systems/crosshair/register.ts`: hold the
  previous counters, step the mark each frame, draw it with the reticle, clear it on the
  frame the run stops being `playing` or the player dies, and reset it and the gap on
  `007`'s restart by registering with `registerResettable()` as the HUD already does
  (FR-013, US3-S6, US3-S7).

**Checkpoint**: The player can tell a hit from a miss without reading the score.

---

## Phase 4: User Story 4 - Toggling it off, and proving all of it (Priority: P2)

**Goal**: One key hides and shows the reticle, the preference survives a restart, and all of
it is asserted by a gate and observed in a real playthrough.

**Independent Test**: `npm run test` asserts the binding table resolves the declared key and
nothing else; `npm run smoke` runs the completed crosshair check; `npm run play` reports the
three crosshair observations in its record.

### Tests for User Story 4

- [ ] T019 [P] [US4] `tests/unit/crosshair.test.ts` (binding cases): the declared toggle key
  resolves to the toggle command and no other code does; the key collides with neither
  `004`'s `Space`/`KeyE` interact bindings nor `007`'s `Digit1`–`Digit3` weapon selects; and
  toggling twice returns to the original state (FR-014, US4-S1, US4-S2, US4-S5).

### Implementation for User Story 4

- [ ] T020 [US4] Create `src/hud/crosshair-bindings.ts` declaring the toggle key in one
  table, in the shape `src/interaction/bindings.ts` already uses — a code set and a
  structural `commandFor…` resolver, so a test needs no `KeyboardEvent`. Choose a key that
  collides with nothing `004` or `007` binds (FR-014, US4-S5).
- [ ] T021 [US4] Bind it in `src/systems/crosshair/register.ts`: the key toggles `hidden` in
  both directions, the flag is published in `__diag.crosshair`, and when hidden the quad is
  removed from the scene — not drawn transparent — so the draw-call count is no higher than
  when shown. The flag is deliberately **not** registered with `registerResettable()`: a
  display preference is not run state and must survive `007`'s restart (FR-014, FR-015,
  US4-S1, US4-S2, US4-S3, US4-S4).
- [ ] T022 [US4] Extend `tools/smoke-checks/crosshair.mjs` with the rest of FR-016: the
  resting-gap ordering across the three weapons, the gap's response to movement, the toggle
  hiding the reticle, and the draw-call count with it hidden being no higher than with it
  shown. Each condition is named on failure and exits non-zero (FR-016, US4-S6, SC-006).
- [ ] T023 [US4] Create `tools/play/crosshair.mjs` and call it from `tools/play.mjs`: read
  `__diag.crosshair` during the playthrough and report three observations — the crosshair
  was present, its gap differed between standing still and moving, and whether a hit mark
  was seen on a frame `__diag.combat.hits` rose. Report them as **soft** criteria in the
  record; `009` fixed the hard criteria as completion and errors, and a playthrough that
  never shot anything must read as "not observed" rather than as a failure (FR-017, US4-S7,
  US4-S8, SC-008, Edge Cases).
- [ ] T024 [P] [US4] Update `specs/README.md`: add the `010-crosshair` row to the spec table,
  raise the node and FR totals, and record in the build-state paragraph what this spec
  ships. Note in the row that `010` is the first spec answering a play observation rather
  than a milestone of the brief.

**Checkpoint**: Every requirement is covered by a test, a gate, or a recorded playthrough.

---

## Dependencies

### Story completion order

`US1 → US2 → US3 → US4`, exactly as spec.md's `## Work Graph` declares. This is a strict
chain rather than a fan-out: every story after US1 amends `src/systems/crosshair/register.ts`,
so concurrent dispatch would put two nodes in the same file. That is a deliberate trade —
the chain is slower than `009`'s diamond but it is the shape the engine is fastest at, since
each story edits a module the previous one created rather than authoring a new one.

### Cross-spec prerequisites

`depends_on_landed: ["007-combat-hud", "008-polish", "009-playtest-uat"]`. This spec reads
`003`'s player speed, `007`'s weapon table, combat counters, restart hook and HUD render
order, and `008`'s post chain and run state.

**The `009` dependency binds US4 alone, and it is satisfied.** Only `009` US1 is needed —
the runner that drives real input, which T023 extends — and it is on `main`, merged as
PR #52. US2, US3 and US4 of that spec are unbuilt and are *not* required here: T023 needs
the runner, not the objective set, the recorder or the verdict module. All four stories of
this spec can therefore be dispatched in order with no cross-spec wait.

### Shared files (genuine contention, handled by the ordering above)

- `src/systems/crosshair/register.ts` — created in T005 (US1), extended in T006 (US1), T014
  (US2), T018 (US3) and T021 (US4). It is the one genuinely shared file, which is why every
  extension to it is the last implementation task of its story and why the stories are a
  chain rather than a fan-out.
- `src/hud/crosshair.ts` — created in T002 (US1), extended in T017 (US3) for the marks.
- `src/hud/crosshair-spread.ts` — created in T012 (US2), extended in T013 (US2).
- `tools/smoke-checks/crosshair.mjs` — created in T007 (US1), completed in T022 (US4).
- `tests/unit/crosshair.test.ts` — written by T001 (US1), extended by T019 (US4).
- `tools/play.mjs` — edited by exactly one task, T023 (US4). If `009` US2–US4 land first,
  that file will have moved; T023 adds a call and must not restructure it.
- `DECISIONS.md` — appended by T009 (US1) only. Append-only by Article VIII.
- **Not edited by any task in this spec**: `src/main.ts`, `src/diag/diag.ts`,
  `src/boot/registry.ts`, `src/boot/discover.ts`, `src/hud/compose.ts`,
  `src/combat/weapons.ts`, `ergane.yaml`. Discovery is by glob and the weapon table is read,
  never written.

### Parallel Opportunities

Within a story only, on the tasks marked [P]: T001 before T002 in US1, then T008 and T009
alongside each other once T007 lands; T010 and T011 together in US2; T015 alone in US3; T019
and T024 in US4. Nothing crosses a story boundary, because every story ends in the same
file.

## Notes

- Test-first is mandatory for everything DOM-free (Article III). In this spec that is nearly
  all of it: geometry, resting gap, spread evolution and the mark state machine all decide,
  and only `register.ts` draws.
- **Never restate a weapon-table value.** `weapons.test.ts` scans every importer of
  `src/combat/weapons.ts` for a line repeating one of its numbers, and this spec's modules
  import it. A gap that hardcodes `0.012` will fail a gate that already exists, and SC-003
  makes that failure a requirement rather than an accident.
- Never weaken a gate to make it pass. This spec's temptation is the draw-call budget: if
  the count reaches 20, the answer is to draw the reticle more cheaply, never to raise the
  ceiling `002` set and `005`, `007` and `008` each preserved.
- The reticle changes nothing about where bullets go. A task that finds itself editing
  `src/combat/hitscan.ts` or `weapons.ts` has taken a wrong turn.
- Commit once per task (ergane's inner loop; Article VII).
- No source file over 400 lines (Article IV); split as part of the task that would exceed it.
