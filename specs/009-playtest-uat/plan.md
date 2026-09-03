# Implementation Plan: Recorded Playthrough as a UAT Artifact

**Branch**: `009-playtest-uat` | **Date**: 2026-09-02 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/009-playtest-uat/spec.md`

## Summary

Add `npm run play`: a headed browser session in which an agent clears the shipped level —
every guard, secret, treasure and key, then the elevator — driven entirely through the
input events the game already binds, recorded to video, and written to disk beside a
two-tier verdict.

Two ideas carry this spec. The first is that **the agent plays rather than scripts**. The
existing gate moves the player with `window.__playerDrive`, and that seam exists for a good
reason — it lets a gate assert a position without waiting for a walk. But it means the one
thing no gate in this repository has ever executed is the input layer a player actually
uses: `keyboard.ts`, `pointer-lock.ts`, `look.ts` and the fire bindings are covered by unit
tests against injected event sources and by nothing at all in a browser. This spec drives
them for real, which is why it needs no new seam and why it verifies something no existing
gate can.

The second is that **the artifact is the point**. Every other verification surface in this
repository answers a machine. This one answers a person: a video they can watch, indexed by
a timeline whose offsets locate each event in it, with a verdict that distinguishes *the
game is broken* from *the run went badly*. That distinction is the two-tier verdict, and it
is what keeps the command worth running — a UAT that fails on the hardest optional
objective is a UAT nobody runs twice.

The spec is confined to `tools/` but for one additive field. No *input* seam is added:
measurements taken on the built page on 2026-09-02 (recorded in spec.md's Clarifications)
established that real key events drive locomotion, that a real click on the canvas is
granted pointer lock, and that synthesized mouse movement under that lock turns the camera,
so the `window.__playerLook` this spec would otherwise have needed does not need to exist.

What `src/` does gain is one *read-only* fact: FR-007 has `src/enemy/world.ts` publish each
guard's position in the diagnostics roster. That is the opposite kind of change from a seam
— Constitution III asks a story to "extend that harness's assertion surface when it needs a
runtime fact it cannot yet report", and this is exactly that: `viewAngle` is a sprite column,
a facing relative to the camera rather than a direction to the guard, so nothing already
published could be turned into a bearing and an agent aiming with a mouse has to aim at
something. Perception is extended; input is not.

## Technical Context

**Language/Version**: Node.js 20+ ESM for the runner (`tools/**/*.mjs`, already inside
`tsconfig.json`'s include). TypeScript 5.x `strict` for the single compiled entry that
re-exports the game's pure navigation modules.

**Primary Dependencies**: `playwright`, already a devDependency and already the gate's
browser driver — the same `chromium` import `tools/smoke.mjs` uses, launched headed rather
than headless. `esbuild` is already present transitively through `vite` and is used to
compile the navigation entry to ESM the runner can import; it adds no dependency to the
game and nothing to the shipped bundle. No new runtime dependency, so Constitution I is
untouched.

**Storage**: One directory in the working tree, replaced per invocation. Nothing is
persisted between invocations and nothing is read back by any other tool.

**Testing**: This spec's own logic that is DOM-free and browser-free — objective derivation
from the level tables, objective ordering against the lock table, verdict computation from
criteria, timeline offset arithmetic, report rendering — is pure and gets failing tests
first under `npm run test`. The browser-driving half is verified by running it: the command
either played the level or it did not, and the recording is the evidence. This spec adds no
smoke check, because a headed run cannot execute in the gate's runtime.

**Target Platform**: An operator's workstation with a display and a GPU. Explicitly not
CI, and explicitly not Ergane's bwrap runtime.

**Project Type**: Tooling for a single-project browser application. No backend, no API, no
change to the shipped bundle.

**Performance Goals**: None asserted. The frame rate the record reports is the game's own
`__diag.fps` and is a soft criterion — measured, reported, never fatal. The recording's
frame rate is the browser's screencast rate and is a different number, which the record
must not conflate.

**Constraints**: Zero binary assets at every commit (Constitution II) — the recordings are
build output in the sense `dist/` is, which is why the output directory is both gitignored
and skipped by `tools/check-no-binaries.mjs`, and why that reading is recorded in
`DECISIONS.md` rather than left to a reader's judgement. No source file over 400 lines
(Constitution IV) — `tools/smoke.mjs` is already past that ceiling and had to be split
after the fact, so this runner is born split across six files. The command must never
become a way around `npm run smoke` (Constitution III): it is absent from `ergane.yaml`,
asserts nothing the gate asserts, and cannot run where the gate runs.

**Scale/Scope**: Four stories. US1 crosses the level and defends itself doing it; US2 turns
crossing into clearing. US1 is the foundation and the only one with real unknowns;
US2 and US3 are independent of each other and both depend only on US1; US4 reports on all
three. Sixteen functional requirements, each implemented by exactly one story.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Article | Bearing on this spec | Status |
|---|---|---|
| I. Stack is fixed | No runtime dependency added. `playwright` is already the gate's driver; `esbuild` already ships inside `vite`. Nothing enters the browser bundle. | PASS |
| II. Zero binary assets | The spec produces video, which is exactly what this article guards against — so the output directory is gitignored *and* skipped by the binary-asset walker, and `.webm`/`.mp4` are added to `.gitignore` so a recording can never be staged even by hand. The walker's forbidden-extension list is deliberately **not** extended, because that would fail the smoke gate on the runner's own output. FR-005 makes "smoke passes with the directory populated" an acceptance criterion. | PASS, with the reading recorded in `DECISIONS.md` |
| III. Test-first, smoke-tested always | Objective derivation, objective ordering, verdict computation, timeline arithmetic and report rendering are DOM-free and get failing tests first. The browser half is verified by the artifact it produces. Crucially this command **weakens no gate**: it is not in `ergane.yaml`, it is not a required check, and it asserts nothing `npm run smoke` asserts. | PASS |
| IV. File size ceiling (400) | Six files under `tools/play/` plus the entry, each with one job — args and orchestration, input driving, navigation, combat, recording and record assembly. None approaches the ceiling. | PASS |
| V. Prefer editing to authoring | The static server and browser resolution already exist inside `tools/smoke.mjs` and are extracted to a shared module rather than copied, so both harnesses resolve a browser the same way. The pathfinder is the game's own, compiled rather than reimplemented. FR-007's guard position is two fields added to a record that already exists, not a new diagnostics slice. What genuinely is new — driving real input, recording, record assembly — has no existing home. | PASS |
| VI. Original work only | Tooling. No game content of any kind. | PASS |
| VII. Every task ends green and committed | All four gates exist. Every task ends with `npm run typecheck`, `npm run build`, `npm run test` and `npm run smoke` green — the last of these run **with the output directory populated**, which is how FR-005's exclusion is proved rather than assumed. | PASS |
| VIII. Design forks decided, not asked | Headed-only, real-input-only, the retry budget, the two-tier verdict and the single replaced output directory are each a decided fork with a line in `DECISIONS.md`. | PASS |

## Project Structure

### Documentation (this feature)

```text
specs/009-playtest-uat/
├── spec.md              # The feature specification
├── plan.md              # This file
├── tasks.md             # Task breakdown
└── workgraph.json       # Ergane's compiled node graph
```

### Source Code (repository root)

```text
tools/
├── serve.mjs            # [US1] EXTRACTED from tools/smoke.mjs: the loopback static
│                        #   server over dist/ and resolveBrowser(). One resolution rule
│                        #   for both harnesses; smoke.mjs imports it and loses the copy.
├── play.mjs             # [US1] The entry `npm run play` runs. Arguments, the build, the
│                        #   display refusal, the attempt loop, and the final swap. Holds
│                        #   no game knowledge: it orchestrates the modules below.
└── play/
    ├── driver.mjs       # [US1] Real input, and nothing else. Pointer-lock acquisition by
    │                    #   a real canvas click, keydown/keyup on the codes the game
    │                    #   binds, mouse movement under lock, fire and weapon selection,
    │                    #   and the frame pacing every command is issued against.
    ├── nav-entry.ts     # [US1] The only TypeScript this spec adds: re-exports the level
    │                    #   tables and the game's own findPath so esbuild can compile one
    │                    #   ESM module the runner imports. Declares nothing itself.
    ├── navigate.mjs     # [US1] Legs. Compiles nav-entry.ts, asks findPath for a route
    │                    #   between two tiles over the live open state, and walks it with
    │                    #   the driver — turn to the bearing, hold forward, watch
    │                    #   __diag.player, stop on arrival or on a declared bound.
    ├── objectives.mjs   # [US2] The objective set derived from the level's own tables, and
    │                    #   its order: keys before the doors their lock entries name,
    │                    #   pickups when a declared threshold is crossed. Pure — no page,
    │                    #   no browser — so it is unit-tested.
    ├── combat.mjs       # [US2] Engaging a guard: bearing from __diag.enemies, turn, pick
    │                    #   a weapon with ammunition, fire through its real binding,
    │                    #   confirm against the kill counter.
    ├── record.mjs       # [US3] The timeline and the console capture: events stamped with
    │                    #   their offset from the attempt's recording start.
    └── verdict.mjs      # [US4] Hard and soft criteria, the verdict they compute, and the
                         #   rendering of result.json and report.md. Pure — unit-tested.

