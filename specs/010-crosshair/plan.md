# Implementation Plan: Crosshair, Spread Feedback and Hit Confirmation

**Branch**: `010-crosshair` | **Date**: 2026-09-03 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/010-crosshair/spec.md`

## Summary

Put a reticle at the centre of the viewport, make its gap the accuracy the player actually
has at that instant, and mark the frame a shot connects. Four stories, seventeen functional
requirements, and no change to what a bullet does.

Two ideas carry this spec. The first is that **the gap is derived, never authored**. `007`
already declares `maxSpreadRadians` per weapon — 0.012 for the pistol, 0.115 for the
chaingun — and already enforces that ordering with a test. A reticle that picked its own
three widths would be a second, silent tuning table that agrees with the first only until
someone retunes a weapon. So the resting gap is a function of the weapon table's own value,
read through `weaponFor()`, and `weapons.test.ts`'s existing scan of every importer for a
repeated literal is what holds that line. FR-007 and SC-003 exist to make that scan bind on
this spec's modules too.

The second is that **the feedback watches counters, not events**. `007`'s muzzle flash
already establishes the shape: the HUD system holds `lastShotsFired` and ignites the flash
when the counter moves, so a trigger held while dead or empty lights nothing, because a
counter that does not move is not a shot. The hit and kill marks are the same mechanism
against `hits` and `kills`. No new event bus, no callback from combat into the HUD, and
nothing for a second listener to be attached to.

The spec is confined to five new pure modules, one new system, one smoke check and one
addition to `009`'s runner. It adds no dependency, no seam and no gameplay value.

## Technical Context

**Language/Version**: TypeScript 5.x `strict` for the game modules; Node.js 20+ ESM for the
smoke check and the playtest addition, both already inside `tsconfig.json`'s include.

**Primary Dependencies**: None added. `three` is already the renderer, the reticle is a
`CanvasTexture` on a `PlaneGeometry` exactly as `007`'s HUD bar is, and the smoke check
runs inside the harness `001` built. Constitution I is untouched.

**Storage**: None. The toggle preference lives in module state for the session; nothing is
written to disk or to browser storage, because `007`'s restart is the only persistence
boundary this spec has an opinion about and FR-014 states that opinion directly.

**Testing**: Every decision in this spec is a pure function and gets a failing test first —
reticle geometry from a gap, resting gap from a weapon, gap evolution from speed and
elapsed seconds, and the mark state machine from rising counters. What is left for the
browser is compositing and draw-call accounting, which is what `tools/smoke-checks/crosshair.mjs`
reads back from `__diag`. The third surface, `009`'s runner, is not a gate and cannot be one.

**Target Platform**: The shipped browser bundle, plus the existing headless smoke harness,
plus an operator's display for the playtest.

**Project Type**: Single-project browser application. No backend, no API.

**Performance Goals**: The reticle costs one draw call and must not raise
`__diag.drawCalls` to 20 (FR-006), and must cost zero when hidden (FR-015). No per-frame
allocation: the stroke set is recomputed into a reused buffer, since this runs every frame
at order 92 and `005` already established that per-frame map derivation is the cost that
matters on this project.

**Constraints**: Zero binary assets (Constitution II) — the reticle and both marks are
strokes, which is the same constraint `007` solved for HUD glyphs and portraits and the
reason this spec needs no new answer to it. No source file over 400 lines
(Constitution IV) — the work is split across five small modules by job, none of which
approaches it. Draw calls under 20 (`002`, preserved by `005`, `007` and `008`) — this spec
spends the budget's next unit and FR-006 makes that an acceptance criterion rather than an
assumption.

**Scale/Scope**: Four stories as a diamond — US1 founds, US2 and US3 run concurrently on
disjoint concerns, US4 reports on both. Every story amends a module an earlier one created
rather than authoring a new subsystem, which is the shape the engine is fastest at.
Seventeen functional requirements, each implemented by exactly one story.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Article | Bearing on this spec | Status |
|---|---|---|
| I. Stack is fixed | No dependency added. The reticle uses the `CanvasTexture`-on-a-quad approach `007`'s HUD already ships; the diagnostics extend the object `001` owns. | PASS |
| II. Zero binary assets | The reticle, the hit mark and the kill mark are stroked from code. No image, no font, no glyph table — the same answer `007` gave for HUD text, for the same reason. | PASS |
| III. Test-first, smoke-tested always | Geometry, resting gap, spread evolution and the mark state machine are DOM-free and three.js-free, and get failing tests first. The browser half is asserted by a discovered smoke check. **This spec weakens no gate**: it adds a check to `npm run smoke` rather than exempting anything from it, and the one surface that is not a gate (`009`'s runner) contributes soft criteria only, which FR-017 states explicitly. | PASS |
| IV. File size ceiling (400) | Five modules by job — geometry, spread, feedback, constants, bindings — plus one system that composites them. None approaches the ceiling; `src/hud/compose.ts` at 152 lines is the closest comparable and this is smaller work. | PASS |
| V. Prefer editing to authoring | US1 authors; US2, US3 and US4 each amend `src/systems/crosshair/register.ts` and add one pure module beside it, rather than introducing a system apiece. The weapon spread, the hit and kill counters, the player speed, the run state and the restart hook are all read from what `003`, `007` and `008` already publish — nothing is recomputed. The one thing genuinely new is the reticle itself, which has no existing home. | PASS |
| VI. Original work only | The reticle is four strokes and two marks, generated from declared constants. No asset, no trademarked shape, no copied art. | PASS |
| VII. Every task ends green and committed | All gates exist. Every task ends with `npm run typecheck`, `npm run build`, `npm run test` and `npm run smoke` green. | PASS |
| VIII. Design forks decided, not asked | The reacting-not-static reticle, the derived-not-authored gap, the own-quad decision, the over-the-post-chain render order, the toggle-only configurability and the soft-criteria playtest are each decided in spec.md's Clarifications and each get a line in `DECISIONS.md`. The tuning values US1 must declare are the remaining forks and T003 decides them. | PASS |

## Project Structure

### Documentation (this feature)

```text
specs/010-crosshair/
├── spec.md              # The feature specification
├── plan.md              # This file
├── tasks.md             # Task breakdown
└── workgraph.json       # Ergane's compiled node graph
```

### Source Code (repository root)

```text
src/hud/
├── crosshair.ts             # [US1] Pure geometry: a gap and an arm length in, four
│                            #   symmetric stroke segments out. No three, no DOM.
├── crosshair-constants.ts   # [US1] Every tuning value in one file — arm length, colour,
│                            #   stroke weight, the gap scale applied to the weapon's
│                            #   spread, the movement ceiling, the recoil amount, the decay
│                            #   and settle times, the mark durations. The 005 lighting-rig
│                            #   pattern: retuning is one edit in one file.
├── crosshair-diag.ts        # [US1] The `__diag.crosshair` interface, its field list for
│                            #   the harness to check against, and the publisher. The
│                            #   combat-diag.ts pattern, additive over 001–009.
├── crosshair-spread.ts      # [US2] The gap stepper: weapon, speed and elapsed seconds in,
│                            #   the next gap out. Pure, so frame-rate independence and the
│                            #   settle behaviour are unit-tested rather than watched.
├── crosshair-feedback.ts    # [US3] The mark state machine: counters and run state in, the
│                            #   one active mark out. Pure.
└── crosshair-bindings.ts    # [US4] The toggle key, declared once, in the shape
                             #   src/interaction/bindings.ts already uses.

