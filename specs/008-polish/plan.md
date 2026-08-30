# Implementation Plan: Elevator Exit, Audio and Post-Processing

**Branch**: `008-polish` | **Date**: 2026-08-30 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/008-polish/spec.md`

## Summary

Close the last edge of the gameplay loop and then make the result presentable. The `E`
tile 002 validated becomes an interactable resolved through 004's one interact command
path, moving a run through `playing → exiting → complete` on the same elapsed-time
interpolation 004 fixed for doors; a stats screen reports the run against counters 004
and 007 already maintain, and restarts through 007's reset rather than a second one;
every sound is built from oscillators, noise buffers and envelopes at runtime because
Constitution II forbids an audio file; and four independently toggleable post effects sit
behind a per-backend fallback.

The load-bearing idea is US1's: a level that cannot be finished has no completion state to
report, no run to summarize and nothing to grade, so the exit lands first and every other
story reads from it. The second load-bearing idea is that two of the four stories are
*allowed to produce nothing*. A silent event and a disabled effect are declared outcomes
recorded in `DECISIONS.md` and in a `fallbacks` array; a black screen and an uncaught
exception are not. That is why US3 and US4 sit last: they can each be reduced to their
fallback without taking the milestone with them.

## Technical Context

**Language/Version**: TypeScript 5.x, `strict: true`, targeting ES2022; Node.js 20+ on the
build host.

**Primary Dependencies**: `three` remains the only runtime dependency (Constitution I).
Post-processing uses the passes that ship *inside* the `three` package — `EffectComposer`
and its passes under `three/examples/jsm/postprocessing/` on the WebGL backend, three's
node-based `PostProcessing` on the WebGPU backend — so US4 adds no dependency. Audio uses
the platform WebAudio API, which is not a dependency either. Nothing here needs an engine,
a physics library or a second renderer.

**Storage**: N/A. `completions` lives in memory for the session and is deliberately not
persisted — no storage layer enters the project for one integer.

**Testing**: `vitest` for the DOM-free, three.js-free modules, which is most of this spec:
the run-state machine, the elevator resolver, the completability check, the stats
projection, the rating table, the sound table, the synthesis math, the voice pool, the
trigger mapping, the post effect state and the frame-cost sampler are all pure. The
headless smoke gate covers what only exists in a browser: `__diag.run` reaching `complete`
on a scripted run, the audio context's state and inventory, and the eight post toggles.

**Target Platform**: Evergreen desktop browsers, WebGPU where available and WebGL
otherwise. Headless Chromium for the gate, which has no user gesture and may have no audio
device at all.

**Project Type**: Single-project browser application. No backend, no API.

**Performance Goals**: With all four effects disabled, `__diag.fps` stays at or above the
floor 001 declared in `tools/smoke-floor.mjs` — this spec must not make the game slower
than it was before it landed. With all four enabled, the cost is *reported* as
`__diag.post.frameCostMs` against the disabled baseline rather than asserted against a
threshold, because the gate's software rasterizer is not the target machine.

**Constraints**: Zero binary assets at every commit (Constitution II) — no `.mp3`, `.wav`,
`.ogg` or `.m4a`, and no `.ttf`, which is why the stats screen reuses 007's code-defined
glyph table rather than introducing a second text renderer. No source file over 400 lines
(Constitution IV), which is why audio and post-processing each arrive as four or five small
modules instead of one file per subsystem. Startup must not await audio. The render loop
must keep running in `complete`.

**Scale/Scope**: Four stories, one strictly ordered chain (US1 → US2 → US3 → US4) as the
spec's `## Work Graph` declares. This is the last spec of the epic; after US1 the game can
be won, after US2 it can be read, and US3 and US4 are refinements over a game that is
already finished.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Article | Bearing on this spec | Status |
|---|---|---|
| I. Stack is fixed | Post-processing comes from inside the `three` package; audio comes from the platform's WebAudio API. No engine, no audio library, no post-processing library. | PASS |
| II. Zero binary assets | The defining constraint of US3: every sound is synthesized from oscillators, noise buffers and envelopes (FR-009). The stats screen reuses 007's stroke glyph table, so no font file either (US2-S5). `tools/check-no-binaries.mjs` currently omits `.m4a`, which FR-009 names — US3 adds it. | PASS, with the `.m4a` gap closed by T035 |
| III. Test-first, smoke-tested always | Run state, elevator resolution, completability, stats projection, rating bands, sound table, synthesis, voice pool, triggers, post state and cost sampling are all DOM-free and three.js-free and get failing tests first. WebAudio glue, the post chain and the composited screens are verified through `__diag` by the smoke harness. | PASS |
| IV. File size ceiling (400) | `src/audio/` splits into table, synth, voice pool, triggers, context and diag; `src/post/` into state, cost, chain, render hook and diag; `src/run/` into state, elevator, gating, completable, stats, rating, completions and diag. None is near the ceiling. | PASS |
| V. Prefer editing to authoring | New behaviour arrives as `src/systems/<name>/register.ts`, which is the seam 001 built precisely so a story adds a file instead of editing a shared one. Editing `src/main.ts`, `src/diag/diag.ts` or `tools/smoke.mjs` from four stories would be the *worse* choice here, not the frugal one — see Structure Decision. | PASS |
| VI. Original work only | The elevator, the rating bands, the synthesized sounds and the effect tuning are original. No id Software layout, sound or naming. | PASS |
| VII. Every task ends green and committed | All four gates exist by this point; there is no bootstrap exception. US2's harness work extends `tools/smoke.mjs` — it must extend the assertion surface, never narrow it. | PASS |
| VIII. Design forks decided, not asked | FR-013 and FR-016 make `DECISIONS.md` load-bearing rather than decorative: a fallback taken is a line appended, and the run continues. | PASS |

