# Implementation Plan: Project Scaffold and Render Harness

**Branch**: `001-scaffold` | **Date**: 2026-08-29 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-scaffold/spec.md`

## Summary

Stand up the toolchain and the verification instrument the other seven specs assume:
a Vite + TypeScript(strict) + three.js project that runs from a clean clone in two
commands, a renderer that resolves WebGPU-or-WebGL *before* scene construction and
reports which it got, a `window.__diag` contract that makes "it renders" machine-
checkable, and a headless-Chromium smoke harness that is this repository's only
objective evidence the game runs rather than merely compiles.

The load-bearing idea is US2's: a black canvas type-checks and builds cleanly, so
renderer selection is made structurally impossible to get wrong (one resolution point,
one frame-loop entry, a rendered error message on failure) rather than carefully
avoided.

## Technical Context

**Language/Version**: TypeScript 5.x, `strict: true`, targeting ES2022; Node.js 20+ on
the build host (v20.19.4 verified present).

**Primary Dependencies**: `three` is the only runtime dependency (Constitution I).
Everything else — Vite, TypeScript, vitest, Playwright — is a devDependency (US1-S5).

**Storage**: N/A. No persistence in this spec.

**Testing**: `vitest` for DOM-free, three.js-free logic modules (FR-010). Playwright-
driven headless Chromium for the smoke gate (FR-009). Both gates must be live from
this spec forward, so `npm run test` ships with at least one real passing test rather
than an empty suite.

**Target Platform**: Evergreen desktop browsers, WebGPU where available and WebGL
otherwise. Headless Chromium with SwiftShader for CI/gate runs.

**Project Type**: Single-project browser application. No backend, no API.

**Performance Goals**: The finished game targets 120+ fps at 1440p. **This spec
deliberately does not.** The harness FPS floor is declared as one named constant, set
low enough that a software-rendered SwiftShader pass clears it, so the gate measures
"is the frame loop running" and not "is the GPU fast today" (SC-005, Assumptions).

**Constraints**: Zero binary assets anywhere in the tree, at every commit
(Constitution II, FR-002) — every texture, glyph and sound is generated from code. No
source file over 400 lines (Constitution IV). Startup must not depend on a user
gesture. No async init race that can leave the canvas empty.

**Scale/Scope**: Three stories, one strictly ordered chain (US1 → US2 → US3). This
spec creates `src/` and wires all three gates; every other spec in the repository
fails until it lands.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Article | Bearing on this spec | Status |
|---|---|---|
| I. Stack is fixed | Vite + TS strict + three.js, `WebGPURenderer`/`WebGLRenderer`. No engine, no physics lib, no ECS, no second renderer. | PASS — the spec *is* this article |
| II. Zero binary assets | FR-002 and SC-004 enforce it; a check runs inside the smoke gate | PASS |
| III. Test-first, smoke-tested always | Logic modules DOM-free and three.js-free so they run under vitest; render-loop facts verified through `__diag` | PASS |
| IV. File size ceiling (400) | Diagnostics, renderer selection, overlay and harness are separate modules by design | PASS |
| V. Prefer editing to authoring | Not applicable — this is the one spec with nothing to edit | N/A, by construction |
| VI. Original work only | No id Software data; nothing rendered here but an empty lit scene | PASS |
| VII. Every task ends green and committed | The three gates exist only after US3; see the sequencing note below | PASS with caveat |
| VIII. Design forks decided, not asked | `DECISIONS.md` exists and states its format | PASS |

**Sequencing caveat on Article VII.** The constitution requires `typecheck`, `build`,
`test` and `smoke` to pass after every task, but `smoke` does not exist until US3 and
`test` does not exist until US1 creates the manifest. Within this spec only, a task is
green when every gate that *exists at that point* passes. This is the bootstrap
exception; from 002 onward the full set applies with no exception.

## Project Structure

### Documentation (this feature)

```text
specs/001-scaffold/
├── spec.md              # The feature specification
├── plan.md              # This file
├── tasks.md             # Task breakdown (/speckit-tasks output)
└── workgraph.json       # Ergane's compiled node graph (ergane spec derive)
```

### Source Code (repository root)

```text
src/
├── main.ts              # Single entry: selects renderer, then builds scene, then starts the loop
├── renderer/
│   ├── select.ts        # navigator.gpu capability check -> RendererBackend; no scene knowledge
│   └── create.ts        # Builds the chosen renderer; throws a typed failure the entry renders
├── diag/
│   ├── diag.ts          # window.__diag contract: ready, renderer, fps, frameTimeMs, drawCalls, errors
│   └── handlers.ts      # window.onerror + console.error -> __diag.errors
├── overlay/
│   └── perf.ts          # FPS/frametime readout, key-toggled, decoupled from __diag updates
└── scene/
    └── empty.ts         # The lit scene this spec renders; later specs replace its contents

tests/
└── unit/                # vitest: DOM-free, three.js-free modules only

tools/
├── smoke.mjs            # Builds, serves, drives headless Chromium, asserts __diag invariants
├── smoke-floor.mjs      # THE single declared FPS floor constant (Edge Cases, SC-005)
└── check-no-binaries.mjs # FR-002/SC-004 enforcement, invoked by the smoke gate

index.html               # Vite entry
vite.config.ts
tsconfig.json            # strict: true (US1-S4)
package.json             # scripts: dev, build, typecheck, test, smoke (FR-011)
```

**Structure Decision**: Single-project layout. The split above is not decoration — it
is what makes US2 structurally sound and Article III satisfiable. `renderer/select.ts`
takes a capability object and returns a backend with no three.js import, so the
selection rule is unit-testable under vitest; `diag/diag.ts` is likewise pure state.
Everything that can only exist inside the render loop is verified through `__diag` by
the smoke harness instead. The FPS floor lives in its own module because the spec
requires it be changeable in exactly one place.

## Complexity Tracking

*No Constitution violations to justify.* One environmental constraint is recorded here
because it changes how a task must be written, not because it violates an article:

| Constraint | Why it matters | Consequence for tasks |
|---|---|---|
| Playwright's browser download does not survive the build sandbox | The spec's Assumptions accept "Playwright's Chromium download … as a devDependency", which is true for a developer but **not** for an Ergane node: each node gets a factory-owned `HOME` on tmpfs, so a browser fetched during `npm install` is discarded before the smoke gate runs, and re-downloaded on every attempt at best. | The smoke harness MUST accept an externally provided browser — honour `PLAYWRIGHT_BROWSERS_PATH` / `CHROME_PATH` and fail with a clear message naming the missing browser rather than silently attempting a download. The browser itself has to be present in the execution image; installing it from a gate is not a supported path. |
