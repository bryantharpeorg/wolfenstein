// Which of US1's five materials every surface 002 and 004 emit is skinned with
// (FR-008). Pure, so US3-S1, S3 and S4 are decided under `npm run test`.
//
// US3-S4 keeps floor and ceiling off any wall texture and apart from each other,
// leaving three of the five for walls, so 002's five type IDs collapse onto three
// names. US3-S3 asks a door to read as a door before it is touched, so its
// material may not be any wall's it is set into — likewise a secret, which
// `adjacentWallMaterials` checks against the shipped grid.

import { CEILING_Y, DEFAULT_WALL_MATERIAL, FLOOR_Y, TILE_SIZE, WALL_MATERIALS } from '../level';
import { recordFallback } from './diagnostics';
import type { MaterialName } from './table';

/** What a mesh is; `type` is the grid cell, for walls only. */
export type SurfaceKind = 'wall' | 'door' | 'secret' | 'floor' | 'ceiling' | 'unknown';

export interface Surface {
  readonly kind: SurfaceKind;
  readonly type?: string;
}

/** `fallback` is true where the table had no entry and the default stood in. */
export interface SurfaceBinding {
  readonly material: MaterialName;
  readonly fallback: boolean;
}

/** 002's wall type IDs onto US1's material names, one apiece: "which texture is
 * this wall" is a declaration, not a runtime question (FR-008, US3-S1). */
export const WALL_TYPE_MATERIALS: Readonly<Record<string, MaterialName>> = {
  '1': 'stone', // 002: the solid outer border
  '2': 'brick', // 002: the brick partitions
  '3': 'steel', // 002: the metal partitions
  '4': 'stone', // 002 calls this wood; `wood` is the floor, so the partition is stone
  '5': 'steel', // 002: panel
};

/** Where an unmapped ID lands rather than rendering untextured (FR-008). */
export const DEFAULT_MATERIAL: MaterialName = 'stone';

/** 004's leaves, blocks and shells, and 002's `D` and `S` faces. */
export const DOOR_MATERIAL: MaterialName = 'wood';
export const SECRET_MATERIAL: MaterialName = 'blood-stone';

/** Each its own, and neither a wall's (US3-S4). */
export const FLOOR_MATERIAL: MaterialName = 'wood';
export const CEILING_MATERIAL: MaterialName = 'blood-stone';

/** 002's wall type IDs, so the coverage check is over its table. */
export function declaredWallTypes(): string[] {
  return Object.keys(WALL_MATERIALS).sort();
}

/** What a wall can carry — the set floor and ceiling stay out of. */
export function wallMaterialNames(): MaterialName[] {
  return [...new Set(Object.values(WALL_TYPE_MATERIALS))];
}

/** One ID's material; one with no entry resolves to the default and says so, so
 * the caller records it rather than meeting a grey wall. */
export function materialForWallType(type: string): SurfaceBinding {
  const declared = WALL_TYPE_MATERIALS[type];
  if (declared != null) return { material: declared, fallback: false };
  return { material: DEFAULT_MATERIAL, fallback: true };
}

function materialForSurface(surface: Surface): SurfaceBinding {
  switch (surface.kind) {
    case 'wall':
      return materialForWallType(surface.type ?? '');
    case 'door':
      return { material: DOOR_MATERIAL, fallback: false };
    case 'secret':
      return { material: SECRET_MATERIAL, fallback: false };
    case 'floor':
      return { material: FLOOR_MATERIAL, fallback: false };
    case 'ceiling':
      return { material: CEILING_MATERIAL, fallback: false };
    case 'unknown':
      return { material: DEFAULT_MATERIAL, fallback: true };
  }
}

/** `materialForSurface`, with the substitution published (FR-008). Recording is
 * idempotent per `(name, map)`: a hundred meshes of one unmapped type cost one
 * line. */
export function bindSurface(surface: Surface): SurfaceBinding {
  const bound = materialForSurface(surface);
  if (bound.fallback) {
    recordFallback({
      name: bound.material,
      map: 'binding',
      reason:
        surface.kind === 'wall'
          ? `wall type '${surface.type ?? ''}' has no entry in the material table; 002's ` +
            `default '${DEFAULT_WALL_MATERIAL.name}' stood in as '${DEFAULT_MATERIAL}'`
          : `an unrecognised lit surface fell back to '${DEFAULT_MATERIAL}'`,
    });
  }
  return bound;
}

/** The materials of the wall tiles a door or secret at `(x, z)` is set into —
 * US3-S3's measure. */
export function adjacentWallMaterials(
  grid: readonly string[],
  x: number,
  z: number,
): MaterialName[] {
  const found: MaterialName[] = [];
  const neighbours: Array<readonly [number, number]> = [
    [x - 1, z],
    [x + 1, z],
    [x, z - 1],
    [x, z + 1],
  ];
  for (const [nx, nz] of neighbours) {
    const material = WALL_TYPE_MATERIALS[grid[nz]?.[nx] ?? ''];
    if (material != null && !found.includes(material)) found.push(material);
  }
  return found;
}

