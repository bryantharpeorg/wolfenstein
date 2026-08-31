# Decisions

Constitution Article VIII: when a design decision is genuinely open, append one line
here — the decision and a one-clause rationale — and keep going. Do not stop work to
ask a question you can answer with a defensible default.

This file exists so the first node to hit a fork does not have to invent a format.

**Precedence.** The `domain-modeling` skill in `.claude/skills/` ships an `ADR-FORMAT.md`
describing numbered ADR files under `docs/adr/`. **That convention is not used in this
repository.** Article VIII of the constitution is the standard, this file is its target,
and the constitution outranks a skill — ergane injects the standards path as binding and
marks its own outer loop authoritative, while skills are advisory. Do not create
`docs/adr/`. If a decision genuinely needs more than one line, raise an escalation.

## Format

One decision per line. Append to the end. Never edit or delete an existing line —
a decision that was later reversed gets a **new** line saying so, because the value
of this file is the trail, not the current state.

```
- YYYY-MM-DD | <spec-id> | <the decision, stated as a choice> — <one-clause rationale>
```

- **`<spec-id>`** is the feature directory the node was working in (`001-scaffold`),
  or `operator` when a human decided it outside a node.
- **The decision** names what was chosen, not what was considered. "Doors are a state
  machine" — not "considered several door approaches".
- **The rationale** is one clause. If it needs a paragraph, it is not a defensible
  default and belongs in an escalation instead.
- Reversals: `— reverses the <date> entry, because <clause>`.

Anything larger than one line — a decision that reshapes the architecture, or one you
cannot defend without prose — is not a DECISIONS entry. Raise it as an escalation and
let the operator answer.

## Log

