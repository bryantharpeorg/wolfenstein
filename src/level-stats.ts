// Level statistics: turns the grid, the validator's report and the emitted face
// arrays into the `window.__diag.level` object. Pure: no three.js, no DOM
// (FR-011, US3-S1, US3-S2). It reads US1's and US2's modules, never editing them.

import { LEVEL_GRID } from './level';
import type { ValidationReport } from './level-validate';
import type { EmittedFaces } from './geometry/faces';

export interface LevelBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface LevelStats {
  floorTiles: number;
  wallTilesByType: Record<string, number>;
  doorTiles: number;
  secretTiles: number;
  exitTiles: number;
  wallFaces: number;
  bounds: LevelBounds;
  valid: boolean;
  errors: string[];
}

// A tile the player can stand on: empty floor, a door, a secret or the exit.
// Matches the validator's reachability definition of walkable space.
function isWalkable(cell: string): boolean {
  return cell === '0' || cell === 'D' || cell === 'S' || cell === 'E';
}

// The tile range of walkable space: the min/max x and z of any walkable tile.
function computeBounds(grid: string[]): LevelBounds {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (let z = 0; z < grid.length; z += 1) {
    const row = grid[z]!;
    for (let x = 0; x < row.length; x += 1) {
      if (isWalkable(row[x]!)) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (z < minZ) minZ = z;
        if (z > maxZ) maxZ = z;
      }
    }
  }
  return { minX, maxX, minZ, maxZ };
}

// The number of vertical wall faces: one quad per solid tile's open neighbour,
// summed across every wall type. Each quad is 6 indices.
function countWallFaces(faces: EmittedFaces): number {
  return Object.values(faces.walls).reduce(
    (sum, data) => sum + data.indices.length / 6,
    0,
  );
}

/**
 * Computes the level statistics published under `window.__diag.level`. The tile
 * counts come from the validator's own report (so US3 publishes the validator's
 * numbers rather than recounting the grid a second way), `wallFaces` from the
 * emitted face arrays, and `bounds` from the grid's walkable range.
 */
export function computeLevelStats(
  grid: string[],
  report: ValidationReport,
  faces: EmittedFaces,
): LevelStats {
  return {
    floorTiles: report.counts.floorTiles,
    wallTilesByType: report.counts.wallTilesByType,
    doorTiles: report.counts.doorTiles,
    secretTiles: report.counts.secretTiles,
    exitTiles: report.counts.exitTiles,
    wallFaces: countWallFaces(faces),
    bounds: computeBounds(grid),
    valid: report.valid,
    errors: report.errors.map((error) => error.message),
  };
}

// The row the corruption hook overwrites: the top border. Replacing it with
// empty floor breaks the solid-border rule, so `validateLevel()` rejects the
// result with a named `dimensions` error — a real validator rejection, not a
// mocked one (FR-012, US3-S5).
export const CORRUPT_ROW_INDEX = 0;

/**
 * Returns a copy of the grid with one named row overwritten, so the smoke gate's
 * failure path proves a real validator rejection rather than a mocked one.
 */
export function corruptGrid(grid: string[] = LEVEL_GRID): string[] {
  const copy = grid.map((row) => row);
  const width = copy[CORRUPT_ROW_INDEX]?.length ?? 0;
  copy[CORRUPT_ROW_INDEX] = '0'.repeat(width);
  return copy;
}
