---
state: ready
---

# Feature Specification: Project Scaffold and Render Harness

**Feature Branch**: `001-scaffold`

**Created**: 2026-08-29

**Status**: Draft

**Input**: Milestone M0 of the Wolfenstein-style FPS brief. Establishes the build
toolchain, the WebGPU-or-WebGL renderer that never goes black, the frame-loop and
diagnostics contract every later spec reads from, and the headless smoke harness that
is this repository's only objective evidence that the game runs rather than merely
compiles.

## Clarifications

### Session 2026-08-29

- Q: What decides whether a node passes, given a browser game has no pytest suite? → A: Three declared gates — `typecheck`, `build`, and a headless-Chromium smoke run that fails on any console error or uncaught exception and reads back `window.__diag`. Compiling is not passing.
- Q: Does the WebGL fallback need to be exercised by the gates? → A: Yes, one smoke pass with `navigator.gpu` removed. An untested fallback path is how a project ships a renderer nobody has seen work.
- Q: Who owns `window.__diag`? → A: This spec, exclusively. Later specs extend it additively; they never redefine an existing field's meaning.
- Q: Is the perf overlay shipped or dev-only? → A: Shipped and always visible in development builds; toggled off with a key binding rather than compiled out, so the toggle itself is testable.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Clean clone runs with no manual steps (Priority: P1)

As an operator, I clone this repository, run `npm install && npm run dev`, and a lit
3D scene appears in my browser — no configuration, no asset download, no environment
variables, no manual step beyond the two commands.

**Why this priority**: Nothing else in the project can be built or verified before the
toolchain exists. Every other spec assumes it.

**Independent Test**: From a fresh clone with an empty `node_modules`, run
`npm install && npm run build`; assert exit 0 and that `dist/` contains a loadable
page. Then confirm no binary asset files exist anywhere in the tree.

**Acceptance Scenarios**:

1. **Given** a clean clone of this repository, **When** `npm install` then
   `npm run dev` are run with no other step, **Then** the dev server starts and serves
   a page that initializes without error.
2. **Given** a clean clone, **When** `npm run build` is run, **Then** it exits 0 and
   emits `dist/index.html` plus its bundled assets.
3. **Given** the repository at any commit from this story forward, **When** the tree
   is searched for files with extension `png`, `jpg`, `jpeg`, `gif`, `webp`, `mp3`,
   `wav`, `ogg`, `glb`, `gltf`, `fbx`, `ttf` or `woff`, **Then** none exist.
4. **Given** `tsconfig.json`, **When** read, **Then** `strict` is `true`.
5. **Given** the dependency manifest, **When** read, **Then** the only runtime
   dependencies are `three` and what Vite requires; every other package is a
   devDependency.

---

### User Story 2 - Renderer selection never yields a black screen (Priority: P1)

As a player on either a WebGPU-capable or a WebGL-only browser, the game renders,
because renderer selection happens before scene construction and its result is
reported rather than assumed — with no async init race that can leave the canvas empty.

**Why this priority**: A black canvas compiles perfectly and passes a type check, so
this is the single most common silent failure in the project. It must be structurally
impossible, not merely avoided carefully.

**Independent Test**: Load the built page headlessly twice — once normally, once with
`navigator.gpu` deleted before any script runs — and assert each pass renders a frame
on its intended backend with no console error.

**Acceptance Scenarios**:

1. **Given** a browser where `navigator.gpu` exists, **When** the page loads, **Then**
   the active renderer backend is reported as `webgpu`.
2. **Given** a browser where `navigator.gpu` is absent, **When** the page loads,
   **Then** the active renderer backend is reported as `webgl` and the scene renders.
3. **Given** either pass, **When** the first frame completes, **Then** at least one
   draw call was issued and no error was written to the console.
4. **Given** the initialization sequence, **When** inspected, **Then** renderer
   selection resolves before any scene construction begins, and there is exactly one
   code path that starts the frame loop.
5. **Given** renderer creation throws (device lost at startup, context unavailable),
   **When** the page loads, **Then** a human-readable failure message is rendered into
   the document body naming the failed backend, rather than an empty canvas or an
   uncaught exception.

---

### User Story 3 - Diagnostics contract and headless smoke harness (Priority: P1)

As the verification system, I read objective facts about a running game from
`window.__diag`, so that "it renders at speed" is a checkable assertion rather than a
human looking at a screen.

**Why this priority**: This is the acceptance instrument for all seven remaining
specs. Without it, no story in this project can be verified by machine.

**Independent Test**: Run `npm run smoke` against the built page and assert it exits 0
on a working build; then introduce a deliberate runtime error behind a flag and assert
the harness exits non-zero citing it.

**Acceptance Scenarios**:

1. **Given** the running page, **When** `window.__diag` is read, **Then** it is an
   object with at least these fields: `ready` (boolean, true once the first frame has
   completed), `renderer` (`"webgpu"` or `"webgl"`), `fps` (number, frames per second
   over a trailing window), `frameTimeMs` (number), `drawCalls` (integer), and
   `errors` (array of strings).
2. **Given** the running page, **When** 60 frames have elapsed, **Then** `ready` is
   true and `fps` is greater than 0.
3. **Given** an uncaught exception or a `console.error` at any point after load,
   **When** `window.__diag.errors` is read, **Then** it contains that error's message;
   the page attaches its own handlers so browser-side failures reach the harness.
4. **Given** `npm run smoke`, **When** run against the built page in headless
   Chromium, **Then** it exits 0 if and only if: the page loaded, `ready` became true
   within 15 seconds, `renderer` is one of the two allowed values, `fps` exceeds a
   floor declared in the harness source, and `errors` is empty.
