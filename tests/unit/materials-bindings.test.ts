import { describe, it, expect, beforeEach } from 'vitest';
import { DEFAULT_WALL_MATERIAL, LEVEL_GRID, WALL_MATERIALS } from '../../src/level';
import { MATERIAL_NAMES } from '../../src/materials/table';
import {
  DEFAULT_MATERIAL,
  PROP_MATERIAL,
  SURFACE_MATERIALS,
  WALL_TYPE_MATERIALS,
  classifySurface,
  materialForSurface,
  materialForWallType,
} from '../../src/materials/bindings';
import { materialDiagnostics, resetMaterialDiagnostics } from '../../src/materials/diagnostics';

// FR-008 / US3-S1 / US3-S3 / US3-S4: every wall type ID 002 declares resolves to
// exactly one of US1's five materials, an ID with no entry resolves to 002's
// declared default rather than to nothing, and doors, secrets, floor and ceiling
// each resolve to a declared material of their own.

const WALL_TYPE_IDS = Object.keys(WALL_MATERIALS);
const wallMaterials = (): Set<string> => new Set(WALL_TYPE_IDS.map(materialForWallType));

/** The wall type IDs sitting immediately beside every `cell` tile in the grid. */
function neighboursOf(cell: string): string[] {
  const found = new Set<string>();
  LEVEL_GRID.forEach((row, z) => {
    [...row].forEach((tile, x) => {
      if (tile !== cell) return;
      for (const [nx, nz] of [[x - 1, z], [x + 1, z], [x, z - 1], [x, z + 1]] as const) {
        const neighbour = LEVEL_GRID[nz]?.[nx];
        if (neighbour != null && WALL_MATERIALS[neighbour] != null) found.add(neighbour);
      }
    });
  });
  return [...found];
}

beforeEach(resetMaterialDiagnostics);

describe('the wall type table (US3-S1)', () => {
  it('maps every ID 002 declares to exactly one of the five materials', () => {
    expect(WALL_TYPE_IDS.length).toBeGreaterThan(0);
    for (const id of WALL_TYPE_IDS) {
      expect(Object.prototype.hasOwnProperty.call(WALL_TYPE_MATERIALS, id)).toBe(true);
      expect(MATERIAL_NAMES).toContain(materialForWallType(id));
    }
    expect(materialDiagnostics().fallbacks).toHaveLength(0);
  });

  it('resolves an unmapped ID to 002 declared default and records it', () => {
    expect(WALL_MATERIALS['9']).toBeUndefined();
    expect(materialForWallType('9')).toBe(DEFAULT_MATERIAL);
    expect(MATERIAL_NAMES).toContain(DEFAULT_MATERIAL);
    const [fallback] = materialDiagnostics().fallbacks;
    expect(fallback?.name).toBe(DEFAULT_MATERIAL);
    expect(fallback?.map).toBe('binding');
    expect(fallback?.reason).toContain(DEFAULT_WALL_MATERIAL.name);
    // One entry per unmapped ID, however often it is resolved.
    materialForWallType('9');
    materialForWallType('8');
    expect(materialDiagnostics().fallbacks).toHaveLength(2);
  });
});

describe('doors, secrets, floor and ceiling (US3-S3, US3-S4)', () => {
  it('each resolve to a declared material no wall type uses', () => {
    for (const kind of ['door', 'secret', 'floor', 'ceiling'] as const) {
      const name = SURFACE_MATERIALS[kind];
      expect(MATERIAL_NAMES).toContain(name);
      expect(materialForSurface({ kind })).toBe(name);
      expect(wallMaterials().has(name)).toBe(false);
    }
    expect(SURFACE_MATERIALS.floor).not.toBe(SURFACE_MATERIALS.ceiling);
  });

  it('gives a door and a secret materials no wall beside them wears', () => {
    for (const [cell, name] of [
      ['D', SURFACE_MATERIALS.door],
      ['S', SURFACE_MATERIALS.secret],
    ] as const) {
      const beside = neighboursOf(cell);
      expect(beside.length).toBeGreaterThan(0);
      for (const id of beside) expect(materialForWallType(id)).not.toBe(name);
    }
  });

  it('leaves no surface unbound, and spends no more than the five materials', () => {
    expect(materialForSurface({ kind: 'wall', type: 'not-a-type' })).toBe(DEFAULT_MATERIAL);
    expect(MATERIAL_NAMES).toContain(PROP_MATERIAL);
    const used = new Set([
      ...wallMaterials(),
      ...Object.values(SURFACE_MATERIALS),
      DEFAULT_MATERIAL,
      PROP_MATERIAL,
    ]);
    expect(used.size).toBeLessThanOrEqual(MATERIAL_NAMES.length);
  });
});

describe('classifying a merged surface by its own geometry', () => {
  /** One triangle of a wall face on the plane `z`, facing -Z. */
  const north = (x: number, z: number) =>
    [[x + 1, 0, z, x, 0, z, x, 2, z], [0, 0, -1, 0, 0, -1, 0, 0, -1]] as const;

  it('names the wall type, the door and the secret a group stands on', () => {
    // (21, 8) is a type-2 wall, (21, 10) the `D` tile, (42, 10) the `S` tile.
    expect(classifySurface(...north(21, 8))).toEqual({ kind: 'wall', type: '2' });
    expect(classifySurface(...north(21, 10))).toEqual({ kind: 'door' });
    expect(classifySurface(...north(42, 10))).toEqual({ kind: 'secret' });
    // And follows a geometry index when one is given, as a merged mesh has.
    const [positions, normals] = north(21, 8);
    expect(classifySurface(positions, normals, [0, 1, 2])).toEqual({ kind: 'wall', type: '2' });
  });

  it('separates the floor from the ceiling by the plane each lies on', () => {
    const up = [0, 1, 0, 0, 1, 0, 0, 1, 0];
    const down = [0, -1, 0, 0, -1, 0, 0, -1, 0];
    expect(classifySurface([10, 0, 10, 10, 0, 11, 11, 0, 11], up)).toEqual({ kind: 'floor' });
    expect(classifySurface([10, 2, 10, 11, 2, 10, 11, 2, 11], down)).toEqual({ kind: 'ceiling' });
  });

  it('classifies nothing lying on no structural plane, so a prop is not a wall', () => {
    const facet = [30.5, 0.6, 30.5, 30.68, 0.42, 30.5, 30.5, 0.42, 30.68];
    const diagonal = [0.577, 0.577, 0.577, 0.577, 0.577, 0.577, 0.577, 0.577, 0.577];
    expect(classifySurface(facet, diagonal)).toBeNull();
    expect(classifySurface([], [])).toBeNull();
  });
});
