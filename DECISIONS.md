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
- 2026-08-30 | 004-interaction | The declared maximum per-frame delta step is 500 ms — US1-S3 requires a 500 ms tick to integrate in full, so any smaller clamp would break the frame-rate-independence it asserts.
- 2026-08-30 | 004-interaction | US1-S5 and FR-003 are amended in `spec.md` to name the moving refusal per state (`blocked-moving` when `opening`, `refusing-closing` when `closing`) — as written they demanded both names from one closing door, which US1-S6 contradicts and no implementation can satisfy.
- 2026-08-30 | 004-interaction | Door gates carry an explicit `interact` / `close` phase — one registry then serves both US1's crush gate and US2's lock gate, instead of `door.ts` growing a second seam it would have to be reopened to add.
- 2026-08-30 | 004-interaction | `openTiles()` is exposed to 003's collider as a live `ReadonlySet` view rather than a snapshot — 003's call site changes by one line and keeps its signature, which is what FR-007's open-state argument was for.
- 2026-08-30 | 004-interaction | The doors system hides 002's static `D` faces and builds the doorway's floor, ceiling and jambs itself — 002's emitter treats a door tile as solid, so those four faces do not exist and an opened leaf would otherwise reveal a hole rather than a doorway.
