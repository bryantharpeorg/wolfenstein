import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { MATERIAL_NAMES, MATERIAL_TABLE } from '../../src/materials/table';
import type { MaterialName } from '../../src/materials/table';

// FR-002 / US1-S2: one table names the five materials and carries each one's seed
// and its own generation parameters, so nothing is tuned at a call site.

const EXPECTED: readonly string[] = ['brick', 'stone', 'wood', 'steel', 'blood-stone'];

const tableSource = readFileSync(new URL('../../src/materials/table.ts', import.meta.url), 'utf8');
const patternSource = readFileSync(
  new URL('../../src/materials/patterns.ts', import.meta.url),
  'utf8',
);
const generateSource = readFileSync(
  new URL('../../src/materials/generate.ts', import.meta.url),
  'utf8',
);

describe('material table', () => {
  it('declares exactly the five named materials', () => {
    expect([...MATERIAL_NAMES].sort()).toEqual([...EXPECTED].sort());
    expect(Object.keys(MATERIAL_TABLE).sort()).toEqual([...EXPECTED].sort());
    expect(MATERIAL_NAMES).toHaveLength(5);
  });

  it('keys each entry by its own name', () => {
    for (const name of MATERIAL_NAMES) {
      expect(MATERIAL_TABLE[name].name).toBe(name);
    }
  });

  it('gives every material its own seed', () => {
    const seeds = MATERIAL_NAMES.map((name) => MATERIAL_TABLE[name].seed);
    for (const seed of seeds) {
      expect(Number.isInteger(seed)).toBe(true);
      expect(seed).toBeGreaterThan(0);
    }
    expect(new Set(seeds).size).toBe(seeds.length);
  });

  it('gives every material its own generation parameters', () => {
    const shapes = new Set<string>();
    for (const name of MATERIAL_NAMES) {
      const spec = MATERIAL_TABLE[name];
      expect(Object.keys(spec.params).length).toBeGreaterThan(0);
      shapes.add(JSON.stringify(spec.params));
    }
    // No two materials share a parameter block: five copies of one bag would
    // make the table decoration rather than the source of truth.
    expect(shapes.size).toBe(5);
  });

  it('declares a base colour and a roughness range per material', () => {
    for (const name of MATERIAL_NAMES) {
      const spec = MATERIAL_TABLE[name];
      expect(spec.base).toHaveLength(3);
      for (const channel of spec.base) {
        expect(channel).toBeGreaterThanOrEqual(0);
        expect(channel).toBeLessThanOrEqual(255);
      }
      const { min, max } = spec.roughness;
      expect(min).toBeGreaterThanOrEqual(0);
      expect(max).toBeLessThanOrEqual(1);
      expect(min).toBeLessThan(max);
    }
  });

  it('is the only module that declares a seed or a roughness range', () => {
    expect(/\bseed\s*:/.test(tableSource)).toBe(true);
    expect(/\bseed\s*:/.test(patternSource)).toBe(false);
    expect(/\bseed\s*:/.test(generateSource)).toBe(false);
    expect(/\broughness\s*:\s*\{/.test(patternSource)).toBe(false);
    expect(/\broughness\s*:\s*\{/.test(generateSource)).toBe(false);
  });

  it('types the material name as the union of exactly those five', () => {
    // A compile-time claim made checkable at runtime: every declared name is a
    // MaterialName and the table is total over the union.
    const names: MaterialName[] = [...MATERIAL_NAMES];
    expect(names.every((name) => MATERIAL_TABLE[name] !== undefined)).toBe(true);
  });
});
