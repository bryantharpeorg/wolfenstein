# Specs

Eight feature specs, one per milestone. Each dispatches as its own epic through
Ergane; within an epic, one node per user story. Build them in numeric order —
each spec's Work Graph assumes the previous spec has landed.

| Spec | Milestone | Ships | Nodes |
|---|---|---|---|
| `001-scaffold` | M0 | Vite+TS+three.js, WebGL renderer (WebGPU behind `?webgpu`), resize, perf overlay, smoke harness | 3 |
| `002-map-geometry` | M1 | 64×64 level grid, merged BufferGeometry, <20 draw calls | 3 |
| `003-player` | M2 | Capsule collider, grid-swept AABB collision, mouselook, head-bob | 3 |
| `004-interaction` | M3 | Sliding doors, silver/gold keys, locked doors, push-wall secrets | 3 |
| `005-materials` | M4 | Procedural albedo/normal/roughness at 512px, shadows, fog | 5 |
| `006-enemies` | M5 | Guard state machine, A\* pathing, LOS, 8-angle billboards | 4 |
| `007-combat-hud` | M6 | Three weapons, hitscan, ammo, HUD, pickups, death/restart | 4 |
| `008-polish` | M7 | Post-processing, procedural audio, elevator exit, stats screen | 4 |

29 nodes across 8 epics, 120 functional requirements, every one implemented by exactly one
story. `node tools/validate-specs.mjs` is the check, and it must be green before dispatch.

**Build state, 2026-09-01.** 28 of 29 stories have landed and the game is playable and
published. The one unbuilt story is `005-materials` US5 (shadow-mapped lights, ambient and
fog, FR-012/013/014) — nothing under `src/lighting/` exists, there is no `Fog` in the tree,
and `__diag.materials.lights` and `.shadowsEnabled` are declared but never written. It is
the only story in the spec set with zero implementing files. Two 005 US4 tasks are also
outstanding (T040 move derivation off the animation frame, T041 the cost assertions in
`tools/smoke-checks/materials.mjs`). Note that the 005 row above read `4` until today: the
US3/US4 split landed on 2026-08-31 and the table was never updated.

**Not covered by any spec:** deployment. The game is published to GitHub Pages by
`.github/workflows/pages.yml` and is live, but no spec, FR or gate describes that surface —
so the artifact users actually load is the one artifact nothing verifies. Filed as
`spec/shipped-surface-outside-every-spec-is-ungated`.

Every spec's `spec.md` carries a `## Work Graph` section that Ergane compiles
mechanically into its dispatch DAG. The grammar is exact — the deriver rejects the
whole graph for one malformed declaration:

```yaml
US1:
  depends_on: []            # required, list (may be empty)
  implements: [FR-001]      # required, list of FR keys in this spec
  # optional: timeout (positive int seconds), depends_on_merged ([ids]),
  #           persona (string), concurrent_with ([ids])
```

`depends_on` orders dispatch within an epic. Cross-spec ordering is the operator's:
do not dispatch N+1 before N has landed.

## Operator notes — the engine underneath

The build engine is `qwen3.8-flash-next-iq4xs-131k` on `:8002` with **exactly 2
slots**. Two concurrent attempts is the ceiling; a third caller queues and
time-to-first-token collapses (measured: 4th caller ~52s TTFT vs ~17s alone). Cap
Ergane's parallel dispatch at 2 nodes so the DAG's parallelism never exceeds the
engine's.

`llama.cpp` #27780 (qwen4exp multi-sequence abort on GB10) is open with no fix. Two
concurrent attempts *is* multi-sequence, so aborted runs are expected, not anomalous
— `Restart=always` catches them and per-node worktrees bound the blast radius. This
is also why tasks are kept small: an aborted node loses one story, not a milestone.

The engine is roughly 6× faster at editing existing files than at generating novel
ones (`--spec-type ngram-mod`, 153 vs 26 tok/s). The specs are written to exploit
that — most stories amend a module an earlier story created rather than introducing
a new one.

## Fallback clauses

Four requirements carry an explicit degraded outcome instead of a hard failure:

| Requirement | Degrades to | Recorded in |
|---|---|---|
| `005` FR-007 | flat normal + constant roughness, albedo still applied | `DECISIONS.md`, `__diag.materials.fallbacks` |
| `005` FR-014 | ambient and fog only, every surface still textured | `DECISIONS.md`, `__diag.materials.fallbacks` |
| `008` FR-013 | that one sound event is silent | `DECISIONS.md`, `__diag.audio.fallbacks` |
| `008` FR-016 | that one effect is disabled, scene still renders | `DECISIONS.md`, `__diag.post.fallbacks` |

These are deliberate: those two milestones contain the least guessable API surface in the
project (PBR map generation, post-processing chains) with the weakest error feedback — a
black screen compiles cleanly, and a WebAudio graph that produces silence throws nothing.
A fallback lets one story degrade rather than stalling the epic. Using one is a legitimate
outcome, not a failure; every fallback must land in *both* `DECISIONS.md` and a `fallbacks`
array in `window.__diag`, so what was traded away is visible from the harness as well as
from the diff. Note what is *not* fallback-able: no story may ship a surface with no albedo
map, a page that does not render, or a weakened gate (Constitution III).