src/systems/crosshair/
└── register.ts              # [US1, amended by US2/US3/US4] The render edge, order 92 —
                             #   after the HUD at 90 so it composites the same frame's
                             #   values, before the stats screen at 95. Builds the quad,
                             #   draws the strokes, publishes the diagnostics. 001's glob
                             #   discovery finds it, so neither main.ts nor diag.ts is
                             #   edited by any story here.

tests/unit/
├── crosshair.test.ts          # [US1] Geometry and diagnostics shape.
├── crosshair-spread.test.ts   # [US2] Ordering, movement, recoil, settling, dt-independence.
└── crosshair-feedback.test.ts # [US3] Mark precedence, decay, cleared-on-death.

tools/
├── smoke-checks/crosshair.mjs # [US4] Discovered by the runner; no wiring needed.
└── play/crosshair.mjs         # [US4] The three soft observations 009's record reports.
```

### Structure Decision

**Its own quad, not the HUD's.** `007` composites the whole HUD into one 1280×160 canvas on
one quad pinned to the bottom of the view, and `fitQuad()` sizes it from the camera FOV so
it spans the viewport width. A centred reticle whose arms must stay a constant pixel length
cannot ride that geometry: it would stretch with the bar. It also must not, because the
crosshair changes every frame while the HUD bar changes only when a readout does — `007`
already guards that with a `signature` string and skips the composite when nothing moved.
Putting a per-frame element on that canvas would defeat the optimisation it was given. So
the crosshair takes the budget's next draw call, and FR-006 makes the resulting count an
assertion rather than a hope.

**Order 92, between the HUD and the stats screen.** The reticle reads `__diag.combat` and
`__diag.player`, published at 70 and 75, and its marks must reflect *this* frame's counters
— the same reason `007` put the HUD at 90. It goes after the HUD rather than before so the
two composite in a defined order, and before the stats screen at 95, which draws over
everything when the run ends.

**Pure modules per story, one system amended by all four.** The split is deliberate and it
is the same one `009` used: browser on one side, decision on the other. Every question this
spec has an interesting answer to — what gap does a chaingun rest at, does the gap settle,
which mark wins when a shot both hits and kills — is a pure function of declared inputs, so
it is answered under `npm run test` against real values from `007`'s weapon table rather
than by looking at the screen. `register.ts` is left with compositing and nothing else, and
each story amends it rather than adding a system, which is the edit-over-author shape the
engine is measurably faster at.

**The binding lives beside the others, not inside the system.** FR-014 requires one table.
`004` put the interact keys in `src/interaction/bindings.ts` and `007` put the weapon
selects in `weapons.ts`; a third table in `src/hud/crosshair-bindings.ts` follows that grain
rather than reaching into either, and keeps the key resolvable in a test with no
`KeyboardEvent`.

## Complexity Tracking

| Deviation | Why it is necessary | Simpler alternative rejected because |
|---|---|---|
| A second screen-space quad, spending a draw call against a 20-call budget | The reticle must stay centred with constant-pixel arms and must update every frame; `007`'s HUD quad is bottom-pinned, viewport-spanning, and deliberately skips recompositing when its signature is unchanged. | Compositing the reticle onto the HUD canvas would stretch it with the bar and would force a full 1280×160 recomposite every frame, trading one draw call for continuous canvas work — a worse deal on the axis `005` established matters. |
| Five modules for what could be one file | Constitution IV's ceiling, and concurrency: US2 and US3 dispatch together, so they need surfaces they can each own outright. `crosshair-spread.ts` and `crosshair-feedback.ts` are exactly that split, which is what leaves `register.ts` as their only contended file. | One `crosshair.ts` holding geometry, spread, feedback and bindings would approach the ceiling and would force US2 and US3 to serialise — the parallelism this graph is shaped to get would be given away by the file layout. |
| A tuning-constants module for values that could be inline | Eight of this spec's numbers are pure taste — arm length, colour, recoil amount, decay times — and taste gets retuned. `005` already paid for this lesson with its lighting rig. | Inlining them puts a retune in three files and makes "what does this reticle actually do" a search rather than a read. |
| Adding to `009`'s runner while `009` itself is unfinished | The operator asked for the playthrough as a verification surface, and the runner's US1 — on `main` since PR #52 — already drives real input, which is all FR-017 needs. | Waiting for `009` US2–US4 would block this spec on an epic it does not depend on. Depending on US1 alone costs nothing: it is landed, and T023 adds a call to it rather than restructuring it. If `009` US2–US4 land first, `tools/play.mjs` will have moved and T023 must adapt to it rather than the reverse. |
