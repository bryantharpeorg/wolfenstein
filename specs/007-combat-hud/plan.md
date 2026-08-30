# Implementation Plan: Weapons, Combat Loop and HUD

**Branch**: `007-combat-hud` | **Date**: 2026-08-30 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/007-combat-hud/spec.md`

## Summary

Close the loop `001`–`006` set up. Three weapons declared in one table, fired through one
command path gated by elapsed seconds, resolved by a pure hitscan against `002`'s grid,
`004`'s door state and `006`'s guard list. Player health that `006`'s falloff-computed
guard damage actually reduces, a `dead` state, and a restart that puts the run back to
spawn values in place — no page reload. Pickups instantiated from `002`'s item markers and
collected by walking. A HUD whose every glyph and portrait is stroked from a code-defined
table because Constitution II forbids a font file.

The load-bearing idea is that almost all of this is arithmetic. Weapon tuning, fire-rate
gating, spread, the ray walk, ammo accounting, damage clamping, the reset itself and the
pickup effects are pure functions over declared tables, so Article III's test-first rule
applies to the bulk of the spec rather than to a corner of it. Only four thin systems —
input binding, damage application, proximity collection, HUD compositing — live inside the
render loop, and each is verified through `window.__diag.combat` instead.

The second load-bearing idea is structural: **no story in this spec edits `src/main.ts`.**
`001` landed a system registry (`src/boot/registry.ts` plus a glob in `src/boot/discover.ts`)
precisely so that a story adds `src/systems/<name>/register.ts` and nothing shared. Four
stories each add exactly one such file. Every other new file is a pure module that only its
own story writes.

## Technical Context

**Language/Version**: TypeScript 5.x, `strict: true`, ES2022 — unchanged from `001`.

**Primary Dependencies**: `three` remains the only runtime dependency (Constitution I).
This spec adds none. No physics library for the hitscan: the ray walk is a cell-stepping
DDA over the grid, the same shape `006` uses for line-of-sight, and guard hit boxes are a
declared radius around a grid position (Assumptions, Constitution I).

**Storage**: N/A. Run state is in-memory and reset in place by the restart command; nothing
is persisted across a page load, and restart deliberately does not reload the page.

**Testing**: `vitest` over `src/combat/*.ts` and `src/hud/glyphs.ts`, `portrait.ts`,
`flash.ts` — all DOM-free and three.js-free (FR-001, Article III). Everything that only
exists inside the render loop is asserted through `window.__diag.combat` by
`tools/smoke.mjs`, which this spec extends to drive the whole loop once: fire, hit, take
damage, die, restart (FR-019, SC-001).

**Target Platform**: Unchanged — evergreen desktop browsers, WebGPU where available and
WebGL otherwise; headless Chromium with SwiftShader for the gate.

**Project Type**: Single-project browser application.

**Performance Goals**: No new frame-time target. The one budget this spec must not breach
is `__diag.drawCalls < 20` with the HUD, the weapon view-model and the muzzle flash all
rendering (FR-018, SC-006) — the budget `002` set and `005` preserved. The HUD is therefore
composited into **one** canvas-2D texture drawn as a single screen-space quad, not as a
mesh per readout.

**Constraints**: Zero binary assets at every commit (Constitution II, SC-007) — this is the
constraint that shapes US4 entirely: no `.ttf`, no `.woff`, no sprite image, and no reliance
on a named system font family either, because a system font renders differently in headless
Chromium than on the target machine and would make the HUD assertions unstable
(Clarifications). No source file over 400 lines (Constitution IV), which is why the combat
logic is six modules rather than one. `window.__diag` is extended additively and no
`001`–`006` field is renamed, removed or repurposed (FR-018).

**Scale/Scope**: Four stories in one strictly ordered chain (US1 → US2 → US3 → US4), as the
spec's `## Work Graph` declares. Fourteen new source modules, four new systems, eight new
test files, and one extension to `tools/smoke.mjs`.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Article | Bearing on this spec | Status |
|---|---|---|
| I. Stack is fixed | No physics or collision library for the hitscan — a cell-stepping ray over the existing grid, and guard hit boxes as a declared radius (Assumptions). No new dependency at all. | PASS |
| II. Zero binary assets | The defining constraint of US4: HUD glyphs from a code-defined stroke/segment table, face portraits drawn at load time, muzzle flash from code. `tools/check-no-binaries.mjs` from `001` already fails the gate on `ttf`/`woff` (SC-007). | PASS |
| III. Test-first, smoke-tested always | Six of the ten logic modules are pure and get a failing test first. The four systems are render-loop-only and are verified through `__diag.combat` by the smoke harness, whose assertion surface US4 extends (FR-019). | PASS |
| IV. File size ceiling (400) | Weapons, spread, hitscan, fire control, vitals, score, restart, pickups, pickup effects, glyphs, portrait, flash, compose and view-model are separate modules by design, not by taste. | PASS |
| V. Prefer editing to authoring | `src/combat/pickups.ts` is grown across four tasks rather than split per effect; `tools/smoke.mjs` is extended, never replaced. New files are created only where a shared one would become a contention point. | PASS |
| VI. Original work only | No id Software sprite, sound, HUD layout or naming. The glyph table, the portraits and the weapon view-models are original procedural geometry and strokes. | PASS |
| VII. Every task ends green and committed | All four gates exist and are live from `001`. No bootstrap exception applies here — every task in this spec ends with `typecheck`, `build`, `test` and `smoke` green. | PASS |
| VIII. Design forks decided, not asked | Seven forks are already closed in the spec's Clarifications (ray origin, seeded spread, elapsed-time gating, weapons held from spawn, glyph source, restart scope, treasure optional). Anything further gets one line in `DECISIONS.md`. | PASS |

**No sequencing caveat.** Unlike `001`, every gate this spec is measured by already exists.

## Project Structure

### Documentation (this feature)

```text
specs/007-combat-hud/
├── spec.md              # The feature specification
├── plan.md              # This file
├── tasks.md             # Task breakdown (/speckit-tasks output)
└── workgraph.json       # Ergane's compiled node graph (ergane spec derive)
```

### Source Code (repository root)

Files marked `US1`–`US4` are created or written by exactly one story. Nothing in this tree
is written by two different stories.

```text
src/
├── main.ts                      # UNCHANGED by this spec — see the Structure Decision below
├── boot/
│   ├── registry.ts              # UNCHANGED — defineSystem/collectSystems, the seam every story uses
│   └── discover.ts              # UNCHANGED — globs src/systems/*/register.ts, so no index to append to
├── diag/
│   └── diag.ts                  # UNCHANGED — `combat` is attached by module augmentation, not by editing this file
├── combat/
│   ├── weapons.ts               # US1  The one WeaponTable: interval, damage, spread, cost, capacity, range
│   ├── spread.ts                # US1  Seeded PRNG -> spread vector, same shape as 006's guard PRNG
│   ├── hitscan.ts               # US1  Ray from camera centre vs grid/doors/guards -> ShotResult
│   ├── fire-control.ts          # US1  Elapsed-time gating, ammo accounting, switch delay, one command path
│   ├── run-state.ts             # US1  The single gate on whether player commands resolve
│   ├── combat-diag.ts           # US1  The whole FR-018 CombatDiagnostics shape + the __diag augmentation
│   ├── vitals.ts                # US2  PlayerVitals: MAX_HEALTH, damage clamped at zero, the dead transition
│   ├── score.ts                 # US2  The one ScoreTable and the monotonic-within-a-run accumulator
│   ├── restart.ts               # US2  Reset registry, resetRun(), and the run-state snapshot restart is judged by
│   ├── reset-adapters.ts        # US2  Registers 002/004/006 state resets without editing those specs' files
│   ├── pickups.ts               # US3  Instantiation from 002's item markers, radius collection, consume-once
│   └── pickup-effects.ts        # US3  Health/ammo/treasure/key effects with clamping and surplus discard
├── hud/
│   ├── glyphs.ts                # US4  Code-defined stroke/segment glyph table — the answer to "no font file"
│   ├── portrait.ts              # US4  Health bands -> portrait index, portraits drawn from code at load time
│   ├── flash.ts                 # US4  Pure muzzle-flash intensity and decay, driven by resolved shots
│   ├── compose.ts               # US4  Draws the whole HUD into one canvas texture (one draw call)
│   └── viewmodel.ts             # US4  The weapon view-model mesh and its fire motion; never a ray origin
└── systems/
    ├── combat/register.ts       # US1  Binds Ctrl/LMB/1/2/3, steps fire-control once per frame, traces the ray
    ├── vitals/register.ts       # US2  Applies 006's damage, drives death and restart, publishes vitals to __diag
    ├── pickups/register.ts      # US3  Per-frame proximity collection; registers its own reset with US2's registry
    └── hud/register.ts          # US4  Composites HUD, view-model and flash; sets hudReady; holds drawCalls < 20

