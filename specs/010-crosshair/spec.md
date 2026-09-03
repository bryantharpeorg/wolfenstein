---
state: ready
depends_on_landed: ["007-combat-hud", "008-polish", "009-playtest-uat"]
---

# Feature Specification: Crosshair, Spread Feedback and Hit Confirmation

**Feature Branch**: `010-crosshair`

**Created**: 2026-09-03

**Status**: Draft

**Input**: Not a milestone of the original brief — the first spec in this repository that
answers a play observation rather than a plan. `007` gave every weapon a
`maxSpreadRadians` and resolves every shot as `guard`, `wall`, `none` or `out-of-ammo`,
but the screen says none of it: the player aims at the centre of an unmarked viewport and
learns whether a shot connected only from the score. This spec puts a reticle at that
centre, makes its gap the weapon's own declared spread rather than a decoration, and
confirms a hit at the moment it lands. It adds no gameplay: nothing here changes what a
shot does, only what the player is told about it.

## Clarifications

### Session 2026-09-03

- Q: Static reticle, or one that reacts? → A: Reacts. The gap opens with the weapon's spread, with movement and with each shot, and settles when the player stands still. A static reticle would be a decal; the point is to show the accuracy the player actually has at that instant.
- Q: Where does the gap come from? → A: Derived from the active weapon's `maxSpreadRadians` in `007`'s weapon table. Never restated — `weapons.test.ts` already scans every importer for a line repeating a value from that table, and this spec must survive that scan.
- Q: Does it confirm hits? → A: Yes, and a kill is marked distinctly from a hit. Both are read from `__diag.combat` counters rising, in the same shape `007`'s muzzle flash already watches `shotsFired`.
- Q: Player-configurable? → A: A toggle only — shown or hidden, on a bound key. No style picker, no colour options, no persistence layer; a hidden crosshair is a preference this spec honours, not a settings system this spec builds.
- Q: Can it ride the existing HUD quad? → A: No. `007`'s HUD is one 1280×160 canvas on a quad pinned to the bottom of the view. The crosshair is centred and must scale with the viewport independently, so it takes its own quad and spends its own draw call against the budget `002` set.
- Q: Does it render through the post chain or over it? → A: Over it, at or above `HUD_RENDER_ORDER`. The reticle is a readout, not a scene element; bloom smearing an aiming aid makes it worse at the one job it has.
- Q: What verifies it? → A: All three surfaces this repository has — unit tests over the pure geometry, a discovered smoke check reading `__diag`, and an assertion inside the `009` playtest runner that a real playthrough sees it react. The first two are gates; the third is not, and cannot be.
- Q: Does the toggle persist across a restart? → A: Yes. `007`'s restart resets *run* state; a display preference is not run state, and a crosshair that reappears every time the player dies would be a bug reported as one.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A reticle at the centre of the screen (Priority: P1)

As a player, the exact point my shot will travel toward is marked, so aiming is something I
do rather than something I estimate from the middle of the window.

**Why this priority**: Every other story here moves, marks or hides a reticle that must
first exist and be drawn. It is also the only story that adds a mesh to the scene, so the
draw-call budget question is settled once, here, rather than three times.

**Independent Test**: Under `npm run test`, import the crosshair geometry module with no
DOM and no three.js and assert it returns stroke segments symmetric about the origin for a
declared gap; then under `npm run smoke`, assert `window.__diag.crosshair` is published,
`hidden` is false, and `window.__diag.drawCalls` is still below 20.

**Acceptance Scenarios**:

1. **Given** the crosshair geometry module, **When** its import graph is inspected,
   **Then** it imports neither `three` nor any DOM API, takes its gap and viewport as
   arguments rather than globals, and is exercised under `npm run test`.
2. **Given** a declared gap and arm length, **When** the reticle's segments are computed,
   **Then** they are four strokes symmetric about the origin in both axes, each starting at
   the gap and extending outward by the arm length, computed from code and from no image
   file, font or glyph table.
3. **Given** the running page, **When** the first frame is drawn, **Then** a crosshair quad
   exists in the scene, is centred in the viewport, and is a different object from the HUD
   bar quad `007` composites.
