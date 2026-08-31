// The elevator: which `E` tile the player is standing next to, and what 004's one
// interact command answers when they press use there (FR-001). Pure input to
// output — a position, a health and a run state in, one declared outcome out —
// so every case US1 names is one call under `npm run test`.
//
// Reach is 004's, not a second convention: the player's own tile and its four
// orthogonal neighbours, measured with `INTERACT_REACH_TILES` exactly as
// `findTargetDoor` measures it. An elevator you could call from across the room
// would be a different rule for the same keypress.

import { LEVEL_GRID } from '../level';
import { INTERACT_REACH_TILES } from '../interaction/params';
import type { InteractOutcome } from '../interaction/outcomes';
import type { RunState } from './state';

/** The grid cell 002 reserves for the exit. */
export const EXIT_CELL = 'E';

export interface ExitTile {
  readonly x: number;
  readonly z: number;
}

export interface ElevatorQuery {
  readonly playerX: number;
  readonly playerZ: number;
  /** The player's health; zero refuses (FR-001, US1-S6). */
  readonly health: number;
  readonly state: RunState;
  /** The tile to answer for. Defaults to the shipped level's single `E`. */
  readonly exit?: ExitTile | null;
}

export interface ElevatorResolution {
  readonly outcome: InteractOutcome;
  /** The tile that answered, or null when nothing was in reach. */
  readonly exit: ExitTile | null;
}

/** The level's single `E` tile, or null in a grid that has none. 002's validator
 *  already refuses a level with anything but exactly one, so the first is it. */
export function findExitTile(grid: readonly string[] = LEVEL_GRID): ExitTile | null {
  for (let z = 0; z < grid.length; z += 1) {
    const row = grid[z] ?? '';
    const x = row.indexOf(EXIT_CELL);
    if (x >= 0) return { x, z };
  }
  return null;
}

// The shipped level's exit, found once: the grid is a constant, so scanning it
// per keypress would be a search for an answer that cannot change.
let shipped: ExitTile | null | undefined;

export function shippedExitTile(): ExitTile | null {
  if (shipped === undefined) shipped = findExitTile(LEVEL_GRID);
  return shipped;
}

/** Whether the player stands on the exit tile or orthogonally beside it. */
export function isAtExit(exit: ExitTile, playerX: number, playerZ: number): boolean {
  const tileX = Math.floor(playerX);
  const tileZ = Math.floor(playerZ);
  return Math.abs(exit.x - tileX) + Math.abs(exit.z - tileZ) <= INTERACT_REACH_TILES;
}

/**
 * Resolves one interact command against the elevator (FR-001).
 *
 * Reach is asked first, so a press from across the room is 004's `no-target`
 * whatever the run is doing (US1-S2) and the elevator never speaks for a press
 * that was not aimed at it. Then health, because the shot that killed the player
 * resolved before the press did and a dead player does not complete the level
 * (US1-S6). Then the run state: a lift already travelling — or already arrived —
 * answers `already-exiting` and starts nothing (US1-S4).
 */
export function resolveElevator(query: ElevatorQuery): ElevatorResolution {
  const exit = query.exit === undefined ? shippedExitTile() : query.exit;
  if (exit == null || !isAtExit(exit, query.playerX, query.playerZ)) {
    return { outcome: 'no-target', exit: null };
  }
  if (!(query.health > 0)) return { outcome: 'exit-refused-dead', exit };
  if (query.state === 'exiting' || query.state === 'complete') {
    return { outcome: 'already-exiting', exit };
  }
  if (query.state === 'dead') return { outcome: 'exit-refused-dead', exit };
  return { outcome: 'exit-used', exit };
}
