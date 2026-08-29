# Wolfenstein-style FPS — agent brief

> **Operator notes (not part of the brief — delete before handing over if you like)**
>
> Run TWO Claude Code seats, one per alias, both pointed at the litellm gateway:
>
> ```bash
> # seat 1
> ANTHROPIC_MODEL=dev-agent      claude
> # seat 2
> ANTHROPIC_MODEL=general-agent  claude
> ```
>
> Both aliases resolve to the same weights on the same engine
> (`qwen3.8-flash-next-iq4xs-131k` on `:8002`), so this buys parallelism, not a
> generalist/specialist pairing. The engine has exactly **2 slots** — two seats is
> the ceiling. A third concurrent caller queues and time-to-first-token collapses
> (measured: 4th caller ~52s TTFT vs ~17s alone).
>
> Three rules in the brief are tuned to this specific engine rather than generic
> prompt hygiene:
> - *No subagents, concurrency 1* — two slots, and the seats are the parallelism.
> - *Prefer editing over writing* — `--spec-type ngram-mod` runs ~5.8x faster on
>   edit-shaped work (153 vs 26 tok/s) and does nothing for novel prose.
> - *Commit after every task* — llama.cpp #27780 (qwen4exp multi-sequence abort on
>   GB10) is open with no fix. Two seats is multi-sequence. `Restart=always`
>   catches the abort; per-task commits keep the blast radius to one task.
>
> Procedural-everything is deliberate: it removes binary assets, which is the
> biggest failure mode for a local model building a game. It can't draw a sprite
> sheet, but it can write a noise function that generates one.

---

# Wolfenstein-style FPS — first level, from scratch

You are one of TWO Claude Code seats working the same repo concurrently.
Your partner seat runs on the other model alias. Read PROTOCOL before any work.

## PROTOCOL — two seats, two slots

The backing engine has exactly 2 slots. Never spawn subagents; set your max
concurrency to 1. You and your partner ARE the parallelism.

Coordinate through `PLAN.md` at the repo root, which you create in M0:

- Every milestone task has a line: `- [ ] M<n>.<k> <desc> — owner: none`
- To take work: edit the line to `owner: <your alias>`, commit ONLY that line,
  push. Then do the work.
- Never touch a task owned by the other alias. If you have nothing unowned to
  take, pick the next unowned task in a LATER milestone rather than idling.
- Commit after every task, not every milestone. Small commits are mandatory —
  the engine has a known abort under sustained load and an interrupted session
  must lose at most one task.

## STACK — fixed, do not substitute

- Vite + TypeScript, strict mode.
- three.js. WebGPURenderer when `navigator.gpu` exists, WebGLRenderer fallback.
- Zero runtime asset files. ALL textures, sprites, and sounds are generated
  procedurally in code at load time (canvas 2D / noise functions / WebAudio
  oscillators). This is a hard requirement: no .png, .jpg, .mp3, .glb in the repo.
- `npm run dev` must work from a clean clone with no manual steps.

## TARGET

Runs on an RTX 5080 at 1440p, 120+ fps. Spend the GPU budget — this should not
look like a 1992 game. Real 3D geometry, not a raycaster.

## GAME

One level, in the SPIRIT of Wolfenstein 3D E1M1 — grid-based maze, right angles,
locked doors, secret push-walls, an elevator exit. Design an ORIGINAL layout;
do not reproduce id Software's map data, textures, sprites, or sounds. Original
work only, procedurally generated.

Controls: WASD move, mouse look (pointer lock), Shift sprint, Space/E interact,
Ctrl or LMB fire, 1-3 weapon select, Esc release pointer.

## MILESTONES — each ends RUNNABLE and COMMITTED

**M0  Scaffold.** Vite+TS+three.js, WebGPU-or-WebGL2 renderer, resize handling,
fps/frametime overlay, empty lit scene. PLAN.md with every task below.
*DONE: `npm run dev` shows a lit ground plane at 120+ fps.*

**M1  Map + geometry.** `level.ts` exports a 64x64 grid (0=empty, 1..n=wall type,
D=door, S=secret, E=exit). Build merged BufferGeometry for walls/floor/ceiling —
one draw call per material, not one mesh per cube.
*DONE: level renders as solid 3D geometry, <20 draw calls.*

**M2  Player.** Capsule collider, grid-swept AABB collision, no wall clipping at
any speed, pointer-lock mouselook with configurable sensitivity, head-bob.
*DONE: you can walk the whole map and cannot escape it.*

**M3  Interaction.** Sliding doors (E to open, auto-close), silver/gold keys,
locked doors that refuse without the key, secret push-walls that slide back 2
tiles.
*DONE: every door and secret in the level works.*

**M4  Materials + lighting.** Procedural texture generator (brick, stone, wood,
steel, blood-stone) producing albedo + normal + roughness maps at 512px.
Shadow-mapped point lights, baked-feel ambient, fog.
*DONE: level is fully textured, shadows cast, no untextured surfaces.*

**M5  Enemies.** 6-10 guards. State machine: idle→alert→chase→attack→death, A*
pathing on the grid, line-of-sight checks, hitscan attacks with damage falloff.
Render as camera-facing billboards built from procedural sprite sheets, 8 view
angles.
*DONE: enemies see you, chase you, shoot you, and die.*

**M6  Combat + HUD.** Pistol/SMG/chaingun with distinct fire rates and spread,
muzzle flash, hitscan tracing, ammo. HUD: health, ammo, keys, score, face
portrait. Pickups: health, ammo, treasure.
*DONE: full gameplay loop — fight, collect, survive, die, restart.*

**M7  Polish.** Post-processing (bloom, SSAO, motion blur, film grain — all
toggleable), procedural WebAudio (gunfire, doors, footsteps, ambient drone),
elevator exit that ends the level with a stats screen.
*DONE: level completable start to finish.*

## RULES

- No file over 400 lines. Split before you exceed it.
- After every task: `npm run build` must pass with zero TS errors, then commit.
- Prefer editing existing files over writing new ones — the engine is ~6x faster
  at edits than at novel generation, so grow files incrementally.
- If you hit a design fork, write the decision and one-line rationale into
  `DECISIONS.md` and keep moving. Do not stop to ask.
- Never rewrite a file your partner committed within the last 3 commits without
  reading it first.