4. **Given** a viewport resized to a different aspect ratio, **When** the next frame is
   drawn, **Then** the reticle is still centred and its arms are still the same length in
   pixels — it scales with the viewport rather than stretching with it.
5. **Given** `008`'s post-processing chain active, **When** the frame is composited,
   **Then** the reticle is drawn over the chain at or above `HUD_RENDER_ORDER` and is not
   bloomed, blurred or colour-graded by it.
6. **Given** the running page, **When** `window.__diag.crosshair` is read, **Then** it
   reports at least the current gap, whether the reticle is hidden, and that its sources
   are defined — additively over the `001`–`009` diagnostics contract, with no existing
   field renamed, removed or repurposed.
7. **Given** the crosshair, HUD, view-model and muzzle flash all rendering, **When**
   `window.__diag.drawCalls` is read, **Then** it is below 20.

---

### User Story 2 - A gap that reads the weapon and the motion (Priority: P1)

As a player, the reticle opens when I am moving or firing and tightens when I stand still,
and it is wider with the chaingun than with the pistol, so I can see how accurate I am
right now instead of learning it from where my shots land.

**Why this priority**: This is the story that makes the reticle worth having. A crosshair
that never moves tells the player nothing `007` had not already told them by putting a dot
in the middle of the screen.

**Independent Test**: Under `npm run test`, drive the pure spread function with declared
weapon spreads, player speeds and elapsed times and assert the ordering, the opening and
the settling — no page, no browser, no three.js.

**Acceptance Scenarios**:

1. **Given** the three weapons at rest, **When** each one's resting gap is computed,
   **Then** pistol is strictly tighter than SMG and SMG strictly tighter than chaingun,
   in the same order `007` fixed for `maxSpreadRadians`.
2. **Given** the crosshair module's source, **When** it is scanned for literals, **Then**
   no value from `007`'s weapon table appears in it — the gap is read through the weapon
   table's own accessor, so retuning a weapon retunes the reticle with no edit here.
3. **Given** a stationary player, **When** the player accelerates to full movement speed,
   **Then** the gap increases monotonically with `__diag.player.speed` and never exceeds a
   declared ceiling however fast the player moves.
4. **Given** a shot fired, **When** the frames after it are stepped, **Then** the gap jumps
   by a declared recoil amount on the frame the shot leaves the barrel and decays smoothly
   back toward the resting gap.
5. **Given** a player who stops moving and stops firing, **When** a declared settle time
   elapses, **Then** the gap is within a declared tolerance of that weapon's resting gap.
6. **Given** the same sequence of weapon, speeds and shot timings, **When** the spread is
   stepped at 1 ms deltas and at 250 ms deltas, **Then** the resulting gaps differ by at
   most a declared tolerance — the reticle is driven by elapsed seconds, not by frames, the
   rule `004` fixed for doors and `007` for fire rate.
7. **Given** a weapon switch, **When** the switch completes, **Then** the gap moves toward
   the new weapon's resting gap rather than snapping to it.

---

### User Story 3 - Hit and kill confirmation (Priority: P2)

As a player, the reticle tells me the instant a shot connects, and tells me differently
when that shot was the one that put a guard down, so I know whether to keep firing.

**Why this priority**: The feedback is worth more than the spread to a player who cannot
tell hits from misses at range — but it is built on the same reticle state US2 establishes,
and a hit mark with no reticle to hang it on is not a story.

**Independent Test**: Under `npm run test`, drive the pure feedback function with rising
and static hit and kill counters and a run state, asserting which mark is active and that
it decays; the browser is not involved.

**Acceptance Scenarios**:

1. **Given** `__diag.combat.hits` rising on a frame, **When** that frame is drawn, **Then**
   a hit mark is shown on the reticle and is visually distinct from the resting reticle.
2. **Given** `__diag.combat.kills` rising on a frame, **When** that frame is drawn, **Then**
   a kill mark is shown that is distinct from the hit mark, not merely a brighter one.
3. **Given** a hit and a kill registered on the same frame, **When** that frame is drawn,
   **Then** the kill mark is the one shown — the stronger outcome, never both overlaid.
