// Tile predicates for the collision resolver. Pure: no three.js, no DOM, and the
// grid is taken as an argument rather than read from a global (FR-005, FR-007).
//
// Blocking rule (FR-007): every non-empty cell blocks — walls ('1'..'9'), doors
// ('D') and secrets ('S') — unless the supplied open-state marks a door or secret
// open. Floor ('0') and the exit ('E') are always walkable. Out-of-bounds blocks.

import { COLLIDER_RADIUS } from './params';

/** The declared epsilon for boundary comparisons, so flush is not penetration. */
export const BOUNDARY_EPSILON = 1e-6;

/**
 * The level's open/closed state: the set of "x,z" keys for door/secret tiles that
 * are currently open. M3 opens doors by adding keys here, without changing any
 * collision signature (FR-007).
 */
export type OpenState = ReadonlySet<string>;

export function tileKey(x: number, z: number): string {
  return `${x},${z}`;
}

function cellAt(grid: string[], x: number, z: number): string {
  const row = grid[z];
  if (row === undefined) return ' ';
  return row[x] ?? ' ';
}

/** Whether tile (x, z) blocks movement, given the grid and open-state. */
export function isTileBlocking(
  grid: string[],
  x: number,
  z: number,
  openState: OpenState,
): boolean {
  const cell = cellAt(grid, x, z);
  if (cell === '0' || cell === 'E') return false;
  if (cell === 'D' || cell === 'S') return !openState.has(tileKey(x, z));
  return true;
}

/**
 * Whether a circle of `radius` at world position (x, z) lies entirely within
 * walkable tiles. A tile overlap narrower than BOUNDARY_EPSILON counts as flush,
 * not penetration, so a circle resting exactly on a boundary is walkable.
 */
export function isCircleWalkable(
  grid: string[],
  x: number,
  z: number,
  radius: number,
  openState: OpenState,
): boolean {
  const minTx = Math.floor(x - radius);
  const maxTx = Math.floor(x + radius);
  const minTz = Math.floor(z - radius);
  const maxTz = Math.floor(z + radius);
  for (let tz = minTz; tz <= maxTz; tz += 1) {
    for (let tx = minTx; tx <= maxTx; tx += 1) {
      if (!isTileBlocking(grid, tx, tz, openState)) continue;
      if (
        tx < x + radius - BOUNDARY_EPSILON &&
        tx + 1 > x - radius + BOUNDARY_EPSILON &&
        tz < z + radius - BOUNDARY_EPSILON &&
        tz + 1 > z - radius + BOUNDARY_EPSILON
      ) {
        return false;
      }
    }
  }
  return true;
}

/** The collider radius, re-exported for callers that want the default. */
export const COLLIDER_RADIUS_DEFAULT = COLLIDER_RADIUS;
