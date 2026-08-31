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

import { DEFAULT_WALL_MATERIAL, WALL_MATERIALS } from '../level';
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