tests/unit/
├── combat-purity.test.ts        # US1  Import-graph assertion: no `three`, no DOM, arguments not globals
├── weapons.test.ts              # US1
├── spread.test.ts               # US1
├── hitscan.test.ts              # US1
├── fire-control.test.ts         # US1
├── vitals.test.ts               # US2
├── restart.test.ts              # US2
├── pickups.test.ts              # US3
├── pickup-effects.test.ts       # US3
├── hud-glyphs.test.ts           # US4
├── portrait.test.ts             # US4
└── flash.test.ts                # US4

tools/
└── smoke.mjs                    # US4 ONLY  Drives fire -> hit -> damage -> death -> restart and deep-compares
```

**Structure Decision**: Single-project layout, extended along the seams `001` actually
landed rather than the ones its spec imagined.

Three of those seams do all the work here:

1. **`src/systems/<name>/register.ts` instead of `src/main.ts`.** `src/main.ts` owns the
   render loop and calls `system.update(ctx, deltaMs)` on everything `collectSystems()`
   returns; `src/boot/discover.ts` finds systems by `import.meta.glob`, so a new system
   requires no edit to any shared file — not `main.ts`, not an index. This spec's four
   stories each add one system file and edit no other story's file. `src/main.ts` is not in
   this spec's diff at all.

2. **TypeScript module augmentation instead of editing `src/diag/diag.ts`.**
   `src/combat/combat-diag.ts` declares the complete `CombatDiagnostics` shape FR-018 lists
   *and* augments the `Diagnostics` interface with an optional `combat` field from inside
   its own file. `src/diag/diag.ts` is untouched, which matters twice over: it is the file
   `002`–`006` are each extending too, and it would otherwise be the contention point that
   `src/main.ts` used to be.

3. **A reset registry instead of a god-object restart.** FR-011 requires restart to reset
   doors and secrets (`004`), guards (`006`) and the player spawn (`002` / `003`) — state
   this spec does not own. `src/combat/restart.ts` exposes `registerResettable(name, fn)`
   and `resetRun()`; `src/combat/reset-adapters.ts` registers the adapters for other specs'
   exported state APIs, and US3 registers its own pickup reset from its own system file. So
   US2 writes a restart that resets pickups without knowing what a pickup is, and US3 makes
   pickups resettable without editing `restart.ts`.

The pure/impure split is the same one Article III asks for and `001` established: every
tuning table, every clamp and every state transition is a function of its arguments, and the
systems are thin enough that what they add is binding and publishing, not deciding.

## Complexity Tracking

*No Constitution violations to justify.* Four cross-spec couplings are recorded here because
each changes how a task must be written:

| Constraint | Why it matters | Consequence for tasks |
|---|---|---|
| FR-010 requires movement commands to stop resolving on death, but movement belongs to `003` | This spec cannot own `003`'s movement system, and editing it would put a `007` diff into another spec's file. | `src/combat/run-state.ts` (US1) is the single gate on whether player commands resolve. US2 flips it on death and back on restart. If `003`'s movement system does not already consult a gate, the one-line consultation added to it is the only file this spec edits outside its own tree, and it belongs to **US2 alone** — no other story may touch it. |
| FR-011 resets doors, secrets, keys and guards, which `004` and `006` own | A restart that reaches into another spec's internals is both a contention risk and a correctness risk when that spec's shape changes. | US2 confines every cross-spec reset to `src/combat/reset-adapters.ts`, calling those specs' exported state APIs. When an API needed for a reset does not exist, the task raises it rather than reaching past the module boundary. |
| FR-018 lists the whole `__diag.combat` field set, but the fields are produced by all four stories | If each story added its own fields, all four would edit one file and Ergane's contention checker would refuse the spec. | US1 declares the **complete** shape in `src/combat/combat-diag.ts` with zeroed defaults (T011). US2, US3 and US4 write values into fields that already exist; none of them edits that file. US4 still owns FR-018's *assertion* — that every field is present and no `001`–`006` field was renamed — in `tools/smoke.mjs`. |
| SC-002's snapshot equality names an exemption set that `008` will grow | A restart-exempt set hard-coded at each comparison site becomes a merge conflict the moment `008` adds `completions`. | US2 exports the exempt set (`deaths`, `restarts`, elapsed wall-clock) as one named constant beside `snapshotRunState()` in `src/combat/restart.ts`; US4's smoke assertion reads it rather than restating it, so `008` adds one entry in one place (spec Assumptions). |
