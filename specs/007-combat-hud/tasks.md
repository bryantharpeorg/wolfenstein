---
description: "Task list for 007-combat-hud: Weapons, Combat Loop and HUD"
---

# Tasks: Weapons, Combat Loop and HUD

**Input**: Design documents from `/specs/007-combat-hud/`

**Prerequisites**: plan.md (required), spec.md (required for user stories)

**Tests**: Included. Constitution Article III requires test-first for DOM-free logic, and
most of this spec — weapon tuning, fire gating, spread, the ray walk, ammo accounting,
damage clamping, the reset, pickup effects, the glyph table — is exactly that. SC-005
requires at least 15 passing assertions and SC-008 requires every declared shot outcome to
be produced by at least one test.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to
- Exact file paths are given in every description

## Path Conventions

Single project. `src/`, `tests/`, `tools/` at repository root, per plan.md.

## `src/main.ts` is not edited by this spec

`001` landed a system registry: `src/boot/registry.ts` collects systems and
`src/boot/discover.ts` finds them with `import.meta.glob('../systems/*/register.ts')`. A
story adds `src/systems/<name>/register.ts` and nothing shared — no wiring line in
`main.ts`, no index to append to. Each of the four stories below adds exactly one system
file. Adding behaviour to `src/main.ts` is the thing that arrangement exists to prevent.

`src/diag/diag.ts` is likewise untouched: `src/combat/combat-diag.ts` augments the
`Diagnostics` interface from inside its own file (T011).

---

## Phase 1: User Story 1 - Three weapons and hitscan resolution (Priority: P1) 🎯 MVP

**Goal**: `1`, `2` and `3` select a pistol, an SMG and a chaingun with strictly ordered
fire rates and spreads; firing traces one ray from the camera centre that stops at the
first wall, closed door or guard, and spends ammo as it goes.

**Independent Test**: Under `npm run test`, import the weapon and hitscan modules with no
DOM and no three.js; assert the ordered table, the delta-independent shot count, the
hand-computed wall distance and the seed-reproducible spread vectors.

### Tests for User Story 1

> Write these first and confirm they fail before implementing.

- [ ] T001 [P] [US1] `tests/unit/combat-purity.test.ts`: assert the import graphs of `src/combat/weapons.ts`, `src/combat/spread.ts`, `src/combat/hitscan.ts` and `src/combat/fire-control.ts` name neither `three` nor any DOM global, and that hitscan takes grid, door state and guard list as arguments rather than reading module-level globals (FR-001, US1-S1).
- [ ] T002 [P] [US1] `tests/unit/weapons.test.ts`: the table from `src/combat/weapons.ts` declares exactly `pistol`, `smg` and `chaingun`, each with fire interval, damage, maximum spread, ammo cost, ammo capacity and maximum range; chaingun interval < smg < pistol and pistol spread < smg < chaingun, both strictly (FR-002, FR-003, US1-S2, US1-S3).
- [ ] T003 [P] [US1] `tests/unit/spread.test.ts`: twenty shots at seed `1234` from `src/combat/spread.ts` produce an array identical to a second run at the same seed, and every vector's angle from camera forward is at or below the weapon's declared maximum (FR-005, US1-S5, SC-004).
- [ ] T004 [P] [US1] `tests/unit/fire-control.test.ts`: one simulated second of held fire stepped as 1 ms deltas and as 250 ms deltas yields shot counts differing by at most one for all three weapons and never exceeding the declared interval's implied count; an insufficient-ammo shot returns `out-of-ammo` with ammo unchanged, never negative, and the interval timer not consumed; both fire bindings pressed on one frame resolve exactly one shot; a weapon switch blocks shots for the declared delay and re-selecting the active weapon costs nothing (FR-004, FR-007, FR-008, US1-S4, US1-S9, US1-S10, US1-S11, SC-003).
- [ ] T005 [P] [US1] `tests/unit/hitscan.test.ts`: `src/combat/hitscan.ts` returns `guard` with index, distance and the weapon's declared damage on a clear line; `wall` with the hand-computed termination distance and zero damage when a wall or closed door intervenes; `none` beyond the declared maximum range; the nearer of two guards on one ray; and a guard in front of a wall reported as `guard`, never `wall` (FR-006, US1-S6, US1-S7, US1-S8, SC-008, Edge Cases).

