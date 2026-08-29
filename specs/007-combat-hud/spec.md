# Feature Specification: Weapons, Combat Loop and HUD

**Feature Branch**: `007-combat-hud`

**Created**: 2026-08-29

**Status**: Draft

**Input**: Milestone M6 of the Wolfenstein-style FPS brief. Closes the gameplay loop that
`001`–`006` set up: three weapons with distinct fire rates and spread resolved by a pure
hitscan module against the level grid and the guards from M5; player health that guard
shots actually reduce; death and a deterministic restart that needs no page reload;
health, ammo and treasure pickups drawn from the level's item markers; and a HUD whose
glyphs are stroked by code because Constitution II forbids a font file. After this spec
the game can be lost and played again.

## Clarifications

### Session 2026-08-29

- Q: Where does the shot ray originate? → A: The camera centre. The view-model is cosmetic and never the source of a ray — a weapon rendered at the screen's edge must not shoot from there.
- Q: Is spread random per shot? → A: Seeded, in the same shape as 006's guard PRNG. Seed plus shot index produces the same spread vector every run, so "the shot missed" is reproducible in a test rather than an anecdote.
- Q: Fire rate by frame or by elapsed time? → A: Elapsed seconds against a per-weapon interval, the same rule 004 fixed for doors. Holding fire at 240 fps must not empty a magazine eight times faster than at 30 fps.
- Q: Are weapons found or granted? → A: All three are held from spawn and gated by ammo. The brief's pickups are health, ammo and treasure; adding weapon pickups would invent a fourth kind this milestone does not call for.
- Q: How does the HUD draw text with no font file? → A: From a code-defined stroke/segment glyph table. Not a `.ttf` (Constitution II), and not a named system family either — a system font renders differently in headless Chromium than on the target machine, which would make the HUD assertions unstable.
- Q: Does restart regenerate the level? → A: No. The level is authored data. Restart resets *state* — player, health, ammo, score, doors, secrets, keys, pickups and guards — to spawn values in place, with no page reload.
- Q: Is treasure required to finish the level? → A: No. Treasure is score. Completion is the elevator, which belongs to 008.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Three weapons and hitscan resolution (Priority: P1)

As a player, `1`, `2` and `3` select a pistol, an SMG and a chaingun that feel genuinely
different — slower and accurate versus fast and loose — and firing traces a ray from the
camera that stops at the first wall or hits the first guard along it, spending ammo as it
goes.

**Why this priority**: Every other story here consumes a resolved shot: damage needs a
hit, the HUD displays the ammo this story spends, and the loop cannot be lost or won
without it. It is also the last pure module in the project, so it stays fully unit-testable.

**Independent Test**: Under `npm run test`, import the weapon and hitscan modules with no
DOM and no three.js; assert the weapon table declares the three weapons with strictly
ordered fire intervals and spreads, assert that holding fire for one simulated second at
1 ms and at 250 ms deltas yields the same shot count within one, assert a wall between
camera and guard produces a `wall` result at the hand-computed distance, and assert two
runs at the same seed produce identical spread vectors.

**Acceptance Scenarios**:

1. **Given** the weapon and hitscan modules, **When** their import graphs are inspected,
   **Then** neither imports `three` nor any DOM API, both take the level grid, door state
   and guard list as arguments rather than globals, and both are exercised under
   `npm run test`.
2. **Given** the weapon table, **When** read, **Then** it declares exactly `pistol`, `smg`
   and `chaingun`, each with a fire interval, damage, maximum spread angle, ammo cost and
   ammo capacity, all in that one table and not as literals at call sites.
3. **Given** the three weapons, **When** their fire intervals are compared, **Then**
   `chaingun` is strictly faster than `smg` and `smg` strictly faster than `pistol`;
   **And** when their maximum spreads are compared, **Then** `pistol` is strictly tighter
   than `smg` and `smg` strictly tighter than `chaingun`.
4. **Given** the fire command held continuously for one simulated second, **When** the
   same second is stepped as 1 ms deltas and as 250 ms deltas, **Then** the shot counts
   differ by at most one and neither exceeds the count implied by the weapon's declared
   interval.
