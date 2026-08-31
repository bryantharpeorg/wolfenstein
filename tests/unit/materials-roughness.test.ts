import { describe, it, expect } from 'vitest';
import {
  FALLBACK_ROUGHNESS,
  constantRoughnessMap,
  decodeRoughness,
  deriveRoughnessMap,
  roughnessMean,
} from '../../src/materials/roughness';
import { RGBA_CHANNELS, TEXTURE_SIZE } from '../../src/materials/constants';
import { generateAlbedo } from '../../src/materials/generate';
import { MATERIAL_NAMES, MATERIAL_TABLE } from '../../src/materials/table';
import type { MaterialName } from '../../src/materials/table';

// FR-006 / US2-S5. Roughness is derived from the same height field, inside the
// band each material declares in table.ts, so steel reads smooth and stone
// rough by construction rather than by tuning.

const SIZE = 64;

function mapOf(name: MaterialName, size = SIZE): Uint8ClampedArray {
  const generated = generateAlbedo(name, size);
  return deriveRoughnessMap(generated.height, size, MATERIAL_TABLE[name].roughness);
}

const maps = new Map(MATERIAL_NAMES.map((name) => [name, mapOf(name)]));

describe('the decoded roughness range', () => {
  it.each([...MATERIAL_NAMES])('%s decodes entirely inside 0..1', (name) => {
    const map = maps.get(name)!;
    expect(map.length).toBe(SIZE * SIZE * RGBA_CHANNELS);
    for (let i = 0; i < SIZE * SIZE; i += 1) {
      const value = decodeRoughness(map, i);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  it.each([...MATERIAL_NAMES])('%s stays inside the band its table row declares', (name) => {
    const { min, max } = MATERIAL_TABLE[name].roughness;
    const map = maps.get(name)!;
    // One quantisation step of slack, since the band is stored as bytes.
    const slack = 1 / 255;
    for (let i = 0; i < SIZE * SIZE; i += 1) {
      const value = decodeRoughness(map, i);
      expect(value).toBeGreaterThanOrEqual(min - slack);
      expect(value).toBeLessThanOrEqual(max + slack);
    }
  });

  it.each([...MATERIAL_NAMES])('%s writes one grey per texel with opaque alpha', (name) => {
    const map = maps.get(name)!;
    for (let i = 0; i < SIZE * SIZE; i += 1) {
      const o = i * RGBA_CHANNELS;
      expect(map[o]).toBe(map[o + 1]);
      expect(map[o + 1]).toBe(map[o + 2]);
      expect(map[o + 3]).toBe(255);
    }
  });

  it.each([...MATERIAL_NAMES])('%s actually varies rather than filling one value', (name) => {
    const map = maps.get(name)!;
    const seen = new Set<number>();
    for (let i = 0; i < SIZE * SIZE; i += 1) seen.add(map[i * RGBA_CHANNELS] ?? -1);
    expect(seen.size).toBeGreaterThan(1);
  });
});

describe('US2-S5: the per-material means order steel < wood < stone', () => {
  const means = new Map(MATERIAL_NAMES.map((name) => [name, roughnessMean(maps.get(name)!)]));

  it('makes steel strictly smoother than stone', () => {
    expect(means.get('steel')!).toBeLessThan(means.get('stone')!);
  });

  it('makes stone strictly rougher than wood', () => {
    expect(means.get('stone')!).toBeGreaterThan(means.get('wood')!);
  });

  it('makes steel strictly smoother than wood, completing the order', () => {
    expect(means.get('steel')!).toBeLessThan(means.get('wood')!);
  });

  it('holds at the declared texture size, not only at the test size', () => {
    const fullSizeMean = (name: MaterialName): number => roughnessMean(mapOf(name, TEXTURE_SIZE));
    expect(fullSizeMean('steel')).toBeLessThan(fullSizeMean('wood'));
    expect(fullSizeMean('wood')).toBeLessThan(fullSizeMean('stone'));
    expect(fullSizeMean('steel')).toBeLessThan(fullSizeMean('stone'));
  });

  it('keeps every mean inside its own declared band', () => {
    for (const name of MATERIAL_NAMES) {
      const { min, max } = MATERIAL_TABLE[name].roughness;
      expect(means.get(name)!).toBeGreaterThanOrEqual(min);
      expect(means.get(name)!).toBeLessThanOrEqual(max);
    }
  });
});

describe('the derivation is driven by the height field', () => {
  it('centres a constant height field in its band, with no band to spread over', () => {
    const flat = new Float32Array(SIZE * SIZE).fill(0.42);
    const range = MATERIAL_TABLE.wood.roughness;
    const map = deriveRoughnessMap(flat, SIZE, range);
    const midpoint = (range.min + range.max) / 2;
    for (let i = 0; i < SIZE * SIZE; i += 1) {
      expect(Math.abs(decodeRoughness(map, i) - midpoint)).toBeLessThanOrEqual(1 / 255);
    }
  });

  it('answers to the height field: a different field gives a different map', () => {
    const range = MATERIAL_TABLE.stone.roughness;
    const a = deriveRoughnessMap(generateAlbedo('stone', SIZE).height, SIZE, range);
    const b = deriveRoughnessMap(generateAlbedo('brick', SIZE).height, SIZE, range);
    let differing = 0;
    for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) differing += 1;
    expect(differing).toBeGreaterThan(0);
  });

  it('answers to the band: the same field under a smoother band reads smoother', () => {
    const height = generateAlbedo('stone', SIZE).height;
    const rough = deriveRoughnessMap(height, SIZE, MATERIAL_TABLE.stone.roughness);
    const smooth = deriveRoughnessMap(height, SIZE, MATERIAL_TABLE.steel.roughness);
    expect(roughnessMean(smooth)).toBeLessThan(roughnessMean(rough));
  });
});

describe('the declared constant roughness FR-007 falls back to', () => {
  it('is a real value inside 0..1', () => {
    expect(FALLBACK_ROUGHNESS).toBeGreaterThan(0);
    expect(FALLBACK_ROUGHNESS).toBeLessThan(1);
  });

  it('fills a whole map with one decoded value', () => {
    const map = constantRoughnessMap(SIZE, FALLBACK_ROUGHNESS);
    expect(map.length).toBe(SIZE * SIZE * RGBA_CHANNELS);
    for (let i = 0; i < SIZE * SIZE; i += 1) {
      expect(Math.abs(decodeRoughness(map, i) - FALLBACK_ROUGHNESS)).toBeLessThanOrEqual(1 / 255);
      expect(map[i * RGBA_CHANNELS + 3]).toBe(255);
    }
    expect(Math.abs(roughnessMean(map) - FALLBACK_ROUGHNESS)).toBeLessThanOrEqual(1 / 255);
  });

  it('clamps a value outside 0..1 rather than wrapping it', () => {
    expect(decodeRoughness(constantRoughnessMap(4, 2), 0)).toBe(1);
    expect(decodeRoughness(constantRoughnessMap(4, -1), 0)).toBe(0);
  });
});