tests/unit/
├── play-objectives.test.ts   # [US2] Derivation and ordering against the shipped level.
├── play-verdict.test.ts      # [US4] Two-tier verdict, retry rule, exit code.
└── play-report.test.ts       # [US4] Report rendering, including the attempt count.

package.json                  # [US1] The `play` script.
.gitignore                    # [US1] The output directory, *.webm, *.mp4.
tools/check-no-binaries.mjs   # [US1] The output directory joins node_modules/dist/.git.
```

### Structure Decision

Everything lives under `tools/`. This spec adds no behaviour to the game, and the strongest
statement it makes is that it did not have to: the measurements in spec.md's Clarifications
exist precisely to justify *not* adding a `window.__playerLook` seam beside
`window.__playerDrive`. A seam added here would have been a second input path that only the
harness uses, and the whole value of the story is that there isn't one.

Two extractions rather than copies. `tools/serve.mjs` takes the loopback server and
`resolveBrowser()` out of `tools/smoke.mjs` so both harnesses find a browser by one rule —
that function already carries hard-won knowledge about `PLAYWRIGHT_BROWSERS_PATH` layouts
(008 T022) and a second copy would drift from it. `tools/play/nav-entry.ts` is compiled
rather than hand-ported so the routes the agent walks come from the same `findPath` the
guards use; a reimplementation in `tools/` would be a copy of a module whose determinism
guarantees are load-bearing and asserted elsewhere.

The split between `navigate.mjs` and `objectives.mjs` is the split between *browser* and
*decision*. Objective derivation and ordering are pure functions of the level tables, so
they are unit-tested against the shipped level and answer US2's "no hardcoded count"
requirement under `npm run test` rather than by inspection. The same split puts
`verdict.mjs` in reach of tests: what makes an attempt pass is a pure function of measured
criteria, and only the measuring needs a browser.

## Complexity Tracking

| Deviation | Why it is necessary | Simpler alternative rejected because |
|---|---|---|
| A build step (esbuild) inside a run command | The runner must route with the game's own `findPath`, and Node 20 cannot import TypeScript. | Reimplementing A* in `tools/` duplicates a module whose determinism is asserted by 006's tests and whose behaviour must match the guards'. Freezing a waypoint table instead rots silently the first time the level moves. |
| A command that no gate runs | Headed rendering cannot execute in the bwrap runtime or on a CI runner, and a headless recording misrepresents the frame rate the artifact exists to show. | Making it headless would let it run in CI at the cost of the artifact being worthless — the gate's FPS floor is 5 because headless rasterizes in software. |
| Video files inside the working tree | The operator asked for the artifact on disk beside the code it describes. | Writing outside the repository breaks the "one command, look in this directory" property the artifact exists for. The exclusion is enforced twice — gitignore and the walker — and asserted by FR-005. |
| Best-of-three attempts | Guards react to a live player on timing this spec does not control, so a single attempt conflates "the game regressed" with "this run went badly". | One attempt makes the command flaky enough to be ignored. The cost — a difficulty regression hiding behind a lucky third attempt — is paid off by FR-016 requiring the attempt count inside the verdict itself. |
