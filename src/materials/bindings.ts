// The one table that says which of US1's five materials a surface wears
// (FR-008). Pure data in, a material name out: no three.js, no DOM, so every
// claim US3-S1, US3-S3 and US3-S4 make is decided under `npm run test`.
//
// Two constraints shape the assignment, and they pull against each other.
// 002 declares five wall type IDs and US1 declares five materials, so a
// one-to-one wall mapping would leave nothing for the floor and the ceiling —
// and US3-S4 requires that neither of those samples a wall texture. The way out
// is that 002's wall names are colour labels, not material identities: '1' and
// '2' both read as brick and '3' and '5' both read as steel, which reserves
// `stone` for the floor and `blood-stone` for the ceiling and the doors. A door
// therefore differs from every wall material in the level, which is US3-S3.
//
// A secret is the deliberate exception: 004 established that an unpushed
// push-wall is found by pushing and not by looking, so it takes the material of
// the run it is embedded in rather than one of its own.

import { DEFAULT_WALL_MATERIAL, WALL_MATERIALS } from '../level';
import { recordFallback } from './diagnostics';
import type { MaterialName } from './table';

/** The classes of surface this spec binds, beside the per-type wall runs. */
export type SurfaceKind = 'door' | 'floor' | 'ceiling';

/** The axis a push-wall travels along, as 004 declares it. */
export type SecretAxis = 'x' | 'z';

/** One of the five, chosen per wall type ID 002 declares (FR-008, US3-S1). */
export const WALL_TYPE_MATERIALS: Readonly<Record<string, MaterialName>> = {
  '1': 'brick',
  '2': 'brick',
  '3': 'steel',
  '4': 'wood',
  '5': 'steel',
};

/** A door reads as a door before it is touched (US3-S3). */
export const DOOR_MATERIAL: MaterialName = 'blood-stone';

/** Neither of these appears on any wall type, so US3-S4 holds by construction. */
export const FLOOR_MATERIAL: MaterialName = 'stone';
export const CEILING_MATERIAL: MaterialName = 'blood-stone';

/**
 * What 002's `DEFAULT_WALL_MATERIAL` resolves to here. An unmapped wall type ID
 * renders in this material rather than untextured — the substitution FR-008
 * requires, recorded rather than silent.
 */
export const BINDING_FALLBACK_MATERIAL: MaterialName = 'stone';

const SURFACE_MATERIALS: Readonly<Record<SurfaceKind, MaterialName>> = {
  door: DOOR_MATERIAL,
  floor: FLOOR_MATERIAL,
  ceiling: CEILING_MATERIAL,
};

/**
 * The material a wall type ID wears. An ID with no entry falls through to 002's
 * declared default and the substitution is recorded once, by ID, so a malformed
 * grid is legible in `__diag.materials.fallbacks` instead of invisible.
 */
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

/**
 * The material a push-wall wears: the one worn by the wall run it hides in, so
 * it is indistinguishable from that run until it moves. A push-wall travelling
 * on x lies in a run along z, so its neighbours in that run are the tiles above
 * and below it — the convention 004's `secretWallColor` already established.
 */
export function materialForSecretAt(
  grid: readonly string[],
  x: number,
  z: number,
  axis: SecretAxis,
): MaterialName {
  const neighbours: readonly (readonly [number, number])[] =
    axis === 'x'
      ? [
          [x, z - 1],
          [x, z + 1],
        ]
      : [
          [x - 1, z],
          [x + 1, z],
        ];
  for (const [nx, nz] of neighbours) {
    const cell = grid[nz]?.[nx] ?? ' ';
    const bound = WALL_TYPE_MATERIALS[cell];
    if (bound != null) return bound;
  }
  return BINDING_FALLBACK_MATERIAL;
}

/** Every material a declared wall type wears, deduplicated. US3-S4 is the
 *  assertion that the floor's and the ceiling's materials are not in this list. */
export function wallMaterialsInUse(): MaterialName[] {
  const seen = new Set<MaterialName>();
  for (const type of Object.keys(WALL_MATERIALS)) {
    seen.add(WALL_TYPE_MATERIALS[type] ?? BINDING_FALLBACK_MATERIAL);
  }
  return [...seen];
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
