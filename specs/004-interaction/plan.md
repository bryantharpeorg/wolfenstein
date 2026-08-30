# Implementation Plan: Doors, Keys and Secrets

**Branch**: `004-interaction` | **Date**: 2026-08-30 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/004-interaction/spec.md`

## Summary

Put state into the level. `D` tiles stop being decorative wall and become a pure door
state machine — `closed`, `opening`, `open`, `closing` — advanced by accumulated
seconds rather than by frame count; silver and gold keys become an inventory that a
locked door consults and *names* when it refuses; `S` tiles become push-walls that slide
two tiles and stay open forever. Every interact command resolves to one of an enumerated
set of outcomes, and those outcomes reach `window.__diag.interaction` so "every door and
secret in the level works" is a headless assertion rather than a playtest.

The load-bearing idea is US1's: the door is a **pure state machine that never sees a
frame**. It takes elapsed milliseconds and returns state; the render layer reads that
state and moves a mesh. That is what makes eight of US1's nine acceptance scenarios
testable at all under vitest, and it is the pattern 006's guard AI reuses — a door that
animates by mutating `mesh.position` inside the render loop is untestable by
construction, and the milestone would then rest on someone watching a screen.

The second structural idea is inherited, not invented: 001-scaffold landed a system
registry (`src/boot/registry.ts` + glob discovery in `src/boot/discover.ts`), so a story
adds behaviour by creating `src/systems/<name>/register.ts` and editing **no shared
file**. This spec uses it for all three stories. `src/main.ts` is not edited by any task
in this plan.

## Technical Context

**Language/Version**: TypeScript 5.x, `strict: true`, ES2022. Node.js 20+ on the build
host.

**Primary Dependencies**: `three` remains the only runtime dependency (Constitution I).
This spec adds none — a door state machine, a key inventory and a push-wall are
arithmetic, not a physics problem.

**Storage**: N/A. Door, key and secret state is in-memory for the session; nothing
persists across a reload.

**Testing**: `vitest` carries the weight here. The door machine, the neighbour rule, the
crush test, the key inventory, the lock decision, the secret travel model and both new
`validateLevel()` rules are DOM-free and three.js-free, so all of them are written
test-first (Constitution III). Only mesh placement and event binding are left to the
smoke harness reading `window.__diag.interaction`.

**Target Platform**: Evergreen desktop browsers; headless Chromium with SwiftShader for
the gate run.

**Project Type**: Single-project browser application, per 001's structure decision.

**Performance Goals**: No new per-frame cost of note. Stepping N doors and M secrets is
O(N+M) over small integers; the door meshes are added to the scene once at setup and
moved, never rebuilt, so 002's draw-call budget (`__diag.drawCalls < 20`) is unaffected.

**Constraints**: Zero binary assets (Constitution II) — door and secret meshes are
geometry with 002's flat-colour materials, key pickups are generated geometry, and the
"which key do you want" feedback is text, not an icon file. No source file over 400 lines
(Constitution IV). Interact is bound to `Space` and `E` through **one** command path
(FR-005), so a second handler is a defect, not a convenience.

**Scale/Scope**: Three stories in a strict chain (US1 → US2 → US3), 38 tasks. Nine new
pure modules under `src/interaction/`, three new systems under `src/systems/`, two new
`validateLevel()` rules, and one additive `__diag` object. One line is added to
`src/level.ts` (002's file) and one to 003's player system; nothing else outside this
spec's own directories is touched.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Article | Bearing on this spec | Status |
|---|---|---|
| I. Stack is fixed | No physics library for door sweeps or crush tests — a door is a scalar `progress` and an AABB overlap, both hand-written. No new dependency. | PASS |
| II. Zero binary assets | Doors, keys and secrets are geometry and flat colour; refusal feedback is text. Nothing here wants a sprite. | PASS |
| III. Test-first, smoke-tested always | The whole point of the spec's shape: nine pure modules, all written test-first; only mesh motion and key binding go through `__diag` and the smoke gate. | PASS — this spec is the article's best case |
| IV. File size ceiling (400) | `door.ts`, `door-field.ts`, `secret.ts`, `secret-field.ts`, `keys.ts`, `locks.ts` are deliberately separate rather than one `interaction.ts` that would blow the ceiling by US3. | PASS |
| V. Prefer editing to authoring | The systems seam and the `rules/` glob mean this spec adds files instead of editing shared ones — which is the *inverse* of this article's letter and the point of its spirit. See Complexity Tracking. | PASS with note |
| VI. Original work only | Doors that slide into the wall, two key colours, and two-tile push-walls are the genre's grammar, not id Software's data. Layout, timings and geometry are this project's own. | PASS |
| VII. Every task ends green and committed | All four gates exist from 001 and are live. No bootstrap exception applies here; every task ends with `typecheck`, `build`, `test` and `smoke` green. | PASS |
| VIII. Design forks decided, not asked | Five forks were closed in the spec's Clarifications (interact binding, key retention, crush behaviour, secret idempotence, purity). Two more are closed below in Complexity Tracking and belong in `DECISIONS.md` when they land. | PASS |

**Note on Article V.** This spec creates 14 files and edits 2. That looks like authoring
rather than editing, and it is deliberate. 001's `src/boot/registry.ts` documents why:
two logically independent stories that both edit one wiring file collide in the merge
queue, and Ergane prices that collision as a defect against whichever node lands second.
Article V's purpose is speed, and a rejected node is not fast. The rule this plan follows
is: **edit within a story, create across a story boundary.**

## Project Structure

### Documentation (this feature)

```text
specs/004-interaction/
├── spec.md              # The feature specification
├── plan.md              # This file
├── tasks.md             # Task breakdown (/speckit-tasks output)
└── workgraph.json       # Ergane's compiled node graph (ergane spec derive)
```

### Source Code (repository root)

```text
src/
├── main.ts              # UNCHANGED by this spec. Bootstrap only; systems self-register.
├── level.ts             # 002's. One line added by US2: call the extra-rule collector.
├── interaction/         # New. Pure: no DOM, no three.js, all vitest-runnable.
│   ├── outcomes.ts      # [US1] The complete InteractOutcome union, declared once (FR-006)
│   ├── params.ts        # [US1] Travel duration, dwell, max delta step, secret distance
│   ├── door.ts          # [US1] The state machine: closed/opening/open/closing + progress
│   ├── crush.ts         # [US1] Does this door's travel volume intersect the player capsule?
│   ├── door-field.ts    # [US1] Builds doors from `D` tiles; axis, neighbour rule, adjacency
│   ├── bindings.ts      # [US1] Space | E -> one interact command (FR-005)
│   ├── gate-registry.ts # [US1] Refusal hooks a later story registers instead of editing door.ts
│   ├── open-state.ts    # [US1] Providers of currently-passable tiles, read by 003's collider
│   ├── interaction-diag.ts # [US1] The __diag.interaction shape and its updaters
│   ├── keys.ts          # [US2] Key inventory: counts per kind, retained on use
│   ├── pickups.ts       # [US2] Key pickup consumption, idempotent
│   ├── locks.ts         # [US2] Lock decision -> locked-missing-key naming the kind
│   ├── level-rules.ts   # [US2] Glob collector for rules/, called once from src/level.ts
│   ├── secret.ts        # [US3] Push-wall travel, monotonic found flag, blocked-geometry
│   ├── secret-field.ts  # [US3] Builds secrets from `S` tiles; counters, walkability
│   └── rules/           # Extra validateLevel() rules, discovered by glob — no index to edit
│       ├── key-placement.ts    # [US2] FR-011
│       └── secret-placement.ts # [US3] FR-014
└── systems/             # 001's seam: one directory per story, discovered by glob
    ├── doors/register.ts    # [US1] Door meshes, keydown -> command, per-frame step
    ├── keys/register.ts     # [US2] Pickup meshes, collection, registers the lock gate
    └── secrets/register.ts  # [US3] Secret meshes, per-frame step, counters into __diag

