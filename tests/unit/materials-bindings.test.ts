import { describe, it, expect, beforeEach } from 'vitest';
import {
  LEVEL_GRID,
  WALL_MATERIALS,
  DEFAULT_WALL_MATERIAL,
  type WallMaterial,
} from '../../src/level';
import { MATERIAL_NAMES, type MaterialName } from '../../src/materials/table';
import {
  resolveDoorMaterial,
  resolveSecretMaterial,
  resolveFloorMaterial,
  resolveCeilingMaterial,
  resolveWallMaterial,
  resetMaterialBindings,
} from '../../src/materials/bindings';
import { materialDiagnostics, resetMaterialDiagnostics } from '../../src/materials/diagnostics';

function isDeclaredWallType(cell: string | undefined): cell is string {
  return cell != null && cell >= '1' && cell <= '9';
}

/** Every `S` tile in the shipped grid. */
function secretTiles(): Array<{ x: number; z: number }> {
  const tiles: Array<{ x: number; z: number }> = [];
  for (let z = 0; z < LEVEL_GRID.length; z += 1) {
    const row = LEVEL_GRID[z];
    if (row == null) continue;
    for (let x = 0; x < row.length; x += 1) {
      if (row[x] === 'S') tiles.push({ x, z });
    }
  }
  return tiles;
}

/** The declared wall type IDs orthogonally adjacent to a tile. */
function orthogonalWallTypes(x: number, z: number): string[] {
  const ids: string[] = [];
  for (const [nx, nz] of [
    [x, z - 1],
    [x, z + 1],
    [x - 1, z],
    [x + 1, z],
  ]) {
    const cell = LEVEL_GRID[nz as number]?.[nx as number];
    if (isDeclaredWallType(cell)) ids.push(cell);
  }
  return ids;
}

describe('wall type material bindings (US3-S1)', () => {
  beforeEach(() => {
    resetMaterialBindings();
    resetMaterialDiagnostics();
  });

  it('maps every declared wall type ID to exactly one of the five materials', () => {
    for (const id of Object.keys(WALL_MATERIALS)) {
      const resolved = resolveWallMaterial(id);
      expect(resolved).toBeDefined();
      expect(MATERIAL_NAMES).toContain(resolved);
    }
  });

  it('uses 002\'s declared default material for an unmapped wall type ID', () => {
    const resolved = resolveWallMaterial('7');
    const fallbackName =
      DEFAULT_WALL_MATERIAL.name === 'default' ? 'stone' : DEFAULT_WALL_MATERIAL.name;
    expect(resolved).toBe(fallbackName as string);
    expect(MATERIAL_NAMES).toContain(resolved);
  });

  it('records a fallback when an unmapped ID is substituted', () => {
    resolveWallMaterial('7');
    const { fallbacks } = materialDiagnostics();
    expect(fallbacks.length).toBeGreaterThanOrEqual(1);
    const fallbackName =
      DEFAULT_WALL_MATERIAL.name === 'default' ? 'stone' : DEFAULT_WALL_MATERIAL.name;
    const entry = fallbacks.find(
      (f) => f.name === ('7' as MaterialName) || f.name === (fallbackName as MaterialName),
    );
    expect(entry).toBeDefined();
  });
});

describe('special surface material bindings (US3-S3, US3-S4)', () => {
  beforeEach(() => {
    resetMaterialBindings();
    resetMaterialDiagnostics();
  });

  it('resolves a door to a declared material', () => {
    const resolved = resolveDoorMaterial();
    expect(MATERIAL_NAMES).toContain(resolved);
  });

  it('resolves every secret in the shipped grid to a declared material', () => {
    const secrets = secretTiles();
    expect(secrets.length).toBeGreaterThan(0);
    for (const { x, z } of secrets) {
      expect(MATERIAL_NAMES).toContain(resolveSecretMaterial(x, z));
    }
  });

  it('gives a secret the material of the wall it is embedded in, so it stays hidden', () => {
    // 004 builds the block in its neighbour's colour on purpose: a secret is
    // found by pushing, not by looking. Skinning it to stand out would regress
    // that milestone (see DECISIONS.md).
    for (const { x, z } of secretTiles()) {
      const neighbourMaterials = orthogonalWallTypes(x, z).map((id) => resolveWallMaterial(id));
      expect(neighbourMaterials.length).toBeGreaterThan(0);
      expect(neighbourMaterials).toContain(resolveSecretMaterial(x, z));
    }
  });

  it('resolves the floor to a declared material', () => {
    const resolved = resolveFloorMaterial();
    expect(MATERIAL_NAMES).toContain(resolved);
  });

  it('resolves the ceiling to a declared material', () => {
    const resolved = resolveCeilingMaterial();
    expect(MATERIAL_NAMES).toContain(resolved);
  });

  it('gives the floor and ceiling different materials', () => {
    const floor = resolveFloorMaterial();
    const ceiling = resolveCeilingMaterial();
    expect(floor).not.toBe(ceiling);
  });

  it('does not give the floor the dominant wall type\'s material (US3-S4)', () => {
    // All five wall types are in use, so floor and ceiling cannot avoid every
    // wall material; they can avoid the one that covers most of the level.
    const counts = new Map<string, number>();
    for (const row of LEVEL_GRID) {
      for (const cell of row) {
        if (isDeclaredWallType(cell)) counts.set(cell, (counts.get(cell) ?? 0) + 1);
      }
    }
    const dominant = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]![0];
    const dominantMaterial = resolveWallMaterial(dominant);
    expect(resolveFloorMaterial()).not.toBe(dominantMaterial);
    expect(resolveCeilingMaterial()).not.toBe(dominantMaterial);
  });

  it('gives the floor a material different from a door, so neither reads as the other', () => {
    expect(resolveFloorMaterial()).not.toBe(resolveDoorMaterial());
  });

  it('maps the five wall type IDs onto five distinct materials', () => {
    const materials = Object.keys(WALL_MATERIALS).map((id) => resolveWallMaterial(id));
    expect(new Set(materials).size).toBe(materials.length);
  });

  it('gives a door a material different from the wall type beside it', () => {
    const door = resolveDoorMaterial();
    const neighbourIds = new Set<string>();
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
          const cell = typeof nz === 'number' && typeof nx === 'number' ? LEVEL_GRID[nz]?.[nx] : undefined;
          if (isDeclaredWallType(cell)) {
            neighbourIds.add(cell);
          }
        }
      }
    }
    expect(neighbourIds.size).toBeGreaterThan(0);
    const neighbourMaterials = new Set<string>();
    for (const id of neighbourIds) {
      const entry = WALL_MATERIALS[id as keyof typeof WALL_MATERIALS] as WallMaterial | undefined;
      if (entry == null) continue;
      neighbourMaterials.add(resolveWallMaterial(id));
    }
    expect(neighbourMaterials.has(door)).toBe(false);
  });
});
