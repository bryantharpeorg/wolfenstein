# Implementation Plan: Player Movement and Camera

**Branch**: `003-player` | **Date**: 2026-08-29 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/003-player/spec.md`

## Summary

Put a player inside the level 002 built: a pointer-locked first-person camera whose
mouse look is driven by accumulated raw deltas (so it is identical at 15 fps and 240
fps), a capsule footprint resolved as a grid-swept AABB in bounded substeps that cannot
tunnel through a wall at any delta, and locomotion feel — yaw-relative WASD, sprint, and
a head-bob driven by measured velocity rather than by held keys.

The load-bearing idea is US2's: wall clipping is invisible to a type check and to a
casual playtest because it only appears when frame times spike, so the resolver is a
pure, DOM-free, three.js-free function taking the grid as an argument, and its
correctness is asserted over a generated battery of at least 500 displacement cases
under `npm run test` rather than by walking the map in a browser.

The second structural decision is that **no story in this spec edits `src/main.ts`**.
001 landed the system-registry seam (`src/boot/registry.ts` + `src/boot/discover.ts`):
behaviour is added by creating `src/systems/<name>/register.ts`, discovered by glob, so
there is no wiring file and no index for three stories to collide on. Each story here
adds its own system directory and its own pure modules under `src/player/`.

## Technical Context

**Language/Version**: TypeScript 5.x, `strict: true`, ES2022; Node.js 20+ on the build
host. No new language or toolchain surface.

**Primary Dependencies**: none added. `three` remains the only runtime dependency
(Constitution I) and is imported by the systems, never by `src/player/`'s logic modules.
Explicitly **no physics library** — the collider is hand-written swept-AABB math, per the
spec's Clarifications.

**Storage**: N/A. Mouse sensitivities are runtime constants with declared defaults; no
settings persistence in this or any milestone of the brief.

**Testing**: `vitest` for every module under `src/player/` — look accumulation, the
collision resolver, integration, locomotion and bob are all DOM-free and three.js-free by
construction (Constitution III), including the pointer-lock adapter, which takes its
target and event source as injected parameters so its denial path is unit-testable
without a browser. The `npm run smoke` gate owns what only exists in the running page:
pointer-lock state, the scripted walk across the shipped level, and `__diag.player`.

**Target Platform**: Evergreen desktop browsers; headless Chromium for the gate. Pointer
lock behaviour varies between browsers, so the harness asserts the Chromium contract and
FR-004's denial path covers the rest.

**Project Type**: Single-project browser application, unchanged from 001.

**Performance Goals**: No new per-frame budget is claimed. The work added per frame is a
handful of scalar operations plus at most `ceil(displacement / 0.25)` substeps, bounded
by the delta clamp; the spec's constraint is determinism, not throughput.

**Constraints**: Zero binary assets (Constitution II) — this spec adds none and needs
none, since everything it introduces is math. No source file over 400 lines
(Constitution IV) — the reason the resolver, the integrator and the tile predicate are
three files rather than one. `window.__diag` is extended additively under a `player` key
and no field owned by 001 or 002 is renamed, removed or repurposed (FR-014).

**Scale/Scope**: Three stories in a strict chain (US1 → US2 → US3), as declared in the
spec's `## Work Graph`. This spec depends on `002-map-geometry` having landed, because
US2 collides against `src/level.ts`'s grid and US2's system places the player at that
file's spawn tile and facing yaw; 001 is required transitively through 002.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Article | Bearing on this spec | Status |
|---|---|---|
| I. Stack is fixed | No physics library: the capsule is a circle of radius 0.3 resolved as a swept AABB in hand-written math (Clarifications). three.js is imported only by `src/systems/*/register.ts`. | PASS |
| II. Zero binary assets | Nothing this spec adds is an asset; movement, look and bob are numbers | PASS |
| III. Test-first, smoke-tested always | Every module under `src/player/` is DOM-free and three.js-free and gets its failing test first. Pointer lock is made testable by injecting its target rather than reaching for `document`. Runtime facts go through `__diag.player` and the smoke gate | PASS |
| IV. File size ceiling (400) | `tiles.ts` / `collide.ts` / `integrate.ts` are split at the seams the ceiling would otherwise force later; likewise `locomotion.ts` and `bob.ts` | PASS |
| V. Prefer editing to authoring | The systems seam from 001 is reused as-is rather than reinvented; `src/main.ts`, `src/boot/*` and `src/diag/diag.ts` are all left untouched — `Diagnostics` gains `player` by TypeScript module augmentation from `src/player/diag-player.ts` | PASS |
| VI. Original work only | Movement constants are tuned for this game; no id Software data of any kind | PASS |
| VII. Every task ends green and committed | All four gates exist as of 001; the bootstrap exception is over and the full set applies to every task here | PASS |
| VIII. Design forks decided, not asked | Three forks are pre-decided below and belong in `DECISIONS.md` when hit: the params table's single owner, the `__diag` augmentation route, and the scripted-drive seam the harness uses before US3 exists | PASS |

