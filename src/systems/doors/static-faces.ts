// Recognises the merged wall group 002 drew for the `D` tiles, which the doors
// system hides once a moving leaf replaces it. Every vertex of that group lies on
// a door tile, which is true of no other group; positions arrive as a flat array,
// so the recognition is testable against 002's real output without a renderer.

import { TILE_SIZE } from '../../level';
import type { Door } from '../../interaction/door';

const TILE_EPSILON = 1e-4;

function onDoorTile(x: number, z: number, doors: readonly Door[]): boolean {
  return doors.some(
    (door) =>
      x >= door.x * TILE_SIZE - TILE_EPSILON &&
      x <= (door.x + 1) * TILE_SIZE + TILE_EPSILON &&
      z >= door.z * TILE_SIZE - TILE_EPSILON &&
      z <= (door.z + 1) * TILE_SIZE + TILE_EPSILON,
  );
}

/** Whether every vertex of a merged geometry lies on one of the door tiles. An
 * empty geometry and an empty door set are both false: nothing to hide. */
export function isDoorTileGeometry(positions: ArrayLike<number>, doors: readonly Door[]): boolean {
  if (doors.length === 0 || positions.length === 0) return false;
  for (let i = 0; i + 2 < positions.length; i += 3) {
    if (!onDoorTile(positions[i]!, positions[i + 2]!, doors)) return false;
  }
  return true;
}