### Implementation for User Story 1

- [ ] T006 [US1] Implement `src/combat/weapons.ts` exporting the single `WeaponTable` for `pistol`, `smg` and `chaingun` with fire interval, damage, maximum spread angle, ammo cost, ammo capacity and maximum range, ordered so chaingun is strictly faster than smg than pistol and pistol strictly tighter than smg than chaingun; no tuning value may be repeated at a call site (FR-002, FR-003, US1-S2, US1-S3).
- [ ] T007 [P] [US1] Implement `src/combat/spread.ts`: a seeded PRNG in the same shape as `006`'s guard PRNG mapping seed plus shot index to a spread vector bounded by the weapon's declared maximum spread, so a missed shot is reproducible rather than anecdotal (FR-005, US1-S5).
- [ ] T008 [US1] Implement `src/combat/hitscan.ts` exporting `ShotResult` as `{outcome, distance, guardIndex, damage}` and a pure trace that walks the ray cell by cell from the camera centre over `002`'s grid, treating `004`'s closed doors as blocking, testing `006`'s guards by their declared radius, returning exactly one of `guard`, `wall` or `none` and never penetrating past the first blocker — no `three` import, no DOM, every input an argument (FR-001, FR-006, US1-S1, US1-S6, US1-S7, US1-S8).
- [ ] T009 [US1] Implement `src/combat/fire-control.ts`: accumulate elapsed seconds against the active weapon's declared interval, spend the declared ammo cost per shot, return `out-of-ammo` without tracing or consuming the timer when ammo is short, resolve at most one shot per frame from one command path shared by `Ctrl` and the left mouse button, and apply the declared switch delay on `1`/`2`/`3` during which no shot resolves (FR-004, FR-007, FR-008, US1-S4, US1-S9, US1-S10, US1-S11).
- [ ] T010 [US1] Clamp the delta-spike case in `src/combat/fire-control.ts`: a frame long enough to span several fire intervals resolves at most the number of shots the declared interval allows for that elapsed time, spending ammo for each, so one long frame cannot empty a magazine (Edge Cases, FR-004).
- [ ] T011 [P] [US1] Implement `src/combat/combat-diag.ts` declaring the **complete** `CombatDiagnostics` shape FR-018 lists — `weapon`, `ammo` per weapon kind, `health`, `score`, `shotsFired`, `hits`, `kills`, `pickupsCollected`, `pickupsTotal`, `treasureFound`, `treasureTotal`, `dead`, `deaths`, `restarts`, `muzzleFlash`, `hudReady` — with zeroed defaults, plus a `declare module '../diag/diag'` augmentation adding an optional `combat` field so `src/diag/diag.ts` is not edited and US2–US4 populate fields without editing this file (FR-001, US1-S1).
- [ ] T012 [P] [US1] Implement `src/combat/run-state.ts`: the single gate on whether player commands resolve, exported as a getter and a setter, so FR-008's one command path has one place to be closed and US2 can close it on death without editing any file this story owns (FR-008, US1-S10).
- [ ] T013 [US1] Add `src/systems/combat/register.ts` — a new system discovered by `src/boot/discover.ts`, so no shared bootstrap file is edited: attach `combat-diag`'s state to `ctx.diag.combat` in `setup`, bind `Ctrl`, the left mouse button and `1`/`2`/`3` to the one command path, step `fire-control` each frame with the frame delta, trace resolved shots through `hitscan` using the camera's world position and forward vector as the ray origin and direction, and publish `weapon`, `ammo`, `shotsFired`, `hits` and `kills` (FR-006, FR-008, US1-S1, US1-S6, US1-S10).

**Checkpoint**: All four gates green. Firing resolves against real walls and real guards,
and every outcome of FR-006 is produced by a passing test. Nothing takes damage yet.

---

## Phase 2: User Story 2 - Health, death and deterministic restart (Priority: P1)

