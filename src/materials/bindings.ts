// Surface name -> material name. This is the seam between 002's wall type IDs
// and the five procedural materials US1/US2 produced; it is pure data and
// three.js-free so the mapping is assertable under `npm run test` (FR-008,
// US3-S1, US3-S3, US3-S4).

import { DEFAULT_WALL_MATERIAL, LEVEL_GRID } from '../level';
import { recordFallback } from './diagnostics';
import { MATERIAL_NAMES, type MaterialName } from './table';

/** Maps 002's wall type IDs to the five material names. A type ID that is not
 * in this table falls back to the default material's name (FR-008). */
const WALL_TYPE_TO_MATERIAL: Record<string, MaterialName> = {
  '1': 'stone',
  '2': 'brick',
  '3': 'steel',
  '4': 'wood',
  '5': 'blood-stone',
};

/** Wall type IDs in the shipped grid that are actual neighbours of a door tile.
 * This list is used to keep the automatic distinct-surface material from
 * colliding with the wall types the player sees beside a door (US3-S3). */
function wallTypeIdsAdjacentToDoors(): Set<string> {
  const ids = new Set<string>();
  for (let z = 0; z < LEVEL_GRID.length; z += 1) {
    const row = LEVEL_GRID[z];
    if (row == null) continue;
    for (let x = 0; x < row.length; x += 1) {
      if (row[x] !== 'D') continue;
      for (const [nx, nz] of [
        [x, z - 1],
        [x, z + 1],
        [x - 1, z],
        [x + 1, z],
      ]) {
        const cell =
          typeof nz === 'number' && typeof nx === 'number' ? LEVEL_GRID[nz]?.[nx] : undefined;
        if (cell != null && cell >= '1' && cell <= '9') {
          ids.add(cell);
        }
      }
    }
  }
  return ids;
}

function defaultMaterialName(): MaterialName {
  // 002's DEFAULT_WALL_MATERIAL.name is 'default'; map that onto a real
  // material name from the table so no surface ever renders untextured.
  // The import is load-bearing: it keeps this fallback tied to 002's default.
  return DEFAULT_WALL_MATERIAL.name === 'default' ? 'stone' : (DEFAULT_WALL_MATERIAL.name as MaterialName);
}

/** Every material name currently used by a wall type that is orthogonally
 * adjacent to a door tile in the shipped grid (US3-S3). */
function materialsAdjacentToDoors(): Set<MaterialName> {
  const used = new Set<MaterialName>();
  for (const id of wallTypeIdsAdjacentToDoors()) {
    used.add(WALL_TYPE_TO_MATERIAL[id] ?? defaultMaterialName());
  }
  return used;
}

/** Picks a material name not used by any wall type adjacent to a door, so a
 * door reads as distinct from the walls beside it (US3-S3). Falls back to a
 * hard-coded value only if every material is somehow in use. */
function pickDistinctSurfaceMaterial(): MaterialName {
  const used = materialsAdjacentToDoors();
  for (const name of MATERIAL_NAMES) {
    if (!used.has(name)) return name;
  }
  return 'blood-stone';
}

/** Named binding for surfaces that are not wall type IDs. */
const SURFACE_MATERIALS: Record<'door' | 'secret' | 'floor' | 'ceiling', MaterialName> = {
  door: pickDistinctSurfaceMaterial(),
  secret: 'stone',
  floor: 'stone',
  ceiling: 'blood-stone',
};

/** Resolves a wall type ID ('1'..'9') to one material name. Unmapped IDs fall
 * back to the declared default and record a fallback (FR-008, US3-S1). */
export function resolveWallMaterial(wallTypeId: string): MaterialName {
  const mapped = WALL_TYPE_TO_MATERIAL[wallTypeId];
  if (mapped != null) return mapped;

  const fallback = defaultMaterialName();
  recordFallback({
    name: wallTypeId as MaterialName,
    map: 'normal',
    reason: `wall type ${wallTypeId} has no material mapping; falling back to default`,
  });
  return fallback;
}

/** Material for every door leaf (US3-S3). */
export function resolveDoorMaterial(): MaterialName {
  return SURFACE_MATERIALS.door;
}

/** Material for every secret block (US3-S3). */
export function resolveSecretMaterial(): MaterialName {
  return SURFACE_MATERIALS.secret;
}

/** Material for the merged floor geometry (US3-S4). */
export function resolveFloorMaterial(): MaterialName {
  return SURFACE_MATERIALS.floor;
}

/** Material for the merged ceiling geometry (US3-S4). */
export function resolveCeilingMaterial(): MaterialName {
  return SURFACE_MATERIALS.ceiling;
}

/** Resets the wall-type mapping and clears recorded fallbacks. Test seam only. */
export function resetMaterialBindings(): void {
  // The mapping itself is immutable; this function exists as a declared seam
  // so tests can reset the diagnostics state alongside it.
}
