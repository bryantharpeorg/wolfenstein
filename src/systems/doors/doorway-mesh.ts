/**
 * The geometry a doorway needs once its leaf can move.
 *
 * 002's face emitter treats a `D` tile as solid: it emits the two faces the tile
 * shows to the corridor and nothing else, and gives the tile no floor, no
 * ceiling and no side walls, because a closed door never reveals them. Once the
 * leaf slides away, all four are missing. This module builds them — one merged
 * geometry for every door tile in the level, so the whole shell costs one draw
 * call — in the same hand-written buffer idiom as `src/geometry/faces.ts`.
 *
 * The jambs sit on the leaf's travel axis, so a retracting leaf disappears
 * behind the recess wall rather than poking out of the level.
 */
import { BufferAttribute, BufferGeometry } from 'three';
import { CEILING_Y, FLOOR_Y, TILE_SIZE } from '../../level';
import type { Door } from '../../interaction/door';

const VERTICES_PER_QUAD = 4;
const INDICES_PER_QUAD = 6;
const QUAD_UVS = [0, 0, 1, 0, 1, 1, 0, 1];

interface Quad {
  /** Four corners, wound counter-clockwise as seen from the normal's side. */
  readonly corners: readonly number[];
  readonly normal: readonly [number, number, number];
}

/** Floor, ceiling and the two recess jambs of one door tile. */
function quadsForDoor(door: Door): Quad[] {
  const x0 = door.x * TILE_SIZE;
  const x1 = x0 + TILE_SIZE;
  const z0 = door.z * TILE_SIZE;
  const z1 = z0 + TILE_SIZE;
  const y0 = FLOOR_Y;
  const y1 = CEILING_Y;

  const quads: Quad[] = [
    { corners: [x0, y0, z1, x1, y0, z1, x1, y0, z0, x0, y0, z0], normal: [0, 1, 0] },
    { corners: [x0, y1, z0, x1, y1, z0, x1, y1, z1, x0, y1, z1], normal: [0, -1, 0] },
  ];

  if (door.axis === 'z') {
    quads.push({ corners: [x0, y0, z0, x1, y0, z0, x1, y1, z0, x0, y1, z0], normal: [0, 0, 1] });
    quads.push({ corners: [x1, y0, z1, x0, y0, z1, x0, y1, z1, x1, y1, z1], normal: [0, 0, -1] });
  } else {
    quads.push({ corners: [x0, y0, z1, x0, y0, z0, x0, y1, z0, x0, y1, z1], normal: [1, 0, 0] });
    quads.push({ corners: [x1, y0, z0, x1, y0, z1, x1, y1, z1, x1, y1, z0], normal: [-1, 0, 0] });
  }

  return quads;
}

/**
 * One `BufferGeometry` carrying the doorway shell of every door in the field.
 * Returns null when there are no doors, so the caller adds no empty mesh.
 */
export function buildDoorwayShell(doors: readonly Door[]): BufferGeometry | null {
  const quads = doors.flatMap(quadsForDoor);
  if (quads.length === 0) return null;

  const positions = new Float32Array(quads.length * VERTICES_PER_QUAD * 3);
  const normals = new Float32Array(quads.length * VERTICES_PER_QUAD * 3);
  const uvs = new Float32Array(quads.length * VERTICES_PER_QUAD * 2);
  const indices = new Uint32Array(quads.length * INDICES_PER_QUAD);

  quads.forEach((quad, quadIndex) => {
    const baseVertex = quadIndex * VERTICES_PER_QUAD;
    for (let corner = 0; corner < VERTICES_PER_QUAD; corner += 1) {
      const vertex = baseVertex + corner;
      positions[vertex * 3] = quad.corners[corner * 3]!;
      positions[vertex * 3 + 1] = quad.corners[corner * 3 + 1]!;
      positions[vertex * 3 + 2] = quad.corners[corner * 3 + 2]!;
      normals[vertex * 3] = quad.normal[0];
      normals[vertex * 3 + 1] = quad.normal[1];
      normals[vertex * 3 + 2] = quad.normal[2];
      uvs[vertex * 2] = QUAD_UVS[corner * 2]!;
      uvs[vertex * 2 + 1] = QUAD_UVS[corner * 2 + 1]!;
    }
    const baseIndex = quadIndex * INDICES_PER_QUAD;
    indices[baseIndex] = baseVertex;
    indices[baseIndex + 1] = baseVertex + 1;
    indices[baseIndex + 2] = baseVertex + 2;
    indices[baseIndex + 3] = baseVertex;
    indices[baseIndex + 4] = baseVertex + 2;
    indices[baseIndex + 5] = baseVertex + 3;
  });

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new BufferAttribute(uvs, 2));
  geometry.setIndex(new BufferAttribute(indices, 1));
  return geometry;
}