**Goal**: Guard shots reduce health, zero health ends the run, and restart returns every
piece of run state to its spawn value in place — no page reload, nothing leaked.

**Independent Test**: Snapshot `window.__diag` on the first frame; script the player into
guard fire until health reaches zero; assert the dead state; restart; assert the new
snapshot equals the first field for field except the declared session counters.

### Tests for User Story 2

> Write these first and confirm they fail before implementing.

- [ ] T014 [P] [US2] `tests/unit/vitals.test.ts`: health starts at the single named maximum from `src/combat/vitals.ts`; applying a guard shot's falloff-computed damage decreases health by exactly that amount and clamps at a floor of zero; damage that leaves health above zero keeps the run alive; reaching exactly zero enters `dead` once and `deaths` increments exactly once no matter how many further shots resolve; score from `src/combat/score.ts` rises on a kill and never decreases within a run (FR-009, FR-010, FR-012, US2-S1, US2-S2, US2-S3, US2-S5, US2-S10).
- [ ] T015 [P] [US2] `tests/unit/restart.test.ts`: `resetRun()` in `src/combat/restart.ts` runs every registered resettable; a snapshot taken before it deep-equals the snapshot taken after, field for field, except the exported exempt set; a second `resetRun()` issued immediately is idempotent and increments `restarts` exactly once per completed reset; restart from an alive run performs the same full reset (FR-011, US2-S6, US2-S7, US2-S8, US2-S9, SC-002, Edge Cases).

### Implementation for User Story 2

- [ ] T016 [US2] Implement `src/combat/vitals.ts` owning `PlayerVitals` — the starting health maximum as one named constant declared in this file and nowhere else, damage application clamped to a floor of zero, and the one-way transition into a declared `dead` state that increments `deaths` exactly once (FR-009, FR-010, US2-S1, US2-S2, US2-S5).
- [ ] T017 [P] [US2] Implement `src/combat/score.ts` exporting the single `ScoreTable` — points for a guard kill and for each treasure kind — and an accumulator that never decreases within a run and returns to zero on reset (FR-012, US2-S10).
- [ ] T018 [US2] Implement `src/combat/restart.ts`: `registerResettable(name, fn)` and `resetRun()` so a story can make its own state resettable without this file knowing what that state is; `snapshotRunState()` returning the comparable field set; and the restart-exempt set (`deaths`, `restarts`, elapsed wall-clock) exported as one named constant that `008` extends in one place rather than at every comparison site (FR-011, US2-S8, US2-S9, spec Assumptions).
- [ ] T019 [US2] Make restart idempotent in `src/combat/restart.ts`: a second command issued in quick succession performs no second reset mid-frame, and `restarts` increments once per completed reset (Edge Cases, US2-S8).
- [ ] T020 [US2] Implement `src/combat/reset-adapters.ts` registering the cross-spec resets with T018's registry — player position and facing to `002`'s spawn, `004`'s doors to `closed` and secrets to unfound and keys to empty, `006`'s guards alive at their spawn tiles in `idle` with `enemiesAlive` back to the spawn count, and this spec's health, per-weapon ammo, active weapon and score — by calling those specs' exported state APIs, so no file owned by another spec is edited (FR-011, US2-S6, US2-S7).
- [ ] T021 [US2] Add `src/systems/vitals/register.ts` — a new system file, no shared bootstrap edit: apply `006`'s attack-module result to `src/combat/vitals.ts` unchanged rather than recomputing falloff, close `src/combat/run-state.ts`'s gate on the frame health reaches zero so movement and firing stop resolving while the render loop keeps running, present the restart prompt, bind the restart command from both the dead and alive states, and publish `health`, `score`, `dead`, `deaths` and `restarts` into `__diag.combat` (FR-009, FR-010, FR-011, US2-S3, US2-S4, US2-S6, US2-S9).
- [ ] T022 [US2] Handle the simultaneous-death edge case in `src/systems/vitals/register.ts`: when a guard's shot kills the player on the same tick the player's shot kills that guard, both resolve, `deaths` increments once, and the guard's kill still scores (Edge Cases, US2-S5, US2-S10).

