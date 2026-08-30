// Which of 002's merged wall groups is the one drawn for the `D` tiles.
//
// 002 groups wall faces by cell type and hands back an unlabelled array of
// meshes, so the doors system has to recognise the door group rather than be
// told which it is. It is recognised by its own vertices: every vertex of the
// `D` group lies on a door tile, which is true of no other group — a wall group
// bordering a door reaches into the wall tile beside it, and floor and ceiling
// span the level. Depending on 002's build order instead would be depending on
// a detail that is not this story's to hold still.
//
// Pure: no DOM, no three.js. The positions arrive as a flat XYZ array, so this
// is testable against the real emitted geometry without a renderer.

import { TILE_SIZE } from '../../level';
import type { Door } from '../../interaction/door';

/** A vertex on a door tile's boundary belongs to that tile, not to its neighbour. */
const TILE_EPSILON = 1e-4;

function onDoorTile(x: number, z: number, doors: readonly Door[]): boolean {
  return doors.some(
    (door) =>
      x >= door.x - TILE_EPSILON &&
      x <= door.x + TILE_SIZE + TILE_EPSILON &&
      z >= door.z - TILE_EPSILON &&
      z <= door.z + TILE_SIZE + TILE_EPSILON,
  );
}

/**
 * Whether every vertex of a merged geometry lies on one of the door tiles. An
 * empty geometry and an empty door set are both false: there is nothing to hide.
 */
export function isDoorTileGeometry(
  positions: ArrayLike<number>,
  doors: readonly Door[],
): boolean {
  if (doors.length === 0 || positions.length === 0) return false;
  for (let i = 0; i + 2 < positions.length; i += 3) {
    if (!onDoorTile(positions[i]!, positions[i + 2]!, doors)) return false;
  }
  return true;
}
