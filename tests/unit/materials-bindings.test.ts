import { describe, it, expect, beforeEach } from 'vitest';
import {
  BINDING_FALLBACK_MATERIAL,
  CEILING_MATERIAL,
  DOOR_MATERIAL,
  FLOOR_MATERIAL,
  WALL_TYPE_MATERIALS,
  bindingSummary,
  materialForSecretAt,
  materialForSecretCell,
  materialForSurface,
  materialForWallType,
  wallMaterialsInUse,
} from '../../src/materials/bindings';
import { MATERIAL_NAMES, MATERIAL_TABLE } from '../../src/materials/table';
import { materialDiagnostics, resetMaterialDiagnostics } from '../../src/materials/diagnostics';
import { DEFAULT_WALL_MATERIAL, LEVEL_GRID, WALL_MATERIALS } from '../../src/level';

// FR-008 / US3-S1, US3-S3, US3-S4: every wall type ID 002 declares resolves to
// exactly one of US1's five materials; an ID with no entry resolves to 002's
// declared default rather than to nothing; and doors, secrets, floor and ceiling
// each resolve to a declared material of their own.

beforeEach(() => {
  resetMaterialDiagnostics();
});

const declaredWallTypes = Object.keys(WALL_MATERIALS).sort();

describe('every wall type 002 declares', () => {
  it('has an entry in the binding table', () => {
    expect(Object.keys(WALL_TYPE_MATERIALS).sort()).toEqual(declaredWallTypes);
  });

  it.each(declaredWallTypes)('maps %s to exactly one of the five materials', (type: string) => {
    const resolved = materialForWallType(type);
    expect(MATERIAL_NAMES).toContain(resolved);
    // "Exactly one": asking twice is the same answer, and the table holds one entry.
    expect(materialForWallType(type)).toBe(resolved);
    expect(MATERIAL_TABLE[resolved].name).toBe(resolved);
  });

  it.each(declaredWallTypes)('records no fallback for the declared type %s', (type: string) => {
    materialForWallType(type);
    expect(materialDiagnostics().fallbacks).toHaveLength(0);
  });

  it('binds every type ID the shipped grid actually uses', () => {
    const used = new Set<string>();
    for (const row of LEVEL_GRID) {
      for (const cell of row) if (cell >= '1' && cell <= '9') used.add(cell);
    }
    for (const type of used) {
      expect(Object.keys(WALL_TYPE_MATERIALS)).toContain(type);
    }
  });
});

describe('a wall type with no entry', () => {
  it("resolves to 002's declared default rather than to nothing", () => {
    // '7' is a legal wall type ID 002 declares no material for.
    expect(WALL_MATERIALS['7']).toBeUndefined();
    expect(DEFAULT_WALL_MATERIAL.name).toBe('default');
    const resolved = materialForWallType('7');
    expect(resolved).toBe(BINDING_FALLBACK_MATERIAL);
    expect(MATERIAL_NAMES).toContain(resolved);
  });

  it('records the substitution as a named fallback', () => {
    materialForWallType('7');
    const { fallbacks } = materialDiagnostics();
    expect(fallbacks).toHaveLength(1);
    expect(fallbacks[0]!.map).toBe('binding');
    expect(fallbacks[0]!.name).toBe(BINDING_FALLBACK_MATERIAL);
    expect(fallbacks[0]!.reason).toContain("'7'");
  });

  it('records that substitution once however often the type is asked for', () => {
    materialForWallType('7');
    materialForWallType('7');
    materialForWallType('7');
    expect(materialDiagnostics().fallbacks).toHaveLength(1);
  });
});

describe('doors, secrets, floor and ceiling', () => {
  it.each(['door', 'floor', 'ceiling'] as const)('resolves %s to a declared material', (kind) => {
    const resolved = materialForSurface(kind);
    expect(MATERIAL_NAMES).toContain(resolved);
  });

  it('gives the floor and the ceiling each its own material', () => {
    expect(materialForSurface('floor')).toBe(FLOOR_MATERIAL);
    expect(materialForSurface('ceiling')).toBe(CEILING_MATERIAL);
    expect(FLOOR_MATERIAL).not.toBe(CEILING_MATERIAL);
  });

  it('never lets the floor or the ceiling sample a wall texture (US3-S4)', () => {
    const walls = wallMaterialsInUse();
    expect(walls.length).toBeGreaterThan(0);
    expect(walls).not.toContain(FLOOR_MATERIAL);
    expect(walls).not.toContain(CEILING_MATERIAL);
  });

  it("makes a door differ from every wall type it can stand beside (US3-S3)", () => {
    expect(materialForSurface('door')).toBe(DOOR_MATERIAL);
    for (const type of declaredWallTypes) {
      expect(DOOR_MATERIAL).not.toBe(materialForWallType(type));
    }
  });

  it('resolves a secret to the material of the wall it is embedded in', () => {
    // 004's rule: an unpushed secret is found by pushing, not by looking, so it
    // takes the material of the run it sits in rather than announcing itself.
    // A push-wall on the x axis slides along x, so the run it hides in lies on z:
    // its neighbours in that run are the tiles above and below it.
    const grid = ['11111', '10201', '10S01', '10201', '11111'];
    expect(materialForSecretAt(grid, 2, 2, 'x')).toBe(materialForWallType('2'));
    expect(materialForSecretAt(grid, 2, 2, 'x')).not.toBe(DOOR_MATERIAL);
  });

  it('falls back to a declared material when a secret has no wall beside it', () => {
    const grid = ['000', '0S0', '000'];
    expect(materialForSecretAt(grid, 1, 1, 'x')).toBe(BINDING_FALLBACK_MATERIAL);
  });

  it('answers the same for a secret tile without being told its axis', () => {
    const grid = ['11111', '10201', '10S01', '10201', '11111'];
    expect(materialForSecretCell(grid, 2, 2)).toBe(materialForWallType('2'));
    const alongZ = ['11111', '10001', '12S21', '10001', '11111'];
    expect(materialForSecretCell(alongZ, 2, 2)).toBe(materialForWallType('2'));
    expect(materialForSecretCell(['000', '0S0', '000'], 1, 1)).toBe(BINDING_FALLBACK_MATERIAL);
  });

  it('resolves every secret on the shipped level to a declared material', () => {
    for (let z = 0; z < LEVEL_GRID.length; z += 1) {
      const row = LEVEL_GRID[z]!;
      for (let x = 0; x < row.length; x += 1) {
        if (row[x] !== 'S') continue;
        for (const axis of ['x', 'z'] as const) {
          expect(MATERIAL_NAMES).toContain(materialForSecretAt(LEVEL_GRID, x, z, axis));
        }
        expect(MATERIAL_NAMES).toContain(materialForSecretCell(LEVEL_GRID, x, z));
        // Hidden, not announced: a push-wall wears the run it sits in (004).
        expect(materialForSecretCell(LEVEL_GRID, x, z)).not.toBe(DOOR_MATERIAL);
      }
    }
  });
});

describe('the binding summary', () => {
  it('names one material per surface class and nothing untextured', () => {
    const summary = bindingSummary();
    for (const entry of summary) {
      expect(MATERIAL_NAMES).toContain(entry.material);
      expect(entry.surface.length).toBeGreaterThan(0);
    }
    const surfaces = summary.map((entry) => entry.surface);
    expect(surfaces).toContain('floor');
    expect(surfaces).toContain('ceiling');
    expect(surfaces).toContain('door');
    for (const type of declaredWallTypes) expect(surfaces).toContain(`wall:${type}`);
  });
});
