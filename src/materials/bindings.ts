// The one table saying which of US1's five materials a surface wears (FR-008).
// Pure data in, a name out, so US3-S1, S3 and S4 are decided under `npm run
// test`. 002's five wall IDs are colour labels, not material identities, so they
// bind many-to-one — which is what leaves `stone` for the floor and
// `blood-stone` for the ceiling and doors (US3-S3, US3-S4).

import { DEFAULT_WALL_MATERIAL, WALL_MATERIALS } from '../level';
import { recordFallback } from './diagnostics';
import type { MaterialName } from './table';

/** The surfaces bound beside the per-type wall runs. */
export type SurfaceKind = 'door' | 'floor' | 'ceiling';

/** One of the five, chosen per wall type ID 002 declares (FR-008, US3-S1). */
export const WALL_TYPE_MATERIALS: Readonly<Record<string, MaterialName>> = {
  '1': 'brick',
  '2': 'brick',
  '3': 'steel',
  '4': 'wood',
  '5': 'steel',
};

/** A door reads as a door before it is touched (US3-S3); neither of the other
 *  two appears on a wall type, so US3-S4 holds by construction. */
export const DOOR_MATERIAL: MaterialName = 'blood-stone';
export const FLOOR_MATERIAL: MaterialName = 'stone';
export const CEILING_MATERIAL: MaterialName = 'blood-stone';

/** What 002's `DEFAULT_WALL_MATERIAL` resolves to: an unmapped ID renders in
 *  this rather than untextured (FR-008). */
export const BINDING_FALLBACK_MATERIAL: MaterialName = 'stone';

const SURFACE_MATERIALS: Readonly<Record<SurfaceKind, MaterialName>> = {
  door: DOOR_MATERIAL,
  floor: FLOOR_MATERIAL,
  ceiling: CEILING_MATERIAL,
};

/** The material a wall type ID wears. An ID with no entry falls through to 002's
 *  declared default, recorded once by ID so a malformed grid is legible in
 *  `__diag.materials.fallbacks` instead of invisible. */
export function materialForWallType(type: string): MaterialName {
  const bound = WALL_TYPE_MATERIALS[type];
  if (bound != null) return bound;
  recordFallback({
    name: BINDING_FALLBACK_MATERIAL,
    map: 'binding',
    reason:
      `wall type '${type}' has no entry in the material table; ` +
      `002's default material '${DEFAULT_WALL_MATERIAL.name}' renders as ${BINDING_FALLBACK_MATERIAL}`,
  });
  return BINDING_FALLBACK_MATERIAL;
}

/** The material a door, the floor or the ceiling wears (US3-S3, US3-S4). */
export function materialForSurface(kind: SurfaceKind): MaterialName {
  return SURFACE_MATERIALS[kind];
}

/** The material a push-wall at (x, z) wears: the run it hides in, so it is
 *  indistinguishable until it moves — 004's rule that a secret is found by
 *  pushing, not by looking. Four neighbours, so either travel direction is
 *  answered; one with no wall beside it still resolves to a declared material. */
export function materialForSecretCell(
  grid: readonly string[],
  x: number,
  z: number,
): MaterialName {
  const neighbours = [grid[z - 1]?.[x], grid[z + 1]?.[x], grid[z]?.[x - 1], grid[z]?.[x + 1]];
  for (const cell of neighbours) {
    const bound = cell == null ? undefined : WALL_TYPE_MATERIALS[cell];
    if (bound != null) return bound;
  }
  return BINDING_FALLBACK_MATERIAL;
}

export interface BindingEntry {
  /** `wall:<id>`, or the surface class. */
  readonly surface: string;
  readonly material: MaterialName;
}

/** The whole binding, flattened — what the system reports and the tests walk. */
export function bindingSummary(): BindingEntry[] {
  const entries: BindingEntry[] = [];
  for (const type of Object.keys(WALL_MATERIALS).sort()) {
    entries.push({ surface: `wall:${type}`, material: WALL_TYPE_MATERIALS[type] ?? BINDING_FALLBACK_MATERIAL });
  }
  for (const kind of Object.keys(SURFACE_MATERIALS) as SurfaceKind[]) {
    entries.push({ surface: kind, material: SURFACE_MATERIALS[kind] });
  }
  return entries;
}