5. **Given** a seeded PRNG at seed `1234`, **When** twenty shots are fired from the same
   weapon, **Then** the twenty spread vectors are identical to those produced by a second
   run at the same seed, and every vector's angle from the camera forward axis is at or
   below that weapon's declared maximum spread.
6. **Given** a clear line from the camera to a guard, **When** a shot resolves, **Then**
   the result names `guard`, identifies which guard, reports the distance along the ray,
   and reports the damage applied from the weapon's declared value.
7. **Given** a wall or a closed door between the camera and a guard, **When** a shot
   resolves, **Then** the result names `wall`, reports the distance at which the ray
   terminated, and applies zero damage to any guard.
8. **Given** a shot that hits neither guard nor wall within the declared maximum range,
   **When** it resolves, **Then** the result names `none` — never an empty or undefined
   outcome.
9. **Given** a weapon with insufficient ammo for one shot, **When** the fire command is
   issued, **Then** the outcome is `out-of-ammo`, no ray is traced, ammo is unchanged and
   never negative, and the fire interval timer is not consumed.
10. **Given** the fire command bound to both `Ctrl` and the left mouse button, **When**
    both are pressed on the same frame, **Then** exactly one shot is resolved — one
    command path, not two handlers.
11. **Given** `1`, `2` or `3` pressed, **When** the active weapon changes, **Then** the
    change takes a declared switch delay during which no shot resolves, and pressing the
    key for the already-active weapon fires nothing and costs nothing.

---

### User Story 2 - Health, death and deterministic restart (Priority: P1)

As a player, guard shots take health off me, running out of health ends the run, and
restarting puts the level back exactly as it was at spawn — doors shut, secrets unfound,
guards alive — without reloading the page.

**Why this priority**: This is the milestone's DONE condition, the half of "fight,
collect, survive, die, restart" that makes the game losable. A restart that leaks state
is the bug that makes every subsequent playtest and every subsequent smoke run
untrustworthy.

**Independent Test**: In the headless harness, snapshot `window.__diag` on the first
frame; script the player into guard fire until health reaches zero; assert the dead
state; issue restart; assert the new snapshot equals the first-frame snapshot for every
state field — health, ammo, score, position, doors open, secrets found, guards alive,
pickups collected.

**Acceptance Scenarios**:

1. **Given** the player at spawn, **When** health is read, **Then** it equals the declared
   starting maximum, and that maximum is a named constant declared in one place.
2. **Given** a guard shot resolved against the player by 006's attack module, **When**
   damage is applied, **Then** health decreases by exactly that shot's falloff-computed
   damage and is clamped at a floor of zero — never negative.
3. **Given** health above zero, **When** any damage arrives, **Then** the player remains
   alive, movement and firing continue to work, and no error is written to
   `__diag.errors`.
4. **Given** health reaching exactly zero, **When** the frame completes, **Then** the run
   enters a declared `dead` state, movement and firing commands stop resolving, the render
   loop keeps running, and a restart prompt is presented.
5. **Given** the `dead` state, **When** further guard shots resolve, **Then** health stays
   at zero, no second death transition fires, and `deaths` increments exactly once for that
   death.
6. **Given** the restart command, **When** it is issued from the `dead` state, **Then**
   the page does not reload, and player position, facing, health, per-weapon ammo, active
   weapon, key inventory and score all return to their spawn values.
7. **Given** the restart command, **When** it completes, **Then** every door reads
   `closed`, `secretsFound` is 0, every pickup is uncollected, every guard is alive at its
   spawn tile in `idle`, and `enemiesAlive` equals the spawn count.
8. **Given** a first-frame snapshot of the diagnostics state fields, **When** compared to
   the snapshot taken one frame after a restart, **Then** the two are equal field for
   field except for the session counters declared to survive a restart — `deaths`,
   `restarts` and elapsed wall-clock — which accumulate across the session.
9. **Given** the restart command issued while the player is alive, **When** it resolves,
   **Then** it performs the same full reset — restart is not exclusive to death.