- 2026-08-29 | operator | DECISIONS.md is a flat append-only line log, not numbered ADR files — Article VIII asks for one line and a rationale, and a directory of documents would invite essays the constitution explicitly does not want.
- 2026-08-29 | operator | Agent skills are vendored into `.claude/skills/` as real files, copied from mattpocock/skills@6654f6b — a node's sandbox gets a factory-owned HOME, so `~/.claude` skills are invisible and the symlinked local copies would dangle.
- 2026-08-29 | operator | `design-an-interface` dropped from the architect persona rather than sourced — it was retired upstream and absorbed into `codebase-design`, which the architect already loads.
- 2026-08-29 | operator | `docs/agents/issue-tracker.md` points findings at the node verdict instead of a tracker — the `code-review` skill requires that file and otherwise instructs the node to run a slash command it has no way to run.
- 2026-08-29 | operator | DECISIONS.md outranks the `domain-modeling` skill's ADR-FORMAT.md, and `docs/adr/` is not used — the constitution is binding on nodes and a vendored skill is advisory, so the contradiction is settled here rather than per-node.
- 2026-08-29 | 001-scaffold | Spec Kit initialised in-repo (specify 0.16.5) rather than authoring plan/tasks by hand — specs 002-008 need the same artifacts, and ergane parses Spec Kit's `T### [US#]` task shape natively.
- 2026-08-29 | 001-scaffold | Within this spec only, a task is green when every gate that exists at that point passes — the bootstrap exception, because Article VII demands gates that US1 and US3 are the tasks creating.
- 2026-08-29 | 001-scaffold | The smoke harness must accept an externally provided browser and refuse to download one — the spec's assumption that Playwright's install-time download is available is false under the build sandbox, which gives each node a fresh tmpfs HOME.
- 2026-08-29 | operator | The gates workflow installs Chromium on the runner while the engine image bakes it in — same gate, two ways to satisfy the prerequisite, because a runner's HOME persists for the job and an Ergane node's tmpfs HOME does not.
- 2026-08-29 | operator | `package-lock.json` is committed and `npm ci` is the install path — the gates run `npm ci || npm install`, so dropping the lockfile silently degrades every CI run to unpinned resolution while still reporting green.
- 2026-08-30 | 002-map-geometry | The system registry (`src/boot/*`, `src/systems/*`) is implemented as part of US2, adapted from `operator/system-registry` to current main — the plan assumes 001 landed it but it did not, and US2's T018-T021 require it.
- 2026-08-30 | 003-player | `src/player/params.ts` is created complete by US1 and imported read-only by US2/US3 — a single owner keeps tuning from chasing literals across files.
- 2026-08-30 | 003-player | `window.__diag.player` is added by TypeScript module augmentation in `src/player/diag-player.ts` rather than editing `src/diag/diag.ts` — the augmentation route leaves every 001/002 field untouched.
- 2026-08-30 | 003-player | `window.__playerDrive(velX, velZ, ms)` is a synchronous input seam that writes `desiredVel*` then integrates over `ms` — the smoke gate must script a walk before US3's keyboard exists, and a synchronous drive keeps the gate fast and deterministic.
- 2026-08-30 | 004-interaction | US1-S5 and FR-003 are amended in `spec.md` to name the moving refusal per state (`blocked-moving` opening, `refusing-closing` closing) — as written they demanded both names from one closing door, which US1-S6 contradicts and no implementation can satisfy.
- 2026-08-30 | 004-interaction | `MAX_STEP_MS` is 500 — US1-S3 steps in 500 ms ticks and requires them to integrate in full, so a smaller clamp would break the frame-rate independence it asserts.
- 2026-08-30 | 004-interaction | Door gates carry an `interact` / `close` phase, so one registry serves US1's crush gate and US2's lock gate rather than `door.ts` growing a second seam.
- 2026-08-30 | 004-interaction | `openTiles()` reaches 003's collider as a live `ReadonlySet` view, not a snapshot — 003's call site changes by one line and keeps its signature.
- 2026-08-30 | 004-interaction | The doors system hides 002's static `D` faces and builds the doorway's floor, ceiling and jambs itself: 002 treats a door tile as solid, so those faces do not exist and an opened leaf would reveal a hole.
- 2026-08-30 | 004-interaction | US2's one validator edit lands in `src/level-validate.ts`, not `src/level.ts` as plan.md's structure sketch says — 002 split the validator out, and the call line belongs where `validateLevel()` actually lives.
- 2026-08-30 | 004-interaction | A rule declares its own `ErrorCategory` by augmenting `ExtraRuleCategories` from its own file — US3's `secret-placement` then needs no edit to `level-validate.ts`, which is the point of discovering rules by glob.
- 2026-08-30 | 004-interaction | `locks.ts` imports no part of the door machine: the gate's shape is structural, so `registerDoorGate` accepts it while the lock stays a pure question about the inventory.
- 2026-08-30 | 004-interaction | The doors system records *that* a command was refused and the keys system names the key — `lastRefusalKeyKind` is written by the story that owns locks, so `doors/register.ts` is not reopened.
- 2026-08-30 | 004-interaction | US2's worktree merges the US1 branch it is declared to depend on: it was dispatched from a base without `src/interaction/`, and re-authoring US1's outcome union and gate registry would be the cross-story same-file write the plan exists to prevent.
- 2026-08-30 | 004-interaction | US2 was landed by the operator after five consecutive `size_refusal` failures reporting 109,730 bytes against a 65,536 cap — a number matching no computable base (the branch measures 50,725 against `main`). Gates were re-run by hand (typecheck, build, 186 tests) and the same judge model was run manually against US2's acceptance criteria: VERDICT PASS, 8/8 scenarios. Feedback #62/#63.
- 2026-08-30 | 004-interaction | A secret travels at the door's own rate (`SECRET_TILE_MS = DOOR_TRAVEL_MS / DOOR_TRAVEL_TILES`) rather than declaring a second duration in `params.ts`, which US1 owns.
- 2026-08-30 | 004-interaction | `found` latches when travel actually begins, so a secret whose first tile is solid is never counted — `secretsFound` names openings, not presses.
- 2026-08-30 | 004-interaction | `secretRemainingTiles` is added to `InteractionDiagnostics` by augmentation from `secret-field.ts`: US3-S6 wants the shortfall in diagnostics, and US1 owns that file.
- 2026-08-30 | 004-interaction | The secrets system installs its own `keydown` listener resolving through the one `bindings.ts` table, and records a reason only when a secret was in reach: FR-005 binds one command *path*, not one listener.
- 2026-08-30 | 004-interaction | The tile a pushed wall rests on is not re-blocked for collision: the passable-tile registry only adds tiles, and inverting it would mean editing `open-state.ts` and 003's collider, which no US3 task owns.
- 2026-08-31 | 006-enemies | `stepGuard` returns a fresh record and advances only the `Rng` in place, reporting `randomConsumed` per tick — that flag is what lets US1-S9 assert a different seed diverges only where randomness was drawn.
- 2026-08-31 | 006-enemies | Idle patrol draws heading and jitter every idle tick, using the heading only when due — the generator's position then depends on the tick count, never on a branch, which is what makes the trace exact.
- 2026-08-31 | 006-enemies | `StepContext.doorStates` is 004's open-tile key set, not a second door-state shape — `openTiles()` produces it and `isTileBlocking` consumes it already.
- 2026-08-31 | 006-enemies | A chasing guard moves only along a path the injected world returned — a discarded stale path then costs one throttle interval of standing still, not a beeline to nowhere.
- 2026-08-31 | 006-enemies | The guard record splits into `src/enemy/guard.ts`, one module beyond plan.md's sketch — `step.ts` crossed the 400-line ceiling, and Article IV makes the split part of the task.
- 2026-08-31 | 005-materials | `generateMaterial(spec, size)` is the pure function FR-003 is stated over and `generateAlbedo(name, size)` is the memoized entry point over the table — one function cannot be both byte-reproducible under an arbitrary seed and cached per name.
- 2026-08-31 | 005-materials | A seed is varied through `reseed(spec, seed)` in `table.ts`, not by spreading a spec at the call site — `MaterialSpec` is a discriminated union, and a spread loses the correlation between a material's name and its own parameter block.
- 2026-08-31 | 005-materials | `MEAN_DISTINCTNESS_THRESHOLD` is 8 channel units while the five materials are tuned to a smallest measured gap of ~23 (brick 80, blood-stone 57, wood 108, stone 149, steel 182) — the threshold is the floor a retune must clear, not the spread itself.
- 2026-08-31 | 006-enemies | `findPath` returns `cells` beginning at the start cell rather than just after it — US2-S1 asks for a list "from start to goal", and a guard already standing on `cells[0]` arrives on it the same tick and slices it, so `step.ts` needs no change.
- 2026-08-31 | 006-enemies | `MAX_NODE_EXPANSIONS` is 4096, one 64x64 grid of cells: a search may cover the whole level exactly once and no more, so the cap is a real bound without ever refusing a route the level actually has.
- 2026-08-31 | 006-enemies | A* orders its open set by (f, h, cell index, insertion sequence) — a *total* order, which is what makes US2-S9's "two identical calls, identical paths" a property of the code rather than of the heap's history.
- 2026-08-31 | 006-enemies | A diagonal corner is passable to sight when at least one of the two cells flanking it is open; only two walls close it, which is US2-S7's pinwheel and nothing wider.
- 2026-08-31 | 006-enemies | `MAX_LOS_STEPS` is 512 — four times the longest span a 64x64 grid can produce, so the bound is unreachable in play and absolute in principle.
- 2026-08-31 | 006-enemies | The `Navigator`'s throttle is a second belt over `step.ts`'s own: a suppressed request returns the cached path and is counted, so a guard asking every tick shows up in `NavReport` rather than in the frame time.
- 2026-08-31 | 006-enemies | A claim reserves a guard's destination cell only, never its route — two guards may share a corridor, and only the cell they would grind against is made exclusive.
- 2026-08-31 | 006-enemies | US1's purity check treats the bare word `navigator` as a DOM global, so `nav.ts` names its own type `Navigator` in prose; the gate is right that `navigator` is a global, and renaming the comment is cheaper than narrowing the check.
