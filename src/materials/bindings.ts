// Which of US1's five materials every surface 002 and 004 emit is skinned with
// (FR-008). Pure data and pure functions: no three.js, no DOM, so US3-S1, S3 and
// S4 are decided under `npm run test` rather than by looking at a screenshot.
//
// Two constraints shape the table, and neither is free:
//
//   * US3-S4 — floor and ceiling must not sample a *wall* texture, and must
//     differ from each other. With five materials that leaves at most three for
//     the walls, so 002's five wall type IDs collapse onto three names. 002's
//     `WALL_MATERIALS` names are labels on flat debug colours; the procedural set
//     is smaller and its members are what the level actually reads as.
//   * US3-S3 — a door has to read as a door before it is touched, so its
//     material may not be the material of any wall it is set into. The same is
//     asked of a secret, which is why `adjacentWallMaterials` exists here rather
//     than in a test: the rule is checked against the shipped grid.

import { CEILING_Y, DEFAULT_WALL_MATERIAL, FLOOR_Y, TILE_SIZE, WALL_MATERIALS } from '../level';
import { recordFallback } from './diagnostics';
import type { MaterialName } from './table';

/** What a mesh in the scene is, once it has been recognised. */
export type SurfaceKind = 'wall' | 'door' | 'secret' | 'floor' | 'ceiling' | 'unknown';

export interface Surface {
  readonly kind: SurfaceKind;
  /** The grid cell character, for `kind: 'wall'` only. */
  readonly type?: string;
}

export interface SurfaceBinding {
  readonly material: MaterialName;
  /** True where the declared table had no entry and the default stood in. */
  readonly fallback: boolean;
}

/**
 * 002's wall type IDs onto US1's material names (FR-008, US3-S1). Exactly one
 * name per ID — a list would make "which texture is this wall" a runtime
 * question, and it is a declaration.
 */
export const WALL_TYPE_MATERIALS: Readonly<Record<string, MaterialName>> = {
  '1': 'stone', // 002: the solid outer border
  '2': 'brick', // 002: the brick partitions
  '3': 'steel', // 002: the metal partitions
  '4': 'stone', // 002 calls this wood; `wood` is the floor, so the partition is stone
  '5': 'steel', // 002: panel
};

/**
 * What 002's `DEFAULT_WALL_MATERIAL` resolves to. An unmapped type ID lands here
 * rather than rendering untextured (FR-008, US3-S1).
 */
export const DEFAULT_MATERIAL: MaterialName = 'stone';

/** 004's door leaves, its doorway shells, and the faces 002 emitted for `D`. */
export const DOOR_MATERIAL: MaterialName = 'wood';

/** 004's push-wall blocks, its recesses, and the faces 002 emitted for `S`. */
export const SECRET_MATERIAL: MaterialName = 'blood-stone';

/** 002's floor plane — its own material, and not one any wall uses (US3-S4). */
export const FLOOR_MATERIAL: MaterialName = 'wood';

/** 002's ceiling plane — likewise its own, and not the floor's (US3-S4). */
export const CEILING_MATERIAL: MaterialName = 'blood-stone';

/** The wall type IDs 002 declares, sorted, so the coverage check is over 002's
 * table rather than over this one. */
export function declaredWallTypes(): string[] {
  return Object.keys(WALL_MATERIALS).sort();
}

/** Every material name a wall can carry — the set floor and ceiling must stay
 * out of (US3-S4). */
export function wallMaterialNames(): MaterialName[] {
  return [...new Set(Object.values(WALL_TYPE_MATERIALS))];
}

/**
 * One wall type ID's material. An ID with no entry resolves to `DEFAULT_MATERIAL`
 * — 002's declared default — and says so, so the caller can record the
 * substitution rather than discovering it as a grey wall (FR-008, US3-S1).
 */
export function materialForWallType(type: string): SurfaceBinding {
  const declared = WALL_TYPE_MATERIALS[type];
  if (declared != null) return { material: declared, fallback: false };
  return { material: DEFAULT_MATERIAL, fallback: true };
}

/** The material a recognised surface carries, without recording anything. */
export function materialForSurface(surface: Surface): SurfaceBinding {
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

/** What a substitution is called on the page, so the reason names the surface
 * rather than the material that stood in for it. */
function fallbackReason(surface: Surface): string {
  return surface.kind === 'wall'
    ? `wall type '${surface.type ?? ''}' has no entry in the material table; ` +
        `002's default material '${DEFAULT_WALL_MATERIAL.name}' stood in as '${DEFAULT_MATERIAL}'`
    : `an unrecognised lit surface fell back to '${DEFAULT_MATERIAL}'`;
}

/**
 * `materialForSurface`, with the substitution published (FR-008). `recordFallback`
 * is idempotent per `(name, map)`, so a hundred meshes of one unmapped type cost
 * one line on the page rather than a hundred.
 */
export function bindSurface(surface: Surface): SurfaceBinding {
  const bound = materialForSurface(surface);
  if (bound.fallback) {
    recordFallback({ name: bound.material, map: 'binding', reason: fallbackReason(surface) });
  }
  return bound;
}

/**
 * The materials of the wall tiles a door or secret at `(x, z)` is set into — the
 * neighbours on the axis it is not free to move along, which is the pair 004
 * already reads to colour a push-wall. What US3-S3 is measured against.
 */
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
    const cell = grid[nz]?.[nx];
    if (cell == null) continue;
    const material = WALL_TYPE_MATERIALS[cell];
    if (material != null && !found.includes(material)) found.push(material);
  }
  return found;
}