10. **Given** the score value, **When** a guard is killed or a treasure collected,
    **Then** score increases by the amount declared in one score table, never decreases
    within a run, and returns to zero on restart.

---

### User Story 3 - Health, ammo and treasure pickups (Priority: P2)

As a player, I find supplies on the floor: health that heals me, ammo that reloads me,
and treasure that is worth points — each collected by walking over it, each collected
once, and none of it wasted when I already have all I can carry.

**Why this priority**: The loop survives without pickups — a player can fight and die on
spawn supplies — so this refines a working system. It lands after US2 because "collected"
is one of the state fields restart must reset.

**Independent Test**: Under `npm run test`, drive the pure pickup module with synthetic
player positions across the shipped level's item markers; assert each kind's effect,
assert a second pass over a consumed pickup does nothing, assert a health pickup at full
health is left on the floor, and assert ammo clamps at capacity.

**Acceptance Scenarios**:

1. **Given** the level's item spawn markers from 002, **When** pickups are instantiated,
   **Then** one pickup exists per marker, its kind is taken from that marker's declared
   kind string, and the total count is reported as `pickupsTotal`.
2. **Given** a marker whose kind is not one of the declared kinds, **When** the level
   loads, **Then** a named error is recorded citing the marker's coordinates rather than
   the pickup being silently dropped or the load throwing.
3. **Given** the player walking within a declared collection radius of an uncollected
   pickup, **When** the frame resolves, **Then** the pickup is collected, marked consumed,
   `pickupsCollected` increments by exactly one, and its effect is applied once.
4. **Given** a consumed pickup, **When** the player walks over it again, **Then** nothing
   is applied, `pickupsCollected` is unchanged, and no error is recorded.
5. **Given** a health pickup and a player below maximum health, **When** it is collected,
   **Then** health increases by the declared amount clamped to the maximum and never
   exceeds it.
6. **Given** a health pickup and a player at exactly maximum health, **When** the player
   walks over it, **Then** it is not consumed and remains available — a full player does
   not destroy supplies.
7. **Given** an ammo pickup, **When** collected, **Then** the declared amount is added to
   the weapon kinds the pickup declares, clamped to each weapon's declared capacity, and
   the surplus is discarded rather than overflowing.
8. **Given** a treasure pickup, **When** collected, **Then** score increases by the value
   in the score table, the pickup is always consumed, and `treasureFound` increments
   toward `treasureTotal`.
9. **Given** the silver and gold key pickups owned by 004, **When** they are collected,
   **Then** they flow through this same collection path and this spec does not introduce a
   second pickup mechanism for them.
10. **Given** every pickup in the shipped level collected in one scripted run, **When**
    counters are read, **Then** `pickupsCollected` equals `pickupsTotal` and neither ever
    exceeds the other.

---

### User Story 4 - HUD, muzzle flash and combat diagnostics (Priority: P2)

As a player, the bottom of the screen tells me what I need to know — health, ammo for the
weapon I am holding, which keys I carry, my score, and a face that looks worse as I take
damage — and firing produces a muzzle flash on the frame the shot leaves the barrel.

**Why this priority**: Everything under it already works and is machine-verifiable; this
is the presentation layer that makes it legible to a human. It lands last for the same
reason 006's billboards do.

**Independent Test**: Load the built page headlessly, assert `hudReady` becomes true,
assert the HUD's reported values track `health`, `ammo`, `keys` and `score` after scripted
changes to each, assert the face-portrait band index changes at the declared health
thresholds, and assert the muzzle-flash intensity is non-zero on a firing frame and
returns to zero within its declared decay.

**Acceptance Scenarios**:

1. **Given** the HUD glyph source, **When** inspected, **Then** every character it can
   draw comes from a code-defined stroke or segment table, no `.ttf` or `.woff` file
   exists at any path, and no named system font family is relied upon for a value the
   harness asserts.
2. **Given** the running page after the first frame, **When** `window.__diag.combat` is
   read, **Then** `hudReady` is true and the HUD's displayed health, active weapon, ammo,
   key counts and score each equal the underlying state.