**Checkpoint**: All four gates green. The run can be lost and restarted in place. The
field-for-field snapshot equality is proven under `npm run test`; US4 lifts the same
assertion into `npm run smoke` (FR-019).

---

## Phase 3: User Story 3 - Health, ammo and treasure pickups (Priority: P2)

**Goal**: One pickup per item marker in the shipped level, collected by walking over it,
collected once, clamped at every ceiling, and reset to uncollected by US2's restart.

**Independent Test**: Under `npm run test`, drive the pure pickup module with synthetic
player positions across the shipped level's markers; assert each kind's effect, the no-op
second pass, the untouched health pickup at full health, and the ammo clamp at capacity.

### Tests for User Story 3

> Write these first and confirm they fail before implementing.

- [ ] T023 [P] [US3] `tests/unit/pickups.test.ts`: `src/combat/pickups.ts` instantiates exactly one pickup per item marker `002` declares, takes each kind from its marker and reports `pickupsTotal`; a marker with an undeclared kind records a named error citing its coordinates instead of being dropped or throwing; a player inside the declared radius collects an uncollected pickup exactly once and increments `pickupsCollected` by one; a second pass over a consumed pickup applies nothing, changes no counter and records no error; collecting every marker in one scripted pass leaves `pickupsCollected` equal to `pickupsTotal` with neither ever exceeding the other (FR-013, FR-014, US3-S1, US3-S2, US3-S3, US3-S4, US3-S10).
- [ ] T024 [P] [US3] `tests/unit/pickup-effects.test.ts`: `src/combat/pickup-effects.ts` raises health by the declared amount clamped to the maximum; leaves a health pickup unconsumed and on the floor at exactly maximum health; adds ammo to each weapon kind the pickup declares clamped to that weapon's capacity with the surplus discarded and no counter above capacity; and consumes treasure always, adding its score-table value and incrementing `treasureFound` toward `treasureTotal` (FR-015, US3-S5, US3-S6, US3-S7, US3-S8, Edge Cases).

### Implementation for User Story 3

- [ ] T025 [US3] Implement `src/combat/pickups.ts` instantiating `Pickup` as `{tile, kind, consumed}` from `002`'s item spawn markers, taking each kind from the marker rather than from a position convention, reporting `pickupsTotal` and `treasureTotal` read from the level, and recording a named error citing the coordinates of any marker whose kind is not one of the declared kinds (FR-013, US3-S1, US3-S2).
- [ ] T026 [US3] Add collection to `src/combat/pickups.ts`: a pure proximity test against the declared collection radius that marks a pickup consumed, applies its effect exactly once and increments `pickupsCollected` by exactly one, and that does nothing at all on a second pass over a consumed pickup (FR-014, US3-S3, US3-S4).
- [ ] T027 [P] [US3] Implement `src/combat/pickup-effects.ts` applying the declared amounts — health clamped to US2's maximum and not consumed at full health, ammo clamped to each weapon's declared capacity in US1's weapon table with the surplus discarded, treasure adding its value from US2's score table and incrementing `treasureFound` (FR-015, US3-S5, US3-S6, US3-S7, US3-S8).
- [ ] T028 [US3] Route `004`'s silver and gold key pickups through `src/combat/pickups.ts`'s collection path rather than introducing a second pickup mechanism, so a key is a `Pickup` with a key kind and the key inventory is the effect (FR-015, US3-S9).
- [ ] T029 [US3] Add `src/systems/pickups/register.ts` — a new system file, no shared bootstrap edit: run the proximity check each frame against the player position, publish `pickupsCollected`, `pickupsTotal`, `treasureFound` and `treasureTotal` into `__diag.combat`, and call `registerResettable` from `src/combat/restart.ts` so restart marks every pickup uncollected without US2 editing anything this story owns (FR-013, FR-014, US3-S3, US3-S10, US2-S7).

**Checkpoint**: All four gates green. Supplies exist, are collected once, clamp correctly,
and come back on restart.

---

## Phase 4: User Story 4 - HUD, muzzle flash and combat diagnostics (Priority: P2)