**Story file ownership (how slice contention is avoided).** Three declaration files are
read by all three stories: `src/player/params.ts` (every named constant — sensitivities,
collider radius, substep size, delta clamp, walk and sprint speed, bob amplitude,
frequency, settle and speed epsilon), `src/player/state.ts` (the `PlayerState` record),
and `src/player/diag-player.ts` (the `window.__diag.player` shape). **US1 creates all
three complete, including the fields US2 and US3 will populate.** US2 and US3 import them
and write their fields at runtime; neither edits them. This is what lets the spec keep
the Key Entities' "declared once so tuning never chases literals across files" without
two stories writing one file.

## Project Structure

### Documentation (this feature)

```text
specs/003-player/
├── spec.md              # The feature specification
├── plan.md              # This file
├── tasks.md             # Task breakdown (/speckit-tasks output)
└── workgraph.json       # Ergane's compiled node graph (ergane spec derive)
```

### Source Code (repository root)

```text
src/
├── main.ts              # UNTOUCHED by this spec — bootstrap only, since 001
├── boot/
│   ├── registry.ts      # UNTOUCHED — the seam this spec adds systems through
│   └── discover.ts      # UNTOUCHED — glob discovery, so no index to append to
├── diag/diag.ts         # UNTOUCHED — `player` is added by module augmentation, not by editing
├── level.ts             # From 002: the 64x64 grid, spawn tile and facing yaw, door-lock table
├── player/              # All DOM-free and three.js-free; the vitest surface of this spec
│   ├── params.ts        # US1 creates. MovementParams: sensitivities (runtime-mutable),
│   │                    #   collider radius 0.3, substep 0.25, delta clamp, eye height,
│   │                    #   walk/sprint speed, bob amplitude/frequency/settle/epsilon
│   ├── state.ts         # US1 creates. PlayerState: x, z, yaw, pitch, speed, sprinting,
│   │                    #   bobOffset, stuck, blocked{n,s,e,w}, desiredVelX/desiredVelZ
│   ├── diag-player.ts   # US1 creates. `ensurePlayerDiag()` + module augmentation of Diagnostics
│   ├── look.ts          # US1. Pure: accumulated mouse delta -> yaw/pitch, pitch clamped ±89°
│   ├── pointer-lock.ts  # US1. DOM adapter with injected target/event source; denial-safe
│   ├── tiles.ts         # US2. Pure: is tile (x,z) blocking, given grid + open-state
│   ├── collide.ts       # US2. Pure: swept AABB per axis -> {position, blockedAxes, stuck}
│   ├── integrate.ts     # US2. Pure: delta clamp + substepping into <=0.25-unit increments
│   ├── drive-hook.ts    # US2. `window.__playerDrive` — the harness's scripted-input seam
│   ├── locomotion.ts    # US3. Pure: key set + yaw + sprint -> desired velocity
│   ├── keyboard.ts      # US3. DOM adapter: keydown/keyup -> key set; injected event source
│   └── bob.ts           # US3. Pure: measured speed + dt -> bob phase and camera-y offset
└── systems/
    ├── player-look/register.ts        # US1. order 30: drains mouse deltas, drives camera rotation
    ├── player-locomotion/register.ts  # US3. order 32: keys -> PlayerState.desiredVel*
    ├── player-body/register.ts        # US2. order 34: spawn placement, integrate, camera x/z
    └── player-bob/register.ts         # US3. order 36: measured speed -> bob -> camera y

tests/unit/             # vitest, one file per module, no story sharing a file
├── look.test.ts                  # US1
├── pointer-lock.test.ts          # US1
├── collide.test.ts               # US2
├── collide-battery.test.ts       # US2 — the >=500 generated cases (SC-002)
├── locomotion.test.ts            # US3
├── bob.test.ts                   # US3
└── player-diag-contract.test.ts  # US3 — additivity over 001 and 002 (FR-014)

tools/
└── smoke.mjs           # US2 only: scripted walk, `stuck` and walkability assertions (FR-015)
```