// --- Recognising a surface from the geometry it is drawn as ----------------
//
// 002 and 004 own the meshes, this spec edits neither, and neither labels them.
// So a mesh is recognised by where its vertices lie against the grid that
// produced them — pure, and therefore tested. A `userData` tag would instead mean
// editing four files this spec may not touch and trusting each to keep it.

/** Slack on a tile boundary: float32 rounding only. */
const TILE_EPSILON = 1e-4;

/** How close to an axis a normal must be to face along it: walls and floors are
 * exactly axis-aligned, a prop's facets are not and fall to `unknown`. */
const AXIS_TOLERANCE = 0.999;

/** How far a horizontal quad's centroid may sit from a declared plane. */
const PLANE_EPSILON = 1e-3;

export interface SurfaceOffset {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

const ORIGIN: SurfaceOffset = { x: 0, y: 0, z: 0 };
const UNKNOWN: Surface = { kind: 'unknown' };

/** The tiles a coordinate belongs to: one, or two on a boundary. */
function tileCandidates(value: number): readonly number[] {
  const low = Math.floor((value - TILE_EPSILON) / TILE_SIZE);
  const high = Math.floor((value + TILE_EPSILON) / TILE_SIZE);
  return low === high ? [low] : [low, high];
}

/** True of 002's `D` and `S` faces and 004's leaf, block and shells, of nothing
 * else in the level. */
function allVerticesOnCell(
  positions: ArrayLike<number>,
  offset: SurfaceOffset,
  grid: readonly string[],
  cell: string,
): boolean {
  for (let i = 0; i + 2 < positions.length; i += 3) {
    let found = false;
    for (const tx of tileCandidates(positions[i]! + offset.x)) {
      for (const tz of tileCandidates(positions[i + 2]! + offset.z)) {
        if (grid[tz]?.[tx] === cell) found = true;
      }
    }
    if (!found) return false;
  }
  return true;
}

/** One triangle's surface. A vertical face lies on the plane between the tile it
 * belongs to and the open tile it is seen from, so only the normal says which:
 * step half a tile back along it and read the cell there. */
function classifyTriangle(
  cx: number,
  cy: number,
  cz: number,
  nx: number,
  ny: number,
  nz: number,
  grid: readonly string[],
): Surface {
  if (ny >= AXIS_TOLERANCE) {
    return Math.abs(cy - FLOOR_Y) <= PLANE_EPSILON ? { kind: 'floor' } : UNKNOWN;
  }
  if (ny <= -AXIS_TOLERANCE) {
    return Math.abs(cy - CEILING_Y) <= PLANE_EPSILON ? { kind: 'ceiling' } : UNKNOWN;
  }
  if (Math.abs(ny) > 1 - AXIS_TOLERANCE) return UNKNOWN;
  const tx = Math.floor((cx - (nx * TILE_SIZE) / 2) / TILE_SIZE);
  const tz = Math.floor((cz - (nz * TILE_SIZE) / 2) / TILE_SIZE);
  const cell = grid[tz]?.[tx];
  return cell != null && cell >= '1' && cell <= '9' ? { kind: 'wall', type: cell } : UNKNOWN;
}

/**
 * What a mesh is, from its vertices alone (FR-008). `offset` is the mesh's own
 * position, so a door leaf drawn in local coordinates is still recognised by the
 * tile it stands on. Door and secret tiles are tested first as a whole-mesh
 * property, because 004's shells mix floor, ceiling and jamb quads that would
 * otherwise classify three ways. A mesh whose triangles disagree is `unknown`,
 * not a majority vote: guessing a wall type for a prop is how a health pack ends
 * up brick.
 */
export function classifySurface(
  positions: ArrayLike<number>,
  normals: ArrayLike<number>,
  indices: ArrayLike<number> | null,
  grid: readonly string[],
  offset: SurfaceOffset = ORIGIN,
): Surface {
  if (positions.length === 0 || normals.length !== positions.length) return UNKNOWN;

  if (allVerticesOnCell(positions, offset, grid, 'D')) return { kind: 'door' };
  if (allVerticesOnCell(positions, offset, grid, 'S')) return { kind: 'secret' };

  const count = indices != null ? indices.length : positions.length / 3;
  if (count < 3) return UNKNOWN;

  let agreed: Surface | null = null;
  for (let triangle = 0; triangle + 2 < count; triangle += 3) {
    let cx = 0;
    let cy = 0;
    let cz = 0;
    let first = 0;
    for (let corner = 0; corner < 3; corner += 1) {
      const vertex = indices != null ? indices[triangle + corner]! : triangle + corner;
      if (corner === 0) first = vertex * 3;
      cx += positions[vertex * 3]!;
      cy += positions[vertex * 3 + 1]!;
      cz += positions[vertex * 3 + 2]!;
    }
    const surface = classifyTriangle(
      cx / 3 + offset.x,
      cy / 3 + offset.y,
      cz / 3 + offset.z,
      normals[first]!,
      normals[first + 1]!,
      normals[first + 2]!,
      grid,
    );
    if (surface.kind === 'unknown') return UNKNOWN;
    if (agreed == null) agreed = surface;
    else if (agreed.kind !== surface.kind || agreed.type !== surface.type) return UNKNOWN;
  }
  return agreed ?? UNKNOWN;
}