**Goal**: The bottom of the screen reports health, weapon, ammo, keys, score and a face
that worsens with damage — every glyph stroked from code — and a shot produces a flash on
the frame it resolves. The smoke harness then drives the whole loop once.

**Independent Test**: Load the built page headlessly, assert `hudReady`, assert the HUD's
reported values track state after scripted changes, assert the portrait band index changes
at each declared threshold, and assert flash intensity is non-zero on a firing frame and
exactly zero after the declared decay.

### Tests for User Story 4

> Write these first and confirm they fail before implementing.

- [ ] T030 [P] [US4] `tests/unit/hud-glyphs.test.ts`: every character `src/hud/glyphs.ts` can draw resolves to a stroke or segment list defined in that table, no character falls back to a named system font family, and the table covers the digits and letters the HUD's declared readouts require (FR-016, US4-S1).
- [ ] T031 [P] [US4] `tests/unit/portrait.test.ts`: `src/hud/portrait.ts` returns a portrait index that changes at exactly each declared health-band threshold as health crosses it downward, returns the declared death portrait at zero, and yields the same portrait for the same band on every call (FR-016, US4-S4, US4-S5).
- [ ] T032 [P] [US4] `tests/unit/flash.test.ts`: `src/hud/flash.ts` reports intensity greater than zero on the frame a shot resolves, decays to exactly zero within the declared duration, and stays at zero for a held fire key that resolves no shot (FR-017, US4-S6, US4-S7).

### Implementation for User Story 4

- [ ] T033 [P] [US4] Implement `src/hud/glyphs.ts` as the code-defined stroke/segment glyph table — Constitution II forbids a `.ttf` or `.woff` at any path and `tools/check-no-binaries.mjs` already fails the gate on one, and a named system font is excluded too because it renders differently in headless Chromium than on the target machine (FR-016, US4-S1, SC-007).
- [ ] T034 [P] [US4] Implement `src/hud/portrait.ts`: the declared health bands, the band-to-portrait-index mapping including the death portrait at zero, and portraits drawn from code at load time so the same band always yields the same portrait and no image file exists (FR-016, US4-S4, US4-S5, SC-007).
- [ ] T035 [P] [US4] Implement `src/hud/flash.ts` as the pure muzzle-flash intensity and decay — begun by a resolved shot, never by the fire key, and exactly zero once the declared duration has elapsed (FR-017, US4-S6, US4-S7).
- [ ] T036 [US4] Implement `src/hud/compose.ts` drawing health, active weapon, that weapon's ammo, per-kind key counts, score and the portrait into one canvas-2D texture presented as a single screen-space quad, reading live state every frame rather than holding its own copy, so a change is reflected within one frame and `__diag.drawCalls` stays below 20 (FR-016, FR-018, US4-S2, US4-S3, US4-S9, SC-006).
- [ ] T037 [US4] Clamp the score display in `src/hud/compose.ts` to the declared digit width while `__diag.combat.score` keeps reporting the true value — display truncation never changes state (Edge Cases).
- [ ] T038 [P] [US4] Implement `src/hud/viewmodel.ts`: the weapon view-model built from procedural geometry with a declared fire motion that returns to rest within the flash decay, and no ray origin anywhere in it — the shot ray comes from the camera centre even when the model is drawn at the screen's edge (FR-017, US4-S6, US4-S8).
- [ ] T039 [US4] Add `src/systems/hud/register.ts` — a new system file, no shared bootstrap edit: composite the HUD, the view-model and the flash each frame, publish `muzzleFlash` into `__diag.combat`, and set `hudReady` true only once every value the HUD displays has a defined source, so the harness never asserts against a half-built HUD (FR-016, FR-017, FR-018, US4-S2, US4-S9, Edge Cases).
- [ ] T040 [US4] Extend `tools/smoke.mjs` to drive one full loop against the built page — fire every weapon, hit a guard, collect one pickup of each kind, take guard damage down to zero health, and restart — exiting non-zero and naming the step that failed (FR-019, SC-001).
- [ ] T041 [US4] In `tools/smoke.mjs`, deep-compare the first-frame state snapshot against the snapshot one frame after restart and fail citing the offending field on any difference outside the restart-exempt set US2 exports, which the harness reads rather than restates (FR-019, US2-S8, SC-002).
- [ ] T042 [US4] In `tools/smoke.mjs`, assert `window.__diag.combat` carries every field FR-018 declares and that no `001`–`006` field was renamed, removed or repurposed, and that `__diag.drawCalls` stays below 20 with the HUD, view-model and flash all rendering (FR-018, US4-S9, US4-S10, SC-006).