3. **Given** scripted changes to health, ammo, keys and score, **When** the next frame
   renders, **Then** every changed value is reflected in the HUD within one frame — the
   HUD reads state, it does not hold its own copy.
4. **Given** the face portrait and the declared health bands, **When** health crosses each
   band threshold downward, **Then** the reported portrait index changes at exactly that
   threshold, and at zero health it shows the declared death portrait.
5. **Given** the face portrait, **When** it is generated, **Then** it is drawn by code at
   load time — no image file — and the same band always yields the same portrait.
6. **Given** a shot fired, **When** that frame renders, **Then** muzzle-flash intensity is
   greater than zero, the weapon view-model plays its declared fire motion, and both
   return to rest within the declared decay duration.
7. **Given** no shot fired for longer than the decay duration, **When** the frame renders,
   **Then** muzzle-flash intensity is exactly zero — the flash follows shots, not the fire
   key.
8. **Given** the weapon view-model, **When** a shot is resolved, **Then** the ray still
   originates at the camera centre regardless of where the model is drawn.
9. **Given** the HUD drawn every frame, **When** `window.__diag.drawCalls` is read,
   **Then** it remains below 20 — the HUD is composited within the budget 002 set and 005
   preserved.
10. **Given** `window.__diag.combat`, **When** read, **Then** it carries `weapon`, `ammo`
    (per weapon kind), `health`, `score`, `shotsFired`, `hits`, `kills`,
    `pickupsCollected`, `pickupsTotal`, `treasureFound`, `treasureTotal`, `dead`,
    `deaths`, `restarts`, `muzzleFlash` and `hudReady`, additive over the 001–006
    contracts with no existing field renamed, removed or repurposed.

---

### Edge Cases

- Fire held across a frame long enough to span several fire intervals → at most the number
  of shots the declared interval allows for that elapsed time, spending ammo for each; a
  delta spike must not discharge a full magazine in one frame.
- Weapon switched mid-burst → the switch delay applies, the in-flight interval timer is
  reset for the new weapon, and no shot resolves during the delay.
- Guard killed by the same shot that would have hit the wall behind it → the guard is the
  first blocker along the ray, so the result is `guard`; the wall is never credited with a
  hit that a body absorbed.
- Two guards on the same ray → only the nearer takes damage; a hitscan shot does not
  penetrate.
- Player killed by a guard on the same tick that the player's own shot kills that guard →
  both resolve, the death count increments once, and the guard's kill still scores.
- Restart pressed twice in quick succession → the second is idempotent; `restarts`
  increments once per completed reset and state is not double-reset mid-frame.
- Ammo pickup collected at full capacity for every weapon it serves → surplus discarded,
  pickup consumed, and no counter goes above capacity.
- Health pickup at exactly maximum health → left on the floor (US3-S6), so the level's
  supply economy is not silently destroyed by walking a corridor.
- Score overflowing a display width → the HUD clamps its rendered digits to the declared
  width while `__diag.combat.score` reports the true value; display truncation never
  changes state.
- HUD drawn before the first guard exists, or before pickups instantiate → `hudReady`
  becomes true only once every value it displays has a defined source, so the harness never
  asserts against a half-built HUD.
- The player dying while a door is closing on them → the crush reversal from 004 still
  applies; death does not strand a door mid-travel across a restart, because restart shuts
  every door.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The weapon and hitscan modules MUST import neither `three` nor any DOM API,
  MUST take the level grid, door state and guard list as arguments rather than globals, and
  MUST be exercisable under `npm run test`.
- **FR-002**: A single exported weapon table SHALL declare exactly `pistol`, `smg` and
  `chaingun`, each with fire interval, damage, maximum spread angle, ammo cost, ammo
  capacity and maximum range, with no such value duplicated at a call site.
- **FR-003**: Fire intervals SHALL order strictly as chaingun faster than SMG faster than
  pistol, and maximum spreads SHALL order strictly as pistol tighter than SMG tighter than
  chaingun.
- **FR-004**: Firing SHALL be gated by accumulated elapsed seconds against the active
  weapon's declared interval, such that one simulated second of held fire produces shot
  counts differing by at most one whether stepped at 1 ms or 250 ms deltas.
