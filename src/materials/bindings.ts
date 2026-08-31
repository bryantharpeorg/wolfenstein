// Which material every surface wears, and how unlabelled merged geometry says
// which surface it is (FR-008). Doors, secrets, floor and ceiling each need a
// material no wall type uses, leaving three of US1's five for 002's five wall
// type IDs. Data only: no three.js, no DOM.

import { CEILING_Y, DEFAULT_WALL_MATERIAL, FLOOR_Y, LEVEL_GRID, TILE_SIZE } from '../level';
import { recordFallback } from './diagnostics';
import type { MaterialName } from './table';

export type NonWallKind = 'door' | 'secret' | 'floor' | 'ceiling';

export type Surface =
  | { readonly kind: 'wall'; readonly type: string }
  | { readonly kind: NonWallKind };

/** `'4'`/`'5'` share with `'2'`/`'3'`: wood and blood-stone are spent below. */
export const WALL_TYPE_MATERIALS: Readonly<Record<string, MaterialName>> = {
  '1': 'stone',
  '2': 'brick',
  '3': 'steel',
  '4': 'brick',
  '5': 'steel',
};

/** Where an unmapped ID lands — 002's `DEFAULT_WALL_MATERIAL`, as masonry. */
export const DEFAULT_MATERIAL: MaterialName = 'stone';

/** The four non-wall classes, each outside the wall set (US3-S3, US3-S4). */
export const SURFACE_MATERIALS: Readonly<Record<NonWallKind, MaterialName>> = {
  door: 'wood',
  secret: 'blood-stone',
  floor: 'blood-stone',
  ceiling: 'wood',
};

/** What a mesh that is no level surface wears. It shares steel's maps, so no
 * sixth set is uploaded. */
export const PROP_MATERIAL: MaterialName = 'steel';

/** One ID to one material; no entry means 002's default, recorded (US3-S1). */
export function materialForWallType(type: string): MaterialName {
  const bound = WALL_TYPE_MATERIALS[type];
  if (bound != null) return bound;
  recordFallback({
    name: DEFAULT_MATERIAL,
    map: 'binding',
    reason: `wall type ID '${type}' unmapped; used 002 default '${DEFAULT_WALL_MATERIAL.name}'`,
  });
  return DEFAULT_MATERIAL;
}

/** One surface to one material. Total: every surface class has a binding. */
export const materialForSurface = (surface: Surface): MaterialName =>
  surface.kind === 'wall' ? materialForWallType(surface.type) : SURFACE_MATERIALS[surface.kind];

// 002's and 004's merged meshes carry no label, and labelling them would mean
// editing files this spec does not own. They need none: a triangle on a
// structural plane is named by the grid cell behind it, and one on no such
// plane is no level surface at all — which is what a prop is.

const PLANE_EPSILON = 1e-3;
const BEHIND = TILE_SIZE / 4;
const AXIS_DOMINANCE = 0.9;

const near = (v: number, plane: number): boolean => Math.abs(v - plane) < PLANE_EPSILON;

const onTileBoundary = (v: number): boolean =>
  Math.abs(v / TILE_SIZE - Math.round(v / TILE_SIZE)) < PLANE_EPSILON;

const cellAt = (grid: readonly string[], x: number, z: number): string =>
  grid[Math.floor(z / TILE_SIZE)]?.[Math.floor(x / TILE_SIZE)] ?? ' ';

function surfaceForCell(cell: string): Surface | null {
  if (cell === 'D' || cell === 'S') return { kind: cell === 'D' ? 'door' : 'secret' };
  // A digit outside the table is still a wall: it resolves to the default.
  return cell >= '1' && cell <= '9' ? { kind: 'wall', type: cell } : null;
}

function surfaceForTriangle(
  grid: readonly string[],
  [cx, cy, cz]: readonly number[],
  [nx, ny, nz]: readonly number[],
): Surface | null {
  if (Math.abs(ny!) > AXIS_DOMINANCE) {
    if (!near(cy!, FLOOR_Y) && !near(cy!, CEILING_Y)) return null;
    const cell = cellAt(grid, cx!, cz!);
    if (cell === 'D' || cell === 'S') return surfaceForCell(cell);
    return { kind: near(cy!, FLOOR_Y) ? 'floor' : 'ceiling' };
  }
  if (Math.abs(nx!) > AXIS_DOMINANCE) {
    return onTileBoundary(cx!) ? surfaceForCell(cellAt(grid, cx! - nx! * BEHIND, cz!)) : null;
  }
  if (Math.abs(nz!) > AXIS_DOMINANCE) {
    return onTileBoundary(cz!) ? surfaceForCell(cellAt(grid, cx!, cz! - nz! * BEHIND)) : null;
  }
  return null;
}

const surfaceKey = (s: Surface): string => (s.kind === 'wall' ? `wall:${s.type}` : s.kind);

/**
 * The surface a whole geometry belongs to, by a vote of its triangles, so a
 * mesh of mixed faces (a doorway shell is its own floor, ceiling and jambs)
 * still resolves to one material. `positions`/`normals` are world-space and
 * parallel; `index` is the geometry's, or null for unindexed soup. Null means
 * no triangle lay on a structural plane, which is what a prop is.
 */
export function classifySurface(
  positions: ArrayLike<number>,
  normals: ArrayLike<number>,
  index: ArrayLike<number> | null = null,
  grid: readonly string[] = LEVEL_GRID,
): Surface | null {
  if (positions.length !== normals.length) {
    throw new Error(`classifySurface: ${positions.length} positions, ${normals.length} normals`);
  }
  const corners = index ?? { length: positions.length / 3 };
  const votes = new Map<string, { surface: Surface; count: number }>();

  for (let t = 0; t + 2 < corners.length; t += 3) {
    const at = [0, 1, 2].map((k) => (index != null ? index[t + k]! : t + k) * 3);
    const mean = (a: ArrayLike<number>, axis: number): number =>
      (a[at[0]! + axis]! + a[at[1]! + axis]! + a[at[2]! + axis]!) / 3;
    const surface = surfaceForTriangle(
      grid,
      [mean(positions, 0), mean(positions, 1), mean(positions, 2)],
      [mean(normals, 0), mean(normals, 1), mean(normals, 2)],
    );
    if (surface == null) continue;
    const entry = votes.get(surfaceKey(surface));
    if (entry == null) votes.set(surfaceKey(surface), { surface, count: 1 });
    else entry.count += 1;
  }

  let winner: Surface | null = null;
  let best = 0;
  for (const entry of votes.values()) {
    if (entry.count > best) [best, winner] = [entry.count, entry.surface];
  }
  return winner;
}