**Checkpoint**: All four gates green. The whole loop — fight, collect, survive, die,
restart — is machine-verified by `npm run smoke`, and the tree still holds zero binary
assets.

---

## Dependencies & Execution Order

### User Story Dependencies

Strictly sequential, as declared in the spec's `## Work Graph` block and compiled into
`workgraph.json`:

- **US1** — no dependencies within this spec. Every other story consumes a resolved shot.
- **US2** — depends on US1. Needs `ShotResult`, the weapon table's ammo capacities and
  `run-state.ts`'s command gate before it can define what restart resets.
- **US3** — depends on US2. "Collected" is one of the fields restart must reset, and pickup
  effects clamp to US2's health maximum and add to US2's score table.
- **US4** — depends on US3. The HUD's `hudReady` contract requires every displayed value to
  have a defined source, and `pickupsTotal` and `treasureTotal` are among them.

Cross-spec, this whole feature depends on `006-enemies` having landed
(`depends_on_landed` in `spec.md`), which in turn carries `002`, `003` and `004`: the ray
walk needs `002`'s grid and `004`'s door state, damage comes from `006`'s attack module
unchanged, and the pickup markers are `002`'s.

### Shared files

**No file is written by two different stories.** That is the property this breakdown was
built for, and it holds without exception:

- `src/main.ts` — **not edited at all.** Behaviour enters through the four
  `src/systems/*/register.ts` files, discovered by glob (see the section above).
- `src/diag/diag.ts` — **not edited at all.** T011 augments the `Diagnostics` interface from
  inside `src/combat/combat-diag.ts`.
- `src/combat/combat-diag.ts` — created once in T011 (US1) with the *complete* FR-018 shape.
  US2, US3 and US4 write values into fields that already exist; none of them edits it.
- `src/combat/restart.ts` — owned by US2 (T018, T019). US3 makes its pickups resettable by
  *calling* `registerResettable` from its own system file (T029), never by editing it.
- `tools/smoke.mjs` — owned by US4 alone (T040–T042).
- `003`'s movement system — if it needs a one-line consultation of
  `src/combat/run-state.ts` to stop resolving on death, that edit belongs to **US2 alone**
  (T021); see plan.md Complexity Tracking.

Files touched by more than one task *within a single story*, which is ordering rather than
contention: `src/combat/fire-control.ts` (T009, T010), `src/combat/restart.ts`
(T018, T019), `src/combat/pickups.ts` (T025, T026, T028),
`src/systems/vitals/register.ts` (T021, T022), `src/hud/compose.ts` (T036, T037),
`tools/smoke.mjs` (T040, T041, T042).

### Parallel Opportunities

Within a story only, on the tasks marked [P]: T001–T005 and T007/T011/T012 in US1;
T014/T015 and T017 in US2; T023/T024 and T027 in US3; T030–T035 and T038 in US4. Nothing
crosses a story boundary.

## Notes

- Test-first is mandatory for anything DOM-free and three.js-free (Article III), which here
  is every module under `src/combat/` and `src/hud/glyphs.ts`, `portrait.ts` and `flash.ts`.
  Everything that can only exist inside the render loop is verified through
  `window.__diag.combat` by the smoke harness instead.
- Add behaviour by adding `src/systems/<name>/register.ts`, never by editing `src/main.ts`.
- `window.__diag` is extended additively: no `001`–`006` field is renamed, removed or
  repurposed (FR-018).
- Never weaken a gate to make it pass. A failing gate blocks the commit, not the gate.
- Commit once per task (ergane's inner loop; Article VII).
- No source file over 400 lines (Article IV); split as part of the task that would exceed it.
