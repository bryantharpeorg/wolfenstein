import { describe, it, expect, beforeEach } from 'vitest';
import {
  BINDING_FALLBACK_MATERIAL,
  CEILING_MATERIAL,
  DOOR_MATERIAL,
  FLOOR_MATERIAL,
  WALL_TYPE_MATERIALS,
  bindingSummary,
  materialForSecretCell,
  materialForSurface,
  materialForWallType,
} from '../../src/materials/bindings';
import { MATERIAL_NAMES, MATERIAL_TABLE } from '../../src/materials/table';
import { materialDiagnostics, resetMaterialDiagnostics } from '../../src/materials/diagnostics';
import { DEFAULT_WALL_MATERIAL, LEVEL_GRID, WALL_MATERIALS } from '../../src/level';

// FR-008 / US3-S1, US3-S3, US3-S4: every wall type ID 002 declares resolves to
// exactly one of US1's five materials; an ID with no entry resolves to 002's
// declared default; doors, secrets, floor and ceiling each resolve to one too.

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
    // "Exactly one": asking twice is the same answer, and the table holds one
    // entry — and a declared type never records a fallback.
    expect(materialForWallType(type)).toBe(resolved);
    expect(MATERIAL_TABLE[resolved].name).toBe(resolved);
    expect(materialDiagnostics().fallbacks).toHaveLength(0);
  });

  it('binds every type ID the shipped grid actually uses', () => {
    const used = new Set<string>();
    for (const row of LEVEL_GRID) {
      for (const cell of row) if (cell >= '1' && cell <= '9') used.add(cell);
    }
    expect([...used].every((type) => type in WALL_TYPE_MATERIALS)).toBe(true);
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

  it('records the substitution as a named fallback, once however often asked', () => {
    materialForWallType('7');
    materialForWallType('7');
    const { fallbacks } = materialDiagnostics();
    expect(fallbacks).toHaveLength(1);
    expect(fallbacks[0]!.map).toBe('binding');
    expect(fallbacks[0]!.name).toBe(BINDING_FALLBACK_MATERIAL);
    expect(fallbacks[0]!.reason).toContain("'7'");
  });
});

describe('doors, secrets, floor and ceiling', () => {
  it('gives the floor and the ceiling each its own declared material', () => {
    expect(materialForSurface('floor')).toBe(FLOOR_MATERIAL);
    expect(materialForSurface('ceiling')).toBe(CEILING_MATERIAL);
    expect(FLOOR_MATERIAL).not.toBe(CEILING_MATERIAL);
    expect(MATERIAL_NAMES).toContain(FLOOR_MATERIAL);
    expect(MATERIAL_NAMES).toContain(CEILING_MATERIAL);
  });

  it('lets neither of them, nor a door, wear a wall texture (US3-S3, US3-S4)', () => {
    const walls = declaredWallTypes.map(materialForWallType);
    expect(walls.length).toBeGreaterThan(0);
    expect(materialForSurface('door')).toBe(DOOR_MATERIAL);
    for (const worn of [FLOOR_MATERIAL, CEILING_MATERIAL, DOOR_MATERIAL]) {
      expect(walls).not.toContain(worn);
    }
  });

  // 004's rule: an unpushed secret is found by pushing, not by looking, so it
  // wears the run it sits in — whichever axis that run lies on.
  it('resolves a secret to the material of the wall run it is embedded in', () => {
    const alongZ = ['11111', '10201', '10S01', '10201', '11111'];
    expect(materialForSecretCell(alongZ, 2, 2)).toBe(materialForWallType('2'));
    expect(materialForSecretCell(alongZ, 2, 2)).not.toBe(DOOR_MATERIAL);
    const alongX = ['11111', '10001', '12S21', '10001', '11111'];
    expect(materialForSecretCell(alongX, 2, 2)).toBe(materialForWallType('2'));
  });

  it('falls back to a declared material when a secret has no wall beside it', () => {
    expect(materialForSecretCell(['000', '0S0', '000'], 1, 1)).toBe(BINDING_FALLBACK_MATERIAL);
  });

  it('resolves every secret on the shipped level to a declared material', () => {
    for (let z = 0; z < LEVEL_GRID.length; z += 1) {
      const row = LEVEL_GRID[z]!;
      for (let x = 0; x < row.length; x += 1) {
        if (row[x] !== 'S') continue;
        expect(MATERIAL_NAMES).toContain(materialForSecretCell(LEVEL_GRID, x, z));
        // Hidden, not announced: a push-wall wears the run it sits in (004).
        expect(materialForSecretCell(LEVEL_GRID, x, z)).not.toBe(DOOR_MATERIAL);
      }
    }
  });
});

describe('the binding summary', () => {
  it('names one declared material per surface class, nothing untextured', () => {
    const summary = bindingSummary();
    for (const entry of summary) expect(MATERIAL_NAMES).toContain(entry.material);
    const surfaces = summary.map((entry) => entry.surface);
    const expected = ['floor', 'ceiling', 'door', ...declaredWallTypes.map((t) => `wall:${t}`)];
    for (const surface of expected) expect(surfaces).toContain(surface);
  });
});
