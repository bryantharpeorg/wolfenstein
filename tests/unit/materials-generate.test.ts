import { describe, it, expect } from 'vitest';
import {
  GENERATION_BUDGET_MS,
  MEAN_DISTINCTNESS_THRESHOLD,
  RGBA_CHANNELS,
  TEXTURE_SIZE,
  VARIANCE_TILE_PX,
  VARIANCE_TILE_COVERAGE,
} from '../../src/materials/constants';
import { hashBuffer } from '../../src/materials/rng';
import { MATERIAL_NAMES, MATERIAL_TABLE, reseed } from '../../src/materials/table';
import type { MaterialName } from '../../src/materials/table';
import {
  generateAlbedo,
  generateAllMaterials,
  generateMaterial,
  generationStats,
} from '../../src/materials/generate';

// The whole of US1's output is generated once here, at the declared size, before
// any other call: the budget and the once-per-load claim are read off this pass
// (US1-S8), and every texel assertion below reads the same buffers the renderer
// would.
const statsBefore = generationStats();
const generated = generateAllMaterials(TEXTURE_SIZE);
const statsAfter = generationStats();

function meanChannel(albedo: Uint8ClampedArray): number {
  let total = 0;
  let count = 0;
  for (let i = 0; i < albedo.length; i += RGBA_CHANNELS) {
    total += albedo[i]! + albedo[i + 1]! + albedo[i + 2]!;
    count += 3;
  }
  return total / count;
}

// Luminance variance inside one VARIANCE_TILE_PX square of the buffer.
function tileVariance(albedo: Uint8ClampedArray, size: number, tx: number, ty: number): number {
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = ty * VARIANCE_TILE_PX; y < (ty + 1) * VARIANCE_TILE_PX; y += 1) {
    for (let x = tx * VARIANCE_TILE_PX; x < (tx + 1) * VARIANCE_TILE_PX; x += 1) {
      const i = (y * size + x) * RGBA_CHANNELS;
      const lum = 0.2126 * albedo[i]! + 0.7152 * albedo[i + 1]! + 0.0722 * albedo[i + 2]!;
      sum += lum;
      sumSq += lum * lum;
      n += 1;
    }
  }
  return sumSq / n - (sum / n) ** 2;
}

function structuredTileFraction(albedo: Uint8ClampedArray, size: number): number {
  const tiles = size / VARIANCE_TILE_PX;
  let structured = 0;
  for (let ty = 0; ty < tiles; ty += 1) {
    for (let tx = 0; tx < tiles; tx += 1) {
      if (tileVariance(albedo, size, tx, ty) > 0) structured += 1;
    }
  }
  return structured / (tiles * tiles);
}

describe('generated albedo buffers', () => {
  it.each([...MATERIAL_NAMES])('%s fills size * size * 4 bytes', (name: MaterialName) => {
    expect(generated[name].albedo).toBeInstanceOf(Uint8ClampedArray);
    expect(generated[name].albedo.length).toBe(TEXTURE_SIZE * TEXTURE_SIZE * RGBA_CHANNELS);
    expect(generated[name].height.length).toBe(TEXTURE_SIZE * TEXTURE_SIZE);
  });

  it.each([...MATERIAL_NAMES])('%s holds no NaN and no out-of-range channel', (name: MaterialName) => {
    const { albedo, height } = generated[name];
    let worstLow = 255;
    let worstHigh = 0;
    let nans = 0;
    for (let i = 0; i < albedo.length; i += 1) {
      const value = albedo[i]!;
      if (Number.isNaN(value)) nans += 1;
      if (value < worstLow) worstLow = value;
      if (value > worstHigh) worstHigh = value;
    }
    expect(nans).toBe(0);
    expect(worstLow).toBeGreaterThanOrEqual(0);
    expect(worstHigh).toBeLessThanOrEqual(255);
    // The height field the albedo was derived from is finite too — US2 differentiates it.
    expect(height.every((h) => Number.isFinite(h))).toBe(true);
  });

  it.each([...MATERIAL_NAMES])('%s is opaque in the alpha channel', (name: MaterialName) => {
    const { albedo } = generated[name];
    for (let i = 3; i < albedo.length; i += RGBA_CHANNELS) {
      if (albedo[i] !== 255) throw new Error(`${name} has a transparent texel at byte ${i}`);
    }
    expect(albedo[3]).toBe(255);
  });
});

