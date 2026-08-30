---
description: "Task list for 001-scaffold: Project Scaffold and Render Harness"
---

# Tasks: Project Scaffold and Render Harness

**Input**: Design documents from `/specs/001-scaffold/`

**Prerequisites**: plan.md (required), spec.md (required for user stories)

**Tests**: Included. Constitution Article III requires test-first for DOM-free logic,
and FR-010 requires the vitest gate to be live from this spec forward.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to
- Exact file paths are given in every description

## Path Conventions

Single project. `src/`, `tests/`, `tools/` at repository root, per plan.md.

## Bootstrap exception

The constitution requires all gates green after every task, but the gates do not exist
until the tasks below create them. Within this spec, a task is green when every gate
that exists *at that point* passes. From 002 onward the full set applies.

---

## Phase 1: User Story 1 - Clean clone runs with no manual steps (Priority: P1) 🎯 MVP

**Goal**: Two commands from a clean clone produce a running dev server and a building
project, with strict TypeScript, no binary assets, and every gate script named.

**Independent Test**: From a fresh clone with empty `node_modules`, `npm install &&
npm run build` exits 0 and `dist/` holds a loadable page; no binary asset files exist.

### Implementation for User Story 1

- [ ] T001 [US1] Create `package.json` declaring `three` as the only runtime dependency and Vite, TypeScript, vitest and Playwright as devDependencies, with the scripts `dev`, `build`, `typecheck`, `test` and `smoke` — the names `ergane.yaml` declares (FR-001, FR-011, US1-S5).
- [ ] T002 [US1] Create `tsconfig.json` with `strict: true` and ES2022 target (US1-S4, FR-001).
- [ ] T003 [P] [US1] Create `vite.config.ts` and `index.html` as the Vite entry, so `npm run dev` serves and `npm run build` emits `dist/index.html` plus bundled assets (US1-S1, US1-S2).
- [ ] T004 [US1] Create `src/main.ts` as the single entry point that mounts a canvas and does nothing else yet — later stories fill it in; it must import cleanly under `npm run typecheck`.
- [ ] T005 [P] [US1] Write the failing test first, then implement: `tools/check-no-binaries.mjs` walks the tree and exits non-zero if any file matches `png|jpg|jpeg|gif|webp|mp3|wav|ogg|glb|gltf|fbx|ttf|woff`; cover it in `tests/unit/check-no-binaries.test.ts` (FR-002, US1-S3, SC-004).
- [ ] T006 [P] [US1] Add `tests/unit/placeholder.test.ts` — one real passing assertion over a DOM-free module — so `npm run test` is a live gate from this task forward (FR-010).
- [ ] T007 [US1] Create `.gitignore` entries for `node_modules/` and `dist/`, and confirm `npm install && npm run build` exits 0 from a scratch clone (US1-S1, US1-S2, SC-001).

**Checkpoint**: `npm install`, `npm run dev`, `npm run build`, `npm run typecheck` and `npm run test` all work. `npm run smoke` does not exist yet.

---

## Phase 2: User Story 2 - Renderer selection never yields a black screen (Priority: P1)

**Goal**: The renderer backend is resolved before any scene construction, reported
rather than assumed, and a creation failure renders a readable message instead of an
empty canvas.

**Independent Test**: Load the built page headlessly twice — once normally, once with
`navigator.gpu` deleted before any script runs — and assert each renders a frame on
its intended backend with no console error.

### Tests for User Story 2

> Write these first and confirm they fail before implementing.

- [ ] T008 [P] [US2] `tests/unit/select.test.ts`: given a capability object with and without `gpu`, `selectBackend` returns `"webgpu"` / `"webgl"`. Pure input-to-output, no three.js import, so it runs under vitest (US2-S1, US2-S2, Article III).

### Implementation for User Story 2

- [ ] T009 [US2] Implement `src/renderer/select.ts` exporting `type RendererBackend = "webgpu" | "webgl"` and a pure `selectBackend(capabilities)`; it must not import three.js so it stays vitest-runnable (FR-003, US2-S1, US2-S2).
- [ ] T010 [US2] Implement `src/renderer/create.ts` building `WebGPURenderer` or `WebGLRenderer` from the selected backend and throwing a typed failure naming the backend when creation fails (FR-003, FR-004).
- [ ] T011 [US2] Implement `src/scene/empty.ts` — the empty lit scene this spec renders, with at least one mesh so a draw call is issued (US2-S3, SC-005).
- [ ] T012 [US2] Wire `src/main.ts` so renderer selection resolves to completion *before* scene construction begins, with exactly one code path that starts the frame loop and no async init race (FR-003, US2-S4).
- [ ] T013 [US2] In `src/main.ts`, catch the typed creation failure and render a human-readable message naming the failed backend into the document body, instead of an empty canvas or an uncaught exception (FR-004, US2-S5).
- [ ] T014 [US2] Handle the WebGPU-adapter-request-failure edge case: fall back to WebGL, report `renderer: "webgl"`, and record the fallback reason for diagnostics rather than crashing (Edge Cases).