- **FR-005**: Shot spread SHALL derive from a seeded PRNG so that the same seed and shot
  index reproduce the same spread vector, and every vector's angle from camera forward MUST
  be at or below the active weapon's declared maximum spread.
- **FR-006**: A shot SHALL be traced as a ray from the camera centre that terminates at the
  first wall or closed door, or at the nearest guard along it, returning exactly one of
  `guard`, `wall`, `none` or `out-of-ammo` with the distance along the ray and the damage
  applied — never an empty result, and never penetrating past the first blocker.
- **FR-007**: Firing SHALL consume the active weapon's declared ammo cost; a weapon with
  insufficient ammo MUST return `out-of-ammo`, trace no ray, leave ammo unchanged and never
  allow a negative count.
- **FR-008**: Fire SHALL be bound to both `Ctrl` and the left mouse button through one
  command path resolving at most one shot per frame, and `1`, `2`, `3` SHALL select the
  three weapons with a declared switch delay during which no shot resolves.
- **FR-009**: Player health SHALL start at a declared maximum named in one place, SHALL
  decrease by exactly the falloff-computed damage of each guard shot from 006, and MUST be
  clamped to a floor of zero.
- **FR-010**: Health reaching zero SHALL enter a declared `dead` state in which movement
  and firing commands stop resolving while the render loop continues, a restart prompt is
  presented, and `deaths` increments exactly once for that death.
- **FR-011**: A restart command SHALL reset player position, facing, health, per-weapon
  ammo, active weapon, keys, score, every door to `closed`, every secret to unfound, every
  pickup to uncollected and every guard to alive at its spawn tile in `idle` — in place,
  with no page reload — and MUST be issuable both from the `dead` state and while alive.
- **FR-012**: Score SHALL accumulate from a single declared score table on guard kills and
  treasure collection, MUST NOT decrease within a run, and SHALL return to zero on restart.
- **FR-013**: Pickups SHALL instantiate one per item spawn marker declared by 002, taking
  each kind from that marker, reporting `pickupsTotal`, and recording a named error citing
  the coordinates of any marker whose kind is not declared.
- **FR-014**: A pickup SHALL be collected when the player is within a declared radius,
  applying its effect exactly once and marking itself consumed; a consumed pickup MUST
  apply nothing on a second pass, and a health pickup MUST NOT be consumed while the player
  is at maximum health.
- **FR-015**: Health, ammo and treasure pickups SHALL apply their declared amounts clamped
  to the health maximum and to each weapon's declared ammo capacity, discarding surplus;
  treasure SHALL add its score-table value and increment `treasureFound` toward
  `treasureTotal`; and 004's key pickups MUST flow through this same collection path rather
  than a second mechanism.
- **FR-016**: The HUD SHALL display health, active weapon, that weapon's ammo, key counts
  per kind, score and a face portrait selected from declared health bands, reading live
  state so every change is reflected within one frame; all glyphs MUST come from a
  code-defined stroke or segment table, with no font file at any path and no reliance on a
  named system font family.
- **FR-017**: A muzzle flash and the weapon view-model's fire motion SHALL begin on the
  frame a shot resolves and decay to exactly zero within a declared duration, and MUST NOT
  be driven by the fire key in the absence of a resolved shot; the view-model MUST NOT be
  the origin of any ray.
- **FR-018**: The application SHALL extend `window.__diag` with a `combat` object carrying
  `weapon`, `ammo`, `health`, `score`, `shotsFired`, `hits`, `kills`, `pickupsCollected`,
  `pickupsTotal`, `treasureFound`, `treasureTotal`, `dead`, `deaths`, `restarts`,
  `muzzleFlash` and `hudReady`, additive over the 001–006 contracts — no existing field
  renamed, removed or repurposed — and the HUD MUST keep `__diag.drawCalls` below 20.
