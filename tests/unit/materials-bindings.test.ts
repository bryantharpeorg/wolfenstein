import { describe, it, expect, beforeEach } from 'vitest';
import {
  DEFAULT_WALL_MATERIAL,
  DOOR_LOCKS,
  LEVEL_GRID,
  WALL_MATERIALS,
} from '../../src/level';
import { MATERIAL_NAMES } from '../../src/materials/table';
import type { MaterialName } from '../../src/materials/table';
import {
  CEILING_MATERIAL,
  DEFAULT_MATERIAL,
  DOOR_MATERIAL,
  FLOOR_MATERIAL,
  SECRET_MATERIAL,
  WALL_TYPE_MATERIALS,
  adjacentWallMaterials,
  bindSurface,
  declaredWallTypes,
  materialForWallType,
  wallMaterialNames,
} from '../../src/materials/bindings';
import {
  materialDiagnostics,
  resetMaterialDiagnostics,
} from '../../src/materials/diagnostics';

// FR-008 / US3-S1, US3-S3, US3-S4: every wall type ID 002 declares resolves to
// exactly one of US1's five materials; an ID with no entry resolves to 002's
// declared default rather than to nothing; and doors, secrets, floor and ceiling
// each carry a declared material of their own.

beforeEach(() => {
  resetMaterialDiagnostics();
});

describe('every wall type ID 002 declares', () => {
  it('is covered by the binding table', () => {
    expect(declaredWallTypes()).toEqual(Object.keys(WALL_MATERIALS).sort());
    for (const type of declaredWallTypes()) {
      expect(Object.keys(WALL_TYPE_MATERIALS)).toContain(type);
    }
  });

  it.each(Object.keys(WALL_MATERIALS))('maps %s to exactly one of the five materials', (type) => {
    const resolved = materialForWallType(type);
    expect(MATERIAL_NAMES).toContain(resolved.material);
    expect(resolved.fallback).toBe(false);
    // "Exactly one": the table holds a single name, not a list.
    expect(typeof WALL_TYPE_MATERIALS[type]).toBe('string');
  });

  it('names only materials the table declares', () => {
    for (const name of Object.values(WALL_TYPE_MATERIALS)) {
      expect(MATERIAL_NAMES).toContain(name);
    }
  });
});

describe('a wall type ID with no entry', () => {
  it("resolves to 002's declared default material rather than to nothing", () => {
    const resolved = materialForWallType('7');
    expect(resolved.material).toBe(DEFAULT_MATERIAL);
    expect(MATERIAL_NAMES).toContain(resolved.material);
    expect(resolved.fallback).toBe(true);
    // 002 declares the default by name; this binding stands in for that entry.
    expect(DEFAULT_WALL_MATERIAL.name).toBe('default');
  });

  it('records the substitution as a fallback rather than failing silently', () => {
    expect(materialDiagnostics().fallbacks).toHaveLength(0);
    bindSurface({ kind: 'wall', type: '8' });
    const fallbacks = materialDiagnostics().fallbacks;
    expect(fallbacks).toHaveLength(1);
    expect(fallbacks[0]!.name).toBe(DEFAULT_MATERIAL);
    expect(fallbacks[0]!.map).toBe('binding');
    expect(fallbacks[0]!.reason).toContain('8');
  });

  it('records one entry per unmapped id, not one per mesh', () => {
    bindSurface({ kind: 'wall', type: '8' });
    bindSurface({ kind: 'wall', type: '8' });
    expect(materialDiagnostics().fallbacks).toHaveLength(1);
  });

  it('records nothing for a declared id', () => {
    for (const type of declaredWallTypes()) bindSurface({ kind: 'wall', type });
    expect(materialDiagnostics().fallbacks).toHaveLength(0);
  });
});

describe('doors and secrets', () => {
  it('each carry a declared material from the same table', () => {
    expect(MATERIAL_NAMES).toContain(DOOR_MATERIAL);
    expect(MATERIAL_NAMES).toContain(SECRET_MATERIAL);
    expect(bindSurface({ kind: 'door' }).material).toBe(DOOR_MATERIAL);
    expect(bindSurface({ kind: 'secret' }).material).toBe(SECRET_MATERIAL);
    expect(materialDiagnostics().fallbacks).toHaveLength(0);
  });

  it('read as a door before they are touched: every door differs from the wall beside it', () => {
    const doorTiles = Object.keys(DOOR_LOCKS).map((key) => {
      const [x, z] = key.split(',').map(Number);
      return { x: x!, z: z! };
    });
    expect(doorTiles.length).toBeGreaterThan(0);
    for (const tile of doorTiles) {
      const beside = adjacentWallMaterials(LEVEL_GRID, tile.x, tile.z);
      expect(beside.length).toBeGreaterThan(0);
      expect(beside).not.toContain(DOOR_MATERIAL);
    }
  });

  it('every secret differs from the wall it is embedded in', () => {
    const secrets: Array<{ x: number; z: number }> = [];
    LEVEL_GRID.forEach((row, z) => {
      [...row].forEach((cell, x) => {
        if (cell === 'S') secrets.push({ x, z });
      });
    });
    expect(secrets.length).toBeGreaterThan(0);
    for (const tile of secrets) {
      const beside = adjacentWallMaterials(LEVEL_GRID, tile.x, tile.z);
      expect(beside.length).toBeGreaterThan(0);
      expect(beside).not.toContain(SECRET_MATERIAL);
    }
  });
});

describe('floor and ceiling', () => {
  it('each carry their own declared material', () => {
    expect(MATERIAL_NAMES).toContain(FLOOR_MATERIAL);
    expect(MATERIAL_NAMES).toContain(CEILING_MATERIAL);
    expect(FLOOR_MATERIAL).not.toBe(CEILING_MATERIAL);
    expect(bindSurface({ kind: 'floor' }).material).toBe(FLOOR_MATERIAL);
    expect(bindSurface({ kind: 'ceiling' }).material).toBe(CEILING_MATERIAL);
  });

  it('neither samples a wall texture', () => {
    const wallNames: readonly MaterialName[] = wallMaterialNames();
    expect(wallNames.length).toBeGreaterThan(0);
    expect(wallNames).not.toContain(FLOOR_MATERIAL);
    expect(wallNames).not.toContain(CEILING_MATERIAL);
  });
});

describe('a surface this spec does not name', () => {
  it('falls back to the default material rather than rendering untextured', () => {
    const bound = bindSurface({ kind: 'unknown' });
    expect(bound.material).toBe(DEFAULT_MATERIAL);
    expect(bound.fallback).toBe(true);
    expect(materialDiagnostics().fallbacks).toHaveLength(1);
  });
});