**Structure Decision**: One module per idea under `src/player/`, and one system directory
per story under `src/systems/`. The split is what makes Article III satisfiable: the
resolver takes `(grid, position, displacement, openState)` and returns a value, so the
500-case battery runs in vitest in milliseconds with no browser, and the door tile
handling M3 will need is a change to the open-state argument rather than to the
signature (FR-007). Four small systems rather than one player system is deliberate too —
ordering matters here (look → intent → body → bob) and `order` numbers make it explicit,
whereas a single system would hide it inside one `update()`.

`src/systems/player-body/register.ts` is the only place that reads `src/level.ts` and the
only place that moves the camera in the horizontal plane; `player-bob` owns camera `y`
and `player-look` owns camera rotation. No two systems write the same camera channel.

## Complexity Tracking

*No Constitution violations to justify.* Three constraints are recorded because each
changes how a task must be written:

| Constraint | Why it matters | Consequence for tasks |
|---|---|---|
| `tools/smoke.mjs` as landed does not drive a browser | 001's plan describes a Playwright-driven harness that waits on `ready` and reads `__diag`, but the file that actually landed only checks for binary assets and the presence of `dist/index.html`. FR-015 and SC-001 require reading `__diag.player` back after scripted movement, which the current harness cannot do. | US2 gets an explicit task to make the harness load the built page in headless Chromium before the task that adds the walk assertion, honouring `PLAYWRIGHT_BROWSERS_PATH` / `CHROME_PATH` and failing with the missing-browser name rather than attempting a download (001 plan, Complexity Tracking). If 002 has already added that pass, the task is a small extension of it rather than a rewrite. |
| The harness must move the player before WASD exists | FR-015 belongs to US2, but keyboard input is US3's slice. A scripted walk driven by synthetic key events cannot exist until US3 lands, which would make US2's own DONE condition unverifiable. | US2 ships `src/player/drive-hook.ts`, a declared `window.__playerDrive(velX, velZ, ms)` seam that writes the same `PlayerState.desiredVel*` fields US3's keyboard will write. It is an input seam for the gate, not a gameplay path, and it keeps working unchanged once US3 lands. Record it in `DECISIONS.md`. |
| `window.__diag.player` must exist from US1, but FR-014 is US3's requirement | US1 needs `pointerLocked` and US2 needs `stuck` on the same object whose full shape FR-014 specifies. Splitting the object's declaration across three stories would put three stories in one file. | US1 declares the complete FR-014 shape zero-initialised in `src/player/diag-player.ts`; US2 and US3 assign values from their own systems. US3's FR-014 work is the assignment of `speed`, `sprinting` and `bobOffset` plus the additivity test — no edit to US1's file. |