5. **Given** a page that throws during startup, **When** `npm run smoke` runs,
   **Then** it exits non-zero and prints the captured error message.
6. **Given** the running page, **When** the viewport is resized, **Then** the renderer
   drawing buffer matches the new size within one frame and no error is recorded.
7. **Given** the running page, **When** the overlay toggle key is pressed, **Then**
   the on-screen performance overlay hides or shows, and `window.__diag` continues to
   update while it is hidden.

---

### Edge Cases

- WebGPU present but adapter request fails (no compatible device) → fall back to
  WebGL and report `renderer: "webgl"`, recording the fallback reason in
  `DECISIONS.md`-independent diagnostics rather than crashing.
- Browser blocks pointer lock or audio at load → neither is used by this spec; startup
  must not depend on a user gesture.
- `npm run build` succeeds but produces a page that throws immediately → the smoke
  gate catches this; the build gate alone must never be treated as passing a story.
- Headless Chromium without GPU access → the harness runs with SwiftShader enabled and
  the FPS floor is declared in one place so software-rendering runs can be told apart
  from genuine regressions by changing that single constant.
- Dev server port already in use → Vite's own port-increment behaviour applies; the
  smoke harness builds and serves rather than depending on a developer's `npm run dev`.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The project MUST build with Vite, TypeScript in strict mode, and three.js,
  such that `npm install` followed by `npm run dev` works from a clean clone with no
  manual steps, configuration, or environment variables.
- **FR-002**: The repository MUST contain no binary asset files (`.png`, `.jpg`,
  `.jpeg`, `.gif`, `.webp`, `.mp3`, `.wav`, `.ogg`, `.glb`, `.gltf`, `.fbx`, `.ttf`,
  `.woff`) at any path, at every commit.
- **FR-003**: The application MUST select `WebGPURenderer` when `navigator.gpu` exists
  and `WebGLRenderer` otherwise, resolving that choice before scene construction
  begins, with a single code path that starts the frame loop.
- **FR-004**: The application MUST render a human-readable message naming the failed
  backend if renderer creation throws, rather than leaving an empty canvas or throwing
  uncaught.
- **FR-005**: The application MUST expose `window.__diag` containing at least `ready`,
  `renderer`, `fps`, `frameTimeMs`, `drawCalls`, and `errors` with the types given in
  US3-S1, updated every frame after the first.
- **FR-006**: The application MUST install handlers for `window.onerror` and
  `console.error` that append to `window.__diag.errors`.
- **FR-007**: The application MUST keep the renderer drawing buffer matched to the
  viewport across window resize without recording an error.
- **FR-008**: The application MUST display an on-screen overlay showing FPS and
  frametime, toggleable by a key binding, with `window.__diag` continuing to update
  while it is hidden.
- **FR-009**: An `npm run smoke` script MUST drive the built page in headless Chromium
  and exit non-zero unless the page loaded, became ready within 15 seconds, reported an
  allowed renderer, exceeded the declared FPS floor, and recorded no errors; it MUST
  print captured error output when it fails.
- **FR-010**: `npm run test` MUST run a vitest suite that executes modules free of DOM
  and three.js imports, providing at least one passing placeholder test so the gate is
  live from this spec forward.
- **FR-011**: The scripts `typecheck`, `build`, `test`, `smoke` and `dev` MUST all
  exist in the dependency manifest, matching the names declared in `factory.yaml`.

### Key Entities

- **Diagnostics (`window.__diag`)**: the runtime contract — `ready`, `renderer`, `fps`,
  `frameTimeMs`, `drawCalls`, `errors`. Owned by this spec; extended additively by
  later specs, never redefined.
- **RendererBackend**: `"webgpu" | "webgl"` — the outcome of capability selection,
  reported rather than assumed.
- **SmokeHarness**: headless driver that builds, serves, loads, waits on `ready`,
  asserts the diagnostics invariants, and exits with a status.
- **PerfOverlay**: on-screen FPS/frametime readout, toggleable, decoupled from
  `__diag` updates.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A clean clone reaches a rendered frame with `npm install && npm run dev`
  and no other human action, verified from a scratch directory.
- **SC-002**: Both renderer backends are exercised by the smoke gate on every node
  verification (WebGPU pass and WebGL-fallback pass), each reporting its expected
  backend.
- **SC-003**: A deliberately introduced startup exception causes `npm run smoke` to
  exit non-zero, demonstrated once and kept as a harness self-test.
- **SC-004**: Zero binary asset files exist in the repository at any commit, enforced by
  a check that runs inside the smoke gate.
- **SC-005**: The empty lit scene holds an FPS reading at or above the harness floor on
  the target hardware with the overlay visible.

## Assumptions

- Node.js 20+ and npm are available on the build host (verified present: v20.19.4).
- Playwright's Chromium download is acceptable as a devDependency; it is tooling, not a
  game asset, and does not violate FR-002.
- Headless Chromium can use SwiftShader for software rendering when no GPU is exposed
  to the browser process.
- The target of 120+ fps at 1440p on an RTX 5080 is a property of the finished game;
  this spec sets the harness floor low enough that software rendering passes, so the
  gate measures "is the loop running", not "is the GPU fast today".
- Later specs (`002`–`008`) extend `window.__diag` with their own fields; they rely on
  this spec's contract being stable.

## Work Graph

```yaml
US1:
  depends_on: []
  implements: [FR-001, FR-002, FR-011]
US2:
  depends_on: [US1]
  implements: [FR-003, FR-004, FR-007, FR-008]
US3:
  depends_on: [US2]
  implements: [FR-005, FR-006, FR-009, FR-010]
```