4. **Given** a mark ignited, **When** a declared duration elapses with no further hit,
   **Then** the mark has decayed to nothing and the reticle is at its ordinary state.
5. **Given** a counter that does not move, **When** frames are drawn, **Then** no mark
   ignites — the source is the counter *rising*, in the same shape `007`'s muzzle flash
   watches `shotsFired`, so a held trigger against a wall lights nothing.
6. **Given** `__diag.run.state` is not `playing`, or the player is dead, **When** frames are
   drawn, **Then** no mark ignites and any active mark is cleared.
7. **Given** a restart, **When** the first frame after it is drawn, **Then** no mark is
   active and the gap is at the starting weapon's resting value.

---

### User Story 4 - Toggling it off, and proving all of it (Priority: P2)

As a player I can hide the crosshair with one key and it stays hidden; and as the operator
I can see, from a gate and from a recorded playthrough, that the thing actually works.

**Why this priority**: The toggle is small and the verification is the point. This is the
story that puts the crosshair behind the same evidence every other surface in this
repository stands behind, including the one surface that drives real input.

**Independent Test**: Under `npm run test`, assert the binding table resolves the declared
key to a toggle command and nothing else to it; under `npm run smoke`, the discovered
crosshair check passes; and `npm run play` reports the crosshair assertions in its record.

**Acceptance Scenarios**:

1. **Given** the declared toggle key pressed, **When** the next frame is drawn, **Then** the
   reticle is not drawn and `__diag.crosshair.hidden` is true.
2. **Given** the crosshair hidden, **When** the same key is pressed again, **Then** it is
   drawn again and `hidden` is false — one key, both directions.
3. **Given** the crosshair hidden, **When** `__diag.drawCalls` is read, **Then** it is no
   higher than with the crosshair shown — hiding it costs nothing rather than drawing a
   transparent quad.
4. **Given** the crosshair hidden, **When** the player dies and the run restarts, **Then**
   it is still hidden: a display preference is not run state and `007`'s restart does not
   reset it.
5. **Given** the toggle key, **When** the binding table is inspected, **Then** the key is
   declared in one table beside `004`'s interact bindings and `007`'s weapon-select keys,
   and no call site maps that key itself.
6. **Given** `npm run smoke`, **When** `tools/smoke-checks/crosshair.mjs` runs, **Then** it
   asserts the diagnostics are published, the gap orders correctly across the three weapons,
   the gap responds to movement, the draw-call budget holds, and the toggle hides it —
   exiting non-zero and naming the failed condition.
7. **Given** `npm run play`, **When** the agent plays the level, **Then** the record reports
   that the crosshair was present, that its gap changed between standing still and moving,
   and that a hit mark appeared on a frame a guard was hit — read from `__diag`, not from
   the video.
8. **Given** the playtest assertions fail, **When** the record is written, **Then** they are
   reported as soft criteria: a crosshair that did not react is a shortfall in the report,
   not a failed playthrough, because `009` fixed the hard criteria as completion and errors.

### Edge Cases

- A weapon whose `maxSpreadRadians` is retuned in `007`'s table: the reticle follows with no
  edit in this spec, and the ordering assertion in US2-S1 is what catches a retune that
  breaks the pistol-tighter-than-SMG-tighter-than-chaingun ordering.
- The viewport resized to an extreme aspect ratio, or to a zero dimension during a window
  drag: the reticle stays centred and the arm length stays finite; a zero-height viewport
  produces no NaN in the published gap.
- A shot fired on the same frame the weapon switches: the recoil belongs to the weapon that
  actually fired, since `007` resolves no shot during the switch delay.
- The toggle pressed on the frame a hit mark ignites: the mark is not drawn, and it is not
  queued to appear when the crosshair is shown again.
- `__diag.combat` absent because combat has not published yet on the first frame: the
  reticle draws at its resting gap rather than throwing, and `hudReady`-style source
  checking reports the gap's sources as undefined until they exist.
- A counter that jumps by more than one in a frame (a chaingun burst resolving several
  hits): one mark ignites, not several stacked.