**Checkpoint**: Both backends construct and render. Diagnostics do not exist yet, so this is verified by hand until US3.

---

## Phase 3: User Story 3 - Diagnostics contract and headless smoke harness (Priority: P1)

**Goal**: `window.__diag` makes "it renders at speed" machine-checkable, and
`npm run smoke` is the objective gate that reads it.

**Independent Test**: `npm run smoke` exits 0 against a working build, and exits
non-zero citing the error when a deliberate startup exception is introduced.

### Tests for User Story 3

> Write these first and confirm they fail before implementing.

- [ ] T015 [P] [US3] `tests/unit/diag.test.ts`: the diagnostics state module reports `ready` false before the first frame and true after, computes `fps` over a trailing window, and appends to `errors`. DOM-free and three.js-free (US3-S1, US3-S2, Article III).

### Implementation for User Story 3

- [ ] T016 [US3] Implement `src/diag/diag.ts` owning the `window.__diag` contract — `ready` (boolean), `renderer` (`"webgpu"|"webgl"`), `fps` (number), `frameTimeMs` (number), `drawCalls` (integer), `errors` (string[]) — updated every frame after the first (FR-005, US3-S1, US3-S2).
- [ ] T017 [US3] Implement `src/diag/handlers.ts` installing `window.onerror` and a `console.error` wrapper that append the message to `window.__diag.errors`, so browser-side failures reach the harness (FR-006, US3-S3).
- [ ] T018 [US3] Populate `drawCalls` each frame from the renderer's own render-info counter, and wire `renderer` from the backend US2 selected (FR-005, US2-S3).
- [ ] T019 [US3] Keep the drawing buffer matched to the viewport across window resize within one frame, recording no error (FR-007, US3-S6).
- [ ] T020 [P] [US3] Implement `src/overlay/perf.ts` — an on-screen FPS/frametime overlay, visible in development, hidden and shown by a key binding rather than compiled out, with `__diag` continuing to update while hidden (FR-008, US3-S7).
- [ ] T021 [P] [US3] Create `tools/smoke-floor.mjs` exporting the FPS floor as the single named constant, set low enough that a SwiftShader software-rendering pass clears it (Edge Cases, SC-005).
- [ ] T022 [US3] Implement `tools/smoke.mjs`: build, serve, load the page in headless Chromium, wait up to 15s for `ready`, then assert the renderer is an allowed value, `fps` exceeds the floor from T021, and `errors` is empty — exiting non-zero and printing captured error output otherwise (FR-009, US3-S4, US3-S5).
- [ ] T023 [US3] Make `tools/smoke.mjs` run twice: once normally, and once with `navigator.gpu` deleted before any script runs, asserting each pass reports its expected backend (US2-S1, US2-S2, SC-002).
- [ ] T024 [US3] Have `tools/smoke.mjs` invoke `tools/check-no-binaries.mjs` from T005 so the zero-binary-assets rule is enforced inside the smoke gate (SC-004).
- [ ] T025 [US3] Resolve the browser from `PLAYWRIGHT_BROWSERS_PATH` / `CHROME_PATH` when set, and fail with a message naming the missing browser rather than attempting a download — the build sandbox gives each node a fresh `HOME`, so a browser fetched at install time is not present at gate time (plan.md Complexity Tracking).
- [ ] T026 [US3] Add the harness self-test: a flag that injects a startup exception, demonstrated once to prove `npm run smoke` exits non-zero and prints the message, kept as a regression (SC-003, US3-S5).
- [ ] T027 [US3] Register `npm run smoke` in `package.json` and confirm all four gates — `typecheck`, `build`, `test`, `smoke` — pass together (FR-011, Article VII).

**Checkpoint**: All three gates green. Every later spec in this repository is now buildable.

---

## Dependencies & Execution Order

### User Story Dependencies

Strictly sequential, as declared in the spec's `## Work Graph` block and compiled into
`workgraph.json`:

- **US1** — no dependencies. Creates the manifest, the toolchain and the `test` gate.
- **US2** — depends on US1. Needs `package.json`, `tsconfig.json` and `src/main.ts`.
- **US3** — depends on US2. Needs a rendering page and a known backend to report.

These stories are **not** independently deliverable, and that is intentional: this is
the bootstrap spec. US2 has nothing to render into without US1's toolchain, and US3
has nothing to measure without US2's frame loop.

### Shared files (genuine contention, handled by the ordering above)

- `src/main.ts` — created in T004 (US1), rewired in T012/T013 (US2), extended in T016/T018 (US3)
- `package.json` — created in T001 (US1), gains the smoke script in T027 (US3)

### Parallel Opportunities

Within a story only, on the tasks marked [P]: T003/T005/T006 in US1; T020/T021 in US3.
Nothing crosses a story boundary.

## Notes

- Test-first is mandatory for anything DOM-free and three.js-free (Article III). Everything that can only exist inside the render loop is verified through `__diag` by the smoke harness instead.
- Never weaken a gate to make it pass. A failing gate blocks the commit, not the gate.
- Commit once per task (ergane's inner loop; Article VII).
- No source file over 400 lines (Article IV); split as part of the task that would exceed it.