// --- Recognising a surface from the geometry it is drawn as ----------------
//
// 002 owns the merged level meshes and 004 owns the door leaves, the push-wall
// blocks and both shells; this spec edits neither, and neither labels its meshes.
// So a mesh is recognised by where its vertices lie, against the same grid that
// produced them. That keeps the recognition pure, and therefore tested — the
// alternative is a `userData` tag, which would mean editing four files this spec
// is not allowed to touch and trusting them to keep setting it.

/** Slack on a tile boundary, in world units. Every vertex of an axis-aligned
 * face lies exactly on one, so this only absorbs float32 rounding. */
const TILE_EPSILON = 1e-4;

/** How close to an axis a normal must be to count as facing along it. A wall
 * face and a floor quad are exactly axis-aligned; a prop's facets are not, and
 * are meant to fall through to `unknown`. */
const AXIS_TOLERANCE = 0.999;

/** How far a horizontal quad's centroid may sit from the declared floor or
 * ceiling plane, in world units, and still be that plane. */
const PLANE_EPSILON = 1e-3;

export interface SurfaceOffset {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

const ORIGIN: SurfaceOffset = { x: 0, y: 0, z: 0 };

const UNKNOWN: Surface = { kind: 'unknown' };

function isWallCell(cell: string | undefined): boolean {
  return cell != null && cell >= '1' && cell <= '9';
}

/** The two tile indices a world coordinate can belong to: one, or two where it
 * sits exactly on a boundary and so touches the tile on either side. */
function tileCandidates(value: number): readonly number[] {
  const low = Math.floor((value - TILE_EPSILON) / TILE_SIZE);
  const high = Math.floor((value + TILE_EPSILON) / TILE_SIZE);
  return low === high ? [low] : [low, high];
}

/** Whether every vertex of the buffer stands on a tile of `cell` — true of the
 * faces 002 emitted for a `D` or `S` tile, of 004's leaf and block, and of both
 * of its shells, and of nothing else in the level. */
function allVerticesOnCell(
  positions: ArrayLike<number>,
  offset: SurfaceOffset,
  grid: readonly string[],
  cell: string,
): boolean {
  for (let i = 0; i + 2 < positions.length; i += 3) {
    const x = positions[i]! + offset.x;
    const z = positions[i + 2]! + offset.z;
    let found = false;
    for (const tx of tileCandidates(x)) {
      for (const tz of tileCandidates(z)) {
        if (grid[tz]?.[tx] === cell) found = true;
      }
    }
    if (!found) return false;
  }
  return true;
}

/** One triangle's surface, from its centroid and the normal it faces. */
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
  // A vertical face lies on the plane between the tile it belongs to and the open
  // tile it is seen from, so the normal is the only thing that says which is
  // which: step half a tile back along it and read the cell there.
  if (Math.abs(ny) > 1 - AXIS_TOLERANCE) return UNKNOWN;
  const tx = Math.floor((cx - (nx * TILE_SIZE) / 2) / TILE_SIZE);
  const tz = Math.floor((cz - (nz * TILE_SIZE) / 2) / TILE_SIZE);
  const cell = grid[tz]?.[tx];
  return isWallCell(cell) ? { kind: 'wall', type: cell! } : UNKNOWN;
}

function sameSurface(a: Surface, b: Surface): boolean {
  return a.kind === b.kind && a.type === b.type;
}

/**
 * What a mesh is, from its vertices alone (FR-008). `indices` is the geometry's
 * index buffer where it has one; `offset` is the mesh's own position, so a door
 * leaf drawn in local coordinates is still recognised by the tile it stands on.
 *
 * Door and secret tiles are tested first and as a whole-mesh property, because
 * both of 004's shells mix floor, ceiling and jamb quads that would otherwise
 * classify three different ways and resolve to `unknown`.
 *
 * A mesh whose triangles disagree is `unknown`, not a majority vote: guessing a
 * wall type for a prop is how a health pack ends up rendered as brick.
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
    const v = [0, 1, 2].map((corner) =>
      indices != null ? indices[triangle + corner]! : triangle + corner,
    );
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (const vertex of v) {
      cx += positions[vertex * 3]!;
      cy += positions[vertex * 3 + 1]!;
      cz += positions[vertex * 3 + 2]!;
    }
    const first = v[0]! * 3;
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
    else if (!sameSurface(agreed, surface)) return UNKNOWN;
  }
  return agreed ?? UNKNOWN;
}
