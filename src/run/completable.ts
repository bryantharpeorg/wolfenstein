// Is the shipped level finishable? A route from the player spawn to the `E` tile
// over 006's pathing, across empty, open-door and opened-secret tiles (FR-001,
// US1-S8). Pure, and answered under `npm run test`, so the level is proved
// completable before a human ever plays it — a maze whose exit is walled off is
// a bug no amount of play-testing finds reliably and one A* search finds every
// time.
//
// Doors and secrets are treated as *openable* rather than open: a route through
// a door the player must first unlock is still a route, and which key opens
// which door is 004's question, already answered by its own placement rules. The
// claim here is the weaker, load-bearing one — the geometry does not seal the
// exit off.

import { LEVEL_GRID, PLAYER_SPAWN } from '../level';
import { findPath, isUnreachable } from '../enemy/pathing';
import type { Cell } from '../enemy/guard';
import { tileKey } from '../player/tiles';
import { findExitTile, type ExitTile } from './elevator';

/** Walkable whatever the open state, which is 003's rule for the collider. */
const ALWAYS_PASSABLE = ['0', 'E'] as const;

/** Walkable once opened: 004's doors and its push-wall secrets. */
const OPENABLE = ['D', 'S'] as const;

/** The cells a route may cross. Every other cell is level geometry a player
 *  cannot walk through however many keys they carry. */
export const PASSABLE_WHEN_OPENED: readonly string[] = [...ALWAYS_PASSABLE, ...OPENABLE];

/** The cells that are passable only once opened, in the shape 003's collider
 *  takes its open state: every `D` and `S` tile of the grid. */
export function openableTiles(grid: readonly string[] = LEVEL_GRID): Set<string> {
  const tiles = new Set<string>();
  for (let z = 0; z < grid.length; z += 1) {
    const row = grid[z] ?? '';
    for (let x = 0; x < row.length; x += 1) {
      const cell = row[x] ?? ' ';
      if ((OPENABLE as readonly string[]).includes(cell)) tiles.add(tileKey(x, z));
    }
  }
  return tiles;
}

export interface CompletabilityResult {
  readonly completable: boolean;
  /** The route, spawn first and exit last; empty when there is none. */
  readonly path: readonly Cell[];
  /** What the search spent, so a level that is *nearly* too big says so. */
  readonly nodesExpanded: number;
  /** Why not, when not: named rather than left to the caller to infer. */
  readonly reason: 'reachable' | 'no-exit-tile' | 'unreachable';
}

const NONE: readonly Cell[] = [];

/**
 * Whether `exit` is reachable from `spawn` over `grid` (US1-S8, SC-001).
 *
 * The search is 006's `findPath` unchanged — the same A*, the same node budget,
 * the same determinism — handed an open state in which every door and secret is
 * open. Nothing here re-implements pathing; a completability check that disagreed
 * with the pathing the guards use would be answering about a different level.
 */
export function checkCompletable(
  grid: readonly string[] = LEVEL_GRID,
  spawn: Cell = { x: PLAYER_SPAWN.x, z: PLAYER_SPAWN.z },
  exit: ExitTile | null = findExitTile(grid),
): CompletabilityResult {
  if (exit == null) {
    return { completable: false, path: NONE, nodesExpanded: 0, reason: 'no-exit-tile' };
  }

  const result = findPath(
    [...grid],
    openableTiles(grid),
    { x: spawn.x, z: spawn.z },
    { x: exit.x, z: exit.z },
  );

  if (isUnreachable(result)) {
    return {
      completable: false,
      path: NONE,
      nodesExpanded: result.nodesExpanded,
      reason: 'unreachable',
    };
  }

  return {
    completable: true,
    path: result.cells,
    nodesExpanded: result.nodesExpanded,
    reason: 'reachable',
  };
}