## Project Structure

### Documentation (this feature)

```text
specs/008-polish/
├── spec.md              # The feature specification
├── plan.md              # This file
├── tasks.md             # Task breakdown (/speckit-tasks output)
└── workgraph.json       # Ergane's compiled node graph (ergane spec derive)
```

### Source Code (repository root)

```text
src/
├── main.ts              # Bootstrap. ONE line changes here, in US4: the frame's render
│                        #   call is routed through post/render-hook.ts. Nothing else.
├── run/                 # US1 + US2. Pure; no DOM, no three.js.
│   ├── state.ts         # [US1] RunState machine playing|dead|exiting|complete, run timer,
│   │                    #   elevator travel interpolated from accumulated elapsed seconds;
│   │                    #   step() RETURNS the transition it made so later stories observe
│   │                    #   without editing this file
│   ├── elevator.ts      # [US1] Adjacency to the single `E` tile from src/level.ts and the
│   │                    #   declared outcomes exit-used / no-target / already-exiting
│   ├── gating.ts        # [US1] Predicates the guard, damage and fire paths consult so
│   │                    #   `complete` and `dead` stop actors without stopping the loop
│   ├── completable.ts   # [US1] Reachability from spawn to `E` across empty, open-door and
│   │                    #   opened-secret tiles, over 006's pathing
│   ├── stats.ts         # [US2] Projection of 004's and 007's counters into RunStats, with
│   │                    #   the zero-denominator placeholder. Reads counters; owns none.
│   ├── rating.ts        # [US2] The declared rating band table
│   ├── completions.ts   # [US2] The completion counter, exempt from 007's reset
│   └── diag.ts          # [US2] Declares and attaches window.__diag.run, augmenting the
│                        #   Diagnostics interface from THIS file (see Structure Decision)
├── audio/               # US3. Everything but context.ts is pure and vitest-runnable.
│   ├── sound-table.ts   # The single declared inventory: gunfire per weapon, door,
│   │                    #   footstep, drone — duration, envelope and parameters
│   ├── synth.ts         # Oscillator + noise + envelope sample math -> Float32Array.
│   │                    #   Takes a sample rate; constructs no AudioContext.
│   ├── voice-pool.ts    # Voice cap, oldest-first eviction, master gain budget
│   ├── triggers.ts      # Resolved event -> sound id, plus the footstep cadence
│   │                    #   accumulator over distance travelled
│   ├── context.ts       # The only WebAudio-aware file: context created suspended, resumed
│   │                    #   on first gesture, buffers built from synth.ts, fallbacks
│   └── diag.ts          # Declares and attaches window.__diag.audio
├── post/                # US4.
│   ├── state.ts         # Exactly bloom|ssao|motionBlur|filmGrain, their default states and
│   │                    #   tuning constants in ONE place, toggling, and the fallbacks list
│   ├── cost.ts          # Pure sampler: frameCostMs over 120 frames against the baseline
│   ├── chain.ts         # three.js side: builds the chain for the active backend, disables
│   │                    #   per effect on failure, resizes and disposes render targets
│   ├── render-hook.ts   # The single indirection main.ts calls; passthrough to
│   │                    #   renderer.render until the chain installs itself
│   └── diag.ts          # Declares and attaches window.__diag.post
└── systems/             # Discovered by glob (src/boot/discover.ts) — adding one edits
    │                    #   no shared file, which is why each story gets exactly one
    ├── elevator/register.ts     # [US1] Registers the elevator with 004's interact path;
    │                            #   steps run state each frame
    ├── stats-screen/register.ts # [US2] Draws the screen from 007's glyph table, publishes
    │                            #   __diag.run, binds restart to 007's reset
    ├── audio/register.ts        # [US3] Subscribes to resolved shots, door state changes
    │                            #   and footstep cadence; publishes __diag.audio
    └── post/register.ts         # [US4] Builds the chain, binds the four toggles, resizes,
                                 #   publishes __diag.post

tests/unit/                      # vitest: DOM-free, three.js-free modules only
├── run-state.test.ts            # [US1]
├── elevator.test.ts             # [US1]
├── run-gating.test.ts           # [US1]
├── level-completable.test.ts    # [US1]
├── run-stats.test.ts            # [US2]
├── rating.test.ts               # [US2]
├── run-completions.test.ts      # [US2]
├── sound-table.test.ts          # [US3]
├── synth.test.ts                # [US3]
├── voice-pool.test.ts           # [US3]
├── audio-triggers.test.ts       # [US3]
├── post-state.test.ts           # [US4]
└── post-cost.test.ts            # [US4]

tools/
├── smoke.mjs                    # [US2] gains ONE addition: it discovers and runs
│                                #   tools/smoke-checks/*.mjs. No other story edits it.
├── smoke-checks/
│   ├── run.mjs                  # [US2] Scripted run to `complete`; stats vs source counters
│   ├── audio.mjs                # [US3] Context state, inventory, no audio-path console error
│   └── post.mjs                 # [US4] Eight toggles, bloom brightness, fps floor, cost
└── check-no-binaries.mjs        # [US3] gains `.m4a`, which FR-009 names and it omits

DECISIONS.md                     # [US3, US4] append-only, one line per fallback taken
```

