import { describe, it, expect } from 'vitest';
import { RGBA_CHANNELS } from '../../src/materials/constants';
import { MATERIAL_NAMES, MATERIAL_TABLE } from '../../src/materials/table';
import type { MaterialName } from '../../src/materials/table';
import { generateAlbedo } from '../../src/materials/generate';
import {
  FALLBACK_ROUGHNESS,
  constantRoughnessMap,
  decodeRoughnessTexel,
  deriveRoughnessMap,
  roughnessMean,
} from '../../src/materials/roughness';

// FR-006 / US2-S5. Roughness is derived from the same height field the normal
// is, inside the band `table.ts` declares for that material — so the ordering
// below is a property of the declared ranges, not of a tuned constant here.

const SIZE = 64;

const maps = new Map<MaterialName, Uint8ClampedArray>();
for (const name of MATERIAL_NAMES) {
  const { height } = generateAlbedo(name, SIZE);
  maps.set(name, deriveRoughnessMap(height, SIZE, MATERIAL_TABLE[name].roughness));
}

const means = new Map<MaterialName, number>(
  MATERIAL_NAMES.map((name) => [name, roughnessMean(maps.get(name)!)]),
);

describe('every decoded roughness value lies in 0..1 (US2-S5)', () => {
  it.each(MATERIAL_NAMES)('%s', (name) => {
    const map = maps.get(name)!;
    expect(map.length).toBe(SIZE * SIZE * RGBA_CHANNELS);
    for (let i = 0; i < SIZE * SIZE; i += 1) {
      const value = decodeRoughnessTexel(map, i);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  it.each(MATERIAL_NAMES)('%s stays inside its declared band', (name) => {
    const { min, max } = MATERIAL_TABLE[name].roughness;
    const map = maps.get(name)!;
    for (let i = 0; i < SIZE * SIZE; i += 1) {
      const value = decodeRoughnessTexel(map, i);
      expect(value).toBeGreaterThanOrEqual(min - 1 / 255);
      expect(value).toBeLessThanOrEqual(max + 1 / 255);
    }
  });
});

describe('the per-material means order by construction (FR-006, US2-S5)', () => {
  it('makes steel strictly smoother than stone', () => {
    expect(means.get('steel')!).toBeLessThan(means.get('stone')!);
  });

  it('makes stone strictly rougher than wood', () => {
    expect(means.get('stone')!).toBeGreaterThan(means.get('wood')!);
  });

  it('makes steel strictly smoother than wood, so the chain is total', () => {
    expect(means.get('steel')!).toBeLessThan(means.get('wood')!);
  });

  it('centres each mean on its declared band rather than on a tuned constant', () => {
    for (const name of MATERIAL_NAMES) {
      const { min, max } = MATERIAL_TABLE[name].roughness;
      expect(means.get(name)!).toBeCloseTo((min + max) / 2, 2);
    }
  });
});

describe('the derivation is driven by the height field', () => {
  it('varies across texels when the height field does', () => {
    const map = maps.get('stone')!;
    const distinct = new Set<number>();
    for (let i = 0; i < SIZE * SIZE; i += 1) distinct.add(map[i * RGBA_CHANNELS]!);
    expect(distinct.size).toBeGreaterThan(8);
  });

  it('collapses to the middle of the band for a constant height field', () => {
    const { min, max } = MATERIAL_TABLE['brick'].roughness;
    const flat = deriveRoughnessMap(new Float32Array(16 * 16).fill(0.5), 16, { min, max });
    for (let i = 0; i < 16 * 16; i += 1) {
      expect(decodeRoughnessTexel(flat, i)).toBeCloseTo((min + max) / 2, 2);
    }
  });
});

describe('the declared constant roughness of the fallback (FR-007)', () => {
  it('lies in 0..1 and fills a full map', () => {
    expect(FALLBACK_ROUGHNESS).toBeGreaterThan(0);
    expect(FALLBACK_ROUGHNESS).toBeLessThanOrEqual(1);
    const map = constantRoughnessMap(16, FALLBACK_ROUGHNESS);
    expect(map.length).toBe(16 * 16 * RGBA_CHANNELS);
    expect(roughnessMean(map)).toBeCloseTo(FALLBACK_ROUGHNESS, 2);
    for (let i = 0; i < 16 * 16; i += 1) expect(map[i * RGBA_CHANNELS + 3]!).toBe(255);
  });
});