tests/unit/              # vitest; one file per story-owned concern, no shared test file
├── door-state.test.ts, door-field.test.ts, interact-bindings.test.ts, door-crush.test.ts   # US1
├── key-inventory.test.ts, locked-door.test.ts, key-placement.test.ts,
│   interact-outcome-set.test.ts                                                            # US2
└── secret-push.test.ts, secret-counters.test.ts, secret-blocked.test.ts,
    secret-placement.test.ts, interaction-diag-shape.test.ts                                # US3

tools/
└── smoke.mjs            # [US3] Gains the FR-018 interaction assertions
```

**Structure Decision**: `src/interaction/` holds pure logic; `src/systems/` holds the
three.js and DOM edges. That split is not stylistic — it is the line between what vitest
can execute and what only the smoke harness can observe, and every module lands on the
side that makes its acceptance scenarios checkable. The story-per-system-directory rule
means US1, US2 and US3 write disjoint file sets: no two stories in this spec write the
same file, which is what keeps Ergane's contention check green and the merge queue quiet.

Three seams exist so that a later story can add behaviour to an earlier story's module
without editing it:

- **`gate-registry.ts`** — `door.ts` asks its registered gates before opening. US1
  registers the crush gate (FR-015); US2 registers the lock gate (FR-009) from its own
  system file. `door.ts` is written once, in US1, and never reopened.
- **`open-state.ts`** — a registry of "which tiles are passable right now" providers.
  003's collider already takes open state as an argument (003 FR-007), so US1 wires it in
  at 003's single call site and registers the door provider; US3 registers the secret
  provider (US3-S7) without touching that wiring again.
- **`interaction/rules/`** — `validateLevel()` gains extra rules by file discovery, the
  same `import.meta.glob` trick `src/boot/discover.ts` uses. US2 adds `key-placement.ts`
  and the single call site in `src/level.ts`; US3 adds `secret-placement.ts` and edits
  nothing.

## Complexity Tracking

*No Constitution violations to justify.* Four decisions are recorded here because each
one changes how a task must be written:

| Constraint | Why it matters | Consequence for tasks |
|---|---|---|
| `src/main.ts` is the file every spec wants to edit | It owns the render loop, so "step the doors each frame" reads as a `main.ts` change. 001 anticipated this and landed the system registry precisely to stop it; `tests/unit/systems-discovery.test.ts` asserts `main.ts` names no individual system. | **No task in this spec edits `src/main.ts`.** Per-frame door and secret stepping happens in `update(ctx, deltaMs)` inside each story's own `src/systems/<name>/register.ts`. A task that reaches for `main.ts` has taken the wrong seam. |
| `interaction-diag.ts` declares FR-017's *whole* field set in US1, though FR-017 is US3's | `window.__diag.interaction` is one object with one shape. If US1 declared three fields and US3 added five, US3 would be editing US1's module — the exact contention this layout exists to avoid, and a type-level one that `tsc` would surface as a merge conflict. | US1's T014 declares every FR-017 field with a zero/null default and the updater functions that write them. US2 and US3 **call** those updaters from their own systems; neither reopens the file. US3's FR-017 work is populating the secret counters and proving additivity over 001's and 002's contracts (T031, T036). |
| Player position is read from `__diag.player`, not from 003's internals | Door adjacency (`no-target`), the crush test (FR-015) and secret push direction all need the player's `x`/`z`. 003's module layout is not knowable from here, but 003 FR-014 *guarantees* `__diag.player` carries `x`, `z`, `yaw`, `pitch`, `speed`, `stuck`. | Systems read the player through `ctx.diag.player` — the declared cross-spec contract — rather than importing a 003 path this spec would be guessing at. If 003 lands an exported player-state module, prefer it; the diag object is the surface that is promised. Pure modules never read it at all: `crush.ts` and `door-field.ts` take position as an argument. |
| Two stories must both extend `validateLevel()` (FR-011 key-placement, FR-014 secret-placement) | A single `validateLevel()` edited by US2 and again by US3 is a same-file, cross-story write — the contention checker refuses it, and a static import list in a collector module conflicts on adjacent lines just as readily. | US2 creates `src/interaction/level-rules.ts` with `import.meta.glob('./rules/*.ts', { eager: true })` and adds the **one** call line to `src/level.ts`. US3 adds `rules/secret-placement.ts` as a new file and edits neither. The glob needs `/// <reference types="vite/client" />` in the collector, as `src/boot/discover.ts` already does, and stays vitest-runnable because vitest transforms through Vite. |