**Structure Decision**: Single-project layout, and three deliberate seams.

*One system per story.* 001 built `src/boot/registry.ts` + `src/boot/discover.ts`
specifically so a story adds `src/systems/<name>/register.ts` and edits no shared wiring
file — not `main.ts`, not an index. Each of the four stories here gets exactly one system
directory, so no two stories write the same wiring.

*Diagnostics are extended per story, not in `src/diag/diag.ts`.* FR-008 and FR-018 add
three objects — `run`, `audio` and `post` — from three different stories. Adding three
fields to the `Diagnostics` interface in `src/diag/diag.ts` would put three stories in one
file for three one-line additions, which is the exact contention the registry exists to
avoid. Instead each story owns a `diag.ts` beside its own modules that declares its slice
and augments the `Diagnostics` interface by module augmentation from its own file. The
contract stays additive over 001–007 with nothing renamed, removed or repurposed, and the
`__diag` shape a harness reads is unchanged in kind.

*The render call is indirected once.* `src/main.ts` calls `renderer.render(scene, camera)`
in its frame loop, and a post chain must render through a composer instead. That is the one
edit to `main.ts` this spec makes: the call becomes a call to `renderFrame(ctx)` from
`src/post/render-hook.ts`, which is a passthrough to `renderer.render` until US4's chain
installs itself. The behaviour lives in `post/`; `main.ts` gains an import and loses a
direct call.

## Complexity Tracking

*No Constitution violations to justify.* Five environmental constraints are recorded here
because each changes how a task must be written:

| Constraint | Why it matters | Consequence for tasks |
|---|---|---|
| `tools/smoke.mjs` as landed does not drive a browser | 001's tasks describe a Playwright harness that loads the page and reads `__diag`; what shipped is a static check — no-binary-assets plus `dist/index.html` exists. FR-008 requires the harness to drive a scripted run to `complete` and FR-018 requires it to fail on a console error from the audio or post path, and neither is possible against a static check. | US2 owns the harness work. Its tasks must add the page-driving phase if 002–007 have not already, resolving the browser from `PLAYWRIGHT_BROWSERS_PATH` / `CHROME_PATH` and failing with a message naming the missing browser rather than attempting a download or skipping the assertion. Narrowing an assertion to make the gate pass is an Article III violation. |
| Three stories add smoke assertions | `tools/smoke.mjs` is one file and US2, US3 and US4 each need assertions in it. | US2 adds a single discovery hook that runs every `tools/smoke-checks/*.mjs`; US3 and US4 each add one file to that directory and touch `smoke.mjs` never. |
| Post-processing is a different API per backend | On WebGL the chain is `EffectComposer` plus passes; on WebGPU it is three's node-based `PostProcessing`. SSAO and motion blur in particular do not have the same implementation on both. This is not a defect to fix — it is why FR-016 exists. | `src/post/chain.ts` builds per backend and disables per effect; a build failure for one effect adds an entry to `__diag.post.fallbacks` and a line to `DECISIONS.md` and the scene renders on. The gate asserts togglability, error-freedom and reported cost — never a tuned magnitude. |
| Headless Chromium has no user gesture, and may have no audio device | The autoplay policy leaves the context `suspended` for the whole gate run, and context construction itself can throw where no device exists. A story whose gate asserted "a sound played" would be unlandable. | `src/audio/context.ts` constructs inside a guard; a failure is a `fallbacks` entry, not an `__diag.errors` entry. The smoke check asserts context state, inventory and the absence of an audio-path console error, and treats `suspended` as a pass. |
| A completed run must keep rendering | FR-003 stops actors, not frames. The naive implementation — returning early from the frame loop or unregistering systems — produces a frozen canvas the gate cannot read. | Gating is a predicate module the guard, damage and fire paths consult (`src/run/gating.ts`); no system is removed from the registry and the loop is never short-circuited. |