describe('determinism', () => {
  it.each([...MATERIAL_NAMES])('%s hashes identically at one seed and size', (name: MaterialName) => {
    const a = generateMaterial(MATERIAL_TABLE[name], 64);
    const b = generateMaterial(MATERIAL_TABLE[name], 64);
    expect(hashBuffer(a.albedo)).toBe(hashBuffer(b.albedo));
    expect(hashBuffer(b.albedo)).toBe(hashBuffer(generateMaterial(MATERIAL_TABLE[name], 64).albedo));
  });

  it.each([...MATERIAL_NAMES])('%s hashes differently under a different seed', (name: MaterialName) => {
    const spec = MATERIAL_TABLE[name];
    const own = generateMaterial(spec, 64);
    const other = generateMaterial(reseed(spec, spec.seed + 977), 64);
    expect(hashBuffer(other.albedo)).not.toBe(hashBuffer(own.albedo));
  });

  it('hashes the five materials to five distinct values at the declared size', () => {
    const hashes = MATERIAL_NAMES.map((name) => hashBuffer(generated[name].albedo));
    expect(new Set(hashes).size).toBe(MATERIAL_NAMES.length);
  });
});

describe('distinctness', () => {
  it('separates every pair of materials by more than the declared threshold', () => {
    const means = new Map<MaterialName, number>();
    for (const name of MATERIAL_NAMES) means.set(name, meanChannel(generated[name].albedo));
    for (const a of MATERIAL_NAMES) {
      for (const b of MATERIAL_NAMES) {
        if (a === b) continue;
        const gap = Math.abs(means.get(a)! - means.get(b)!);
        if (gap <= MEAN_DISTINCTNESS_THRESHOLD) {
          throw new Error(`${a} and ${b} differ by only ${gap.toFixed(2)} mean channel units`);
        }
      }
    }
    expect(means.size).toBe(5);
  });
});

describe('spatial structure', () => {
  it.each([...MATERIAL_NAMES])('%s is not a flat fill', (name: MaterialName) => {
    const fraction = structuredTileFraction(generated[name].albedo, TEXTURE_SIZE);
    expect(fraction).toBeGreaterThanOrEqual(VARIANCE_TILE_COVERAGE);
  });
});

describe('generation cost and cardinality', () => {
  it('generates all five materials within the declared budget', () => {
    expect(statsBefore.generatedCount).toBe(0);
    expect(statsAfter.generatedCount).toBe(MATERIAL_NAMES.length);
    expect(statsAfter.generatedMs).toBeLessThanOrEqual(GENERATION_BUDGET_MS);
    expect(statsAfter.budgetMs).toBe(GENERATION_BUDGET_MS);
    expect(statsAfter.withinBudget).toBe(true);
  });

  it('generates a material exactly once per (name, size)', () => {
    const before = generationStats();
    const first = generateAlbedo('brick', TEXTURE_SIZE);
    const second = generateAlbedo('brick', TEXTURE_SIZE);
    const after = generationStats();
    // Same object, no additional work: a second call cannot cost frame time.
    expect(second).toBe(first);
    expect(second.albedo).toBe(first.albedo);
    expect(after.generatedCount).toBe(before.generatedCount);
    expect(after.generatedMs).toBe(before.generatedMs);
  });

  it('reports a per-material breakdown of what it generated', () => {
    const stats = generationStats();
    expect(stats.materials.map((entry) => entry.name)).toEqual(
      expect.arrayContaining([...MATERIAL_NAMES]),
    );
    for (const entry of stats.materials.filter((e) => e.size === TEXTURE_SIZE)) {
      expect(entry.ms).toBeGreaterThanOrEqual(0);
      expect(entry.bytes).toBe(TEXTURE_SIZE * TEXTURE_SIZE * RGBA_CHANNELS);
    }
  });
});