- `009`'s runner reaching a level where no guard is hit before the exit: the hit-mark
  assertion reports "not observed" rather than failing, since it cannot distinguish a
  broken crosshair from a playthrough that never shot anything.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The crosshair geometry and spread modules MUST import neither `three` nor any
  DOM API, MUST take gap, viewport, weapon spread, speed and elapsed time as arguments
  rather than globals, and MUST be exercisable under `npm run test`.
- **FR-002**: The reticle SHALL be drawn entirely from code-defined strokes — no image file,
  no font, no glyph table — in keeping with Constitution II's prohibition on binary assets.
- **FR-003**: The crosshair SHALL render on its own screen-space quad, centred in the
  viewport and distinct from `007`'s HUD bar quad, remaining centred with arms of constant
  pixel length across viewport resizes and aspect-ratio changes.
- **FR-004**: The crosshair SHALL render over `008`'s post-processing chain at or above
  `HUD_RENDER_ORDER`, so no post effect blooms, blurs or colour-grades the reticle.
- **FR-005**: A `window.__diag.crosshair` object SHALL publish at least the current gap,
  the hidden flag and whether its sources are defined, additively over the `001`–`009`
  diagnostics contract with no existing field renamed, removed or repurposed.
- **FR-006**: `window.__diag.drawCalls` MUST remain below 20 with the crosshair, HUD,
  view-model, muzzle flash and post chain all rendering.
- **FR-007**: The resting gap SHALL be derived from the active weapon's `maxSpreadRadians`
  as declared in `007`'s weapon table, read through that table rather than restated, such
  that no value from it appears as a literal in this spec's modules.
- **FR-008**: The gap SHALL increase monotonically with `__diag.player.speed` up to a
  declared ceiling that no movement speed exceeds.
- **FR-009**: Each shot that leaves the barrel SHALL add a declared recoil amount to the gap
  on that frame, decaying smoothly toward the resting gap thereafter.
- **FR-010**: Gap evolution SHALL be driven by accumulated elapsed seconds rather than by
  frames, such that the same sequence stepped at 1 ms and at 250 ms deltas produces gaps
  differing by at most a declared tolerance, and SHALL settle within a declared tolerance of
  the resting gap after a declared settle time with no movement and no fire.
- **FR-011**: A hit mark SHALL ignite on the frame `__diag.combat.hits` rises and decay to
  nothing within a declared duration.
- **FR-012**: A kill mark SHALL ignite on the frame `__diag.combat.kills` rises, SHALL be
  visually distinct from the hit mark rather than a brighter variant of it, and SHALL take
  precedence when both counters rise on one frame.
- **FR-013**: No mark SHALL ignite while `__diag.run.state` is not `playing` or the player
  is dead, any active mark SHALL be cleared when either becomes true, and a counter rising
  by more than one in a frame SHALL ignite exactly one mark.
- **FR-014**: A declared key SHALL toggle the crosshair between shown and hidden in both
  directions, declared in one binding table with no call site mapping that key itself, and
  the resulting preference SHALL survive `007`'s restart unchanged.
- **FR-015**: A hidden crosshair SHALL cost no draw call — `window.__diag.drawCalls` with it
  hidden MUST be no higher than with it shown.
- **FR-016**: `tools/smoke-checks/crosshair.mjs` SHALL assert the published diagnostics, the
  resting-gap ordering across the three weapons, the gap's response to movement, the
  draw-call budget and the toggle, exiting non-zero and naming the condition that failed.
- **FR-017**: `009`'s playtest runner SHALL report, as soft criteria in its record, that the
  crosshair was present, that its gap differed between standing and moving, and whether a
  hit mark was observed — never as hard criteria, which `009` fixed as completion and
  errors.

### Key Entities

- **ReticleGeometry**: the pure stroke set for a given gap and arm length — four segments
  symmetric about the origin, the whole visual definition of the reticle.
- **SpreadState**: `{gap, recoil, weapon, settledFor}` — the evolving gap and what is
  currently opening it, stepped by elapsed seconds.