- **FR-019**: The smoke harness SHALL drive one full loop — fire a shot, hit a guard, take
  damage, reach zero health, restart — and MUST fail, citing the offending field, when the
  post-restart state snapshot differs from the first-frame snapshot in any field other than
  the session counters `deaths`, `restarts` and elapsed wall-clock, which are the only
  fields permitted to accumulate across a restart at this spec's landing.

### Key Entities

- **WeaponTable**: the one exported record of `pistol`, `smg` and `chaingun` with interval,
  damage, spread, ammo cost, capacity and range. Every tuning value lives here.
- **ShotResult**: `{outcome, distance, guardIndex, damage}` where outcome is `guard`,
  `wall`, `none` or `out-of-ammo`. The single return shape of a resolved shot.
- **PlayerVitals**: health, per-weapon ammo, active weapon, score, alive/dead — the state
  restart resets and the HUD reads.
- **Pickup**: `{tile, kind, consumed}` instantiated from 002's item markers; kinds are
  health, ammo, treasure and 004's silver and gold keys.
- **ScoreTable**: declared point values for a guard kill and each treasure kind.
- **HudGlyphs**: the code-defined stroke/segment table that makes text possible without a
  font file, and the face-portrait band set drawn beside it.
- **CombatDiagnostics**: the `window.__diag.combat` object, additive over 001–006.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A scripted headless run completes the whole loop — fires every weapon, kills
  at least one guard, collects at least one pickup of each kind, dies, and restarts —
  exiting `npm run smoke` with status 0.
- **SC-002**: The post-restart diagnostics snapshot equals the first-frame snapshot field
  for field, except `deaths`, `restarts` and elapsed wall-clock, asserted by deep equality.
- **SC-003**: One simulated second of held fire yields shot counts within one of each other
  at 1 ms and at 250 ms deltas, for all three weapons.
- **SC-004**: Twenty shots at seed `1234` reproduce identical spread vectors across two
  runs, asserted by array equality.
- **SC-005**: `npm run test` includes at least 15 passing assertions over the weapon table,
  hitscan outcomes, ammo accounting, pickup effects and restart reset.
- **SC-006**: `window.__diag.drawCalls` remains below 20 with the HUD, view-model and
  muzzle flash all rendering.
- **SC-007**: Zero binary asset files exist in the tree after this spec lands — every HUD
  glyph, portrait and muzzle flash is drawn from code.
- **SC-008**: Every declared shot outcome (`guard`, `wall`, `none`, `out-of-ammo`) is
  produced by at least one test, so no branch of FR-006 ships unexercised.

## Assumptions

- 001–006 have landed: diagnostics and the smoke harness, a validated level with item
  spawn markers, a colliding player, doors and keys, textured geometry, and guards with a
  state machine, line-of-sight and a damage-falloff attack.
- Guard damage against the player comes from 006's attack module unchanged; this spec
  applies its result to health rather than recomputing falloff.
- Guard hit boxes are derived from the guard's grid position and a declared radius; no new
  collision system is introduced (Constitution I).
- 002's item spawn markers declare the kind set this spec consumes — `health`, `ammo`,
  `treasure`, `silver-key`, `gold-key` — with at least 12 markers including 3 treasure, so
  `treasureTotal` and `pickupsTotal` are read from the level rather than declared here.
- The elevator exit, the end-of-level stats screen and all audio belong to 008; this spec
  emits the events those consume — kills, treasure, elapsed time — but plays no sound and
  ends no level. 008 adds one more counter to FR-019's restart-exempt set (`completions`);
  the set is open to later specs by declaration, closed to anything undeclared.
- Held ammo, health maximum and score values are gameplay constants declared in tables here;
  the tests assert relationships and clamping, not tuned magnitudes.

## Work Graph

```yaml
US1:
  depends_on: []
  implements: [FR-001, FR-002, FR-003, FR-004, FR-005, FR-006, FR-007, FR-008]
US2:
  depends_on: [US1]
  implements: [FR-009, FR-010, FR-011, FR-012]
US3:
  depends_on: [US2]
  implements: [FR-013, FR-014, FR-015]
US4:
  depends_on: [US3]
  implements: [FR-016, FR-017, FR-018, FR-019]
```
