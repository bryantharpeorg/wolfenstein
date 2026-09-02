// The compile seam. `tools/play.mjs` runs on Node, which cannot import TypeScript, but the
// routes the agent walks must come from the *same* `findPath` the guards use — a second A*
// under `tools/` would be a copy of a module whose determinism is load-bearing and asserted
// by 006's tests, free to drift from it (009 FR-004, plan.md Complexity Tracking).
//
// So this file re-exports what the runner routes with and nothing else; `tools/play/navigate.mjs`
// compiles it to one ESM module with esbuild and imports that. It declares no value of its
// own on purpose: everything here has exactly one definition, in `src/`.
//
// Its whole import graph is DOM-free and three.js-free — level.ts imports nothing,
// pathing.ts reaches only tiles.ts, step.ts and guard.ts — which is what makes it
// compilable in isolation at all.

export {
  LEVEL_GRID,
  PLAYER_SPAWN,
  TILE_SIZE,
  ENEMY_SPAWNS,
  ITEM_SPAWNS,
  DOOR_LOCKS,
} from '../../src/level';
export type { TileCoord, ItemSpawn, ItemKind, LockKind } from '../../src/level';

export { findPath, isUnreachable, MAX_NODE_EXPANSIONS } from '../../src/enemy/pathing';
export type { PathResult } from '../../src/enemy/pathing';

export { openableTiles } from '../../src/run/completable';
export { findExitTile } from '../../src/run/elevator';
export { tileKey } from '../../src/player/tiles';
export type { Cell } from '../../src/enemy/guard';