- **FeedbackMark**: `{kind, remaining}` where kind is `none`, `hit` or `kill`. The one
  active mark, ignited by a counter rising and decaying on its own clock.
- **CrosshairDiagnostics**: the `window.__diag.crosshair` object, additive over `001`–`009`.
- **CrosshairBindings**: the declared toggle key, in one table beside `004`'s interact
  bindings and `007`'s weapon-select keys.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: `npm run test` includes at least 12 passing assertions over reticle geometry,
  resting-gap ordering, movement response, recoil decay, frame-rate independence and mark
  precedence.
- **SC-002**: The three resting gaps order strictly pistol < SMG < chaingun, asserted
  directly against values read from `007`'s weapon table rather than restated.
- **SC-003**: No literal from `007`'s `WEAPON_TABLE` appears in any module this spec adds,
  asserted by the same scan `weapons.test.ts` already performs on importers.
- **SC-004**: One simulated second of movement and fire produces gaps within a declared
  tolerance whether stepped at 1 ms or 250 ms deltas.
- **SC-005**: `window.__diag.drawCalls` is below 20 with every surface rendering, and is no
  higher with the crosshair hidden than with it shown.
- **SC-006**: `npm run smoke` exits 0 with `tools/smoke-checks/crosshair.mjs` discovered and
  passing, having asserted every condition FR-016 names.
- **SC-007**: Zero binary asset files exist in the tree after this spec lands — the reticle
  and both marks are drawn from code.
- **SC-008**: `npm run play` writes a record whose soft criteria include the three crosshair
  observations FR-017 names, each with its measured value.
- **SC-009**: Every branch of the mark state machine — `none`, `hit`, `kill`, and the
  cleared-on-death path — is produced by at least one test.

## Assumptions

- `007-combat-hud` and `008-polish` have landed on `main`: the weapon table with its
  `maxSpreadRadians`, the combat diagnostics with `hits` and `kills`, the HUD with its
  render order, and the post-processing chain the reticle must draw over.
- `009-playtest-uat` US1 has landed on `main`, merged as PR #52 — `tools/play.mjs`,
  `tools/play/{driver,navigate,combat,nav-entry}` and `tools/serve.mjs` are all present
  there, and `npm run play` is a declared script. FR-017 extends that runner, so **US4 has
  no unmet prerequisite**. US2, US3 and US4 of `009` remain unbuilt and are not required
  here.
- `009` US2–US4 are *not* required. FR-017 adds soft criteria to the runner US1 already
  ships; it does not need the objective set, the recorder or the verdict module.
- The reticle's colour, arm length, recoil amount, decay durations, movement ceiling and
  settle time are tuning values this spec requires to be declared in one place and does not
  fix here — they belong in a constants module, the way `005`'s lighting rig was specified.
- No gameplay value changes. Shot resolution, spread sampling, damage and ammo accounting
  are `007`'s and are read, never rewritten: a reticle that changed where bullets went
  would be a different spec.
- The toggle key is not yet chosen; it must not collide with `004`'s `Space`/`KeyE` interact
  bindings or `007`'s `Digit1`–`Digit3` weapon selects.

## Work Graph

```yaml
US1:
  depends_on: []
  implements: [FR-001, FR-002, FR-003, FR-004, FR-005, FR-006]
US2:
  depends_on: [US1]
  implements: [FR-007, FR-008, FR-009, FR-010]
US3:
  depends_on: [US2]
  depends_on_merged: [US1]
  implements: [FR-011, FR-012, FR-013]
US4:
  depends_on: [US3]
  depends_on_merged: [US2]
  implements: [FR-014, FR-015, FR-016, FR-017]
```

`depends_on` alone would leave the two `depends_on_merged` edges to be *inferred* from the
file overlap in tasks.md — the deriver spots that US3 and US1 both write
`src/systems/crosshair/register.ts` and adds the edge itself, because it does not compute
the transitive closure of `depends_on`. Declared here instead, so the ordering survives an
edit to tasks.md that changes which files a story's slice names. They are not redundant with
`depends_on`: that orders *dispatch*, while these wait for the earlier story to actually
**land**, which is what a story amending an unmerged story's file needs.
