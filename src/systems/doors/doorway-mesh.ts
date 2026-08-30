// The doorway's two geometry chores, both consequences of 002 treating a `D` tile
// as solid: the wall group it drew there has to be recognised so the doors system
// can hide it, and the floor, ceiling and jambs it never emitted have to be built,
// or an opened leaf would reveal a hole rather than a doorway.

import { BufferGeometry, Float32BufferAttribute } from 'three';
import { CEILING_Y, FLOOR_Y, TILE_SIZE } from '../../level';
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

/** Whether every vertex of a merged geometry lies on a door tile — true of 002's
 * `D` wall group and of no other, so the recognition is by the group's own
 * vertices rather than by an index into 002's build order. An empty geometry and
 * an empty door set are both false: nothing to hide. */
export function isDoorTileGeometry(positions: ArrayLike<number>, doors: readonly Door[]): boolean {
  if (doors.length === 0 || positions.length === 0) return false;
  for (let i = 0; i + 2 < positions.length; i += 3) {
    if (!onDoorTile(positions[i]!, positions[i + 2]!, doors)) return false;
  }
  return true;
}

/** One `BufferGeometry` carrying the doorway shell of every door in the field, so
 * the shell costs one draw call. Null when there are no doors, so the caller adds
 * no empty mesh. Quads are wound to face inward; normals are derived. */
export function buildDoorwayShell(doors: readonly Door[]): BufferGeometry | null {
  if (doors.length === 0) return null;

  const positions: number[] = [];
  const quad = (q: readonly number[]): void => {
    for (const i of [0, 1, 2, 0, 2, 3]) positions.push(q[i * 3]!, q[i * 3 + 1]!, q[i * 3 + 2]!);
  };

  for (const door of doors) {
    const x0 = door.x * TILE_SIZE;
    const x1 = x0 + TILE_SIZE;
    const z0 = door.z * TILE_SIZE;
    const z1 = z0 + TILE_SIZE;
    const [y0, y1] = [FLOOR_Y, CEILING_Y];

    quad([x0, y0, z1, x1, y0, z1, x1, y0, z0, x0, y0, z0]);
    quad([x0, y1, z0, x1, y1, z0, x1, y1, z1, x0, y1, z1]);
    // The jambs stand across the passage, at right angles to the leaf's axis.
    if (door.axis === 'z') {
      quad([x0, y0, z0, x1, y0, z0, x1, y1, z0, x0, y1, z0]);
      quad([x1, y0, z1, x0, y0, z1, x0, y1, z1, x1, y1, z1]);
    } else {
      quad([x0, y0, z1, x0, y0, z0, x0, y1, z0, x0, y1, z1]);
      quad([x1, y0, z0, x1, y0, z1, x1, y1, z1, x1, y1, z0]);
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}
