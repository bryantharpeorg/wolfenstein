import { describe, it, expect, beforeEach } from 'vitest';
import {
  DEFAULT_DERIVATIONS,
  MAPS_PER_MATERIAL,
  buildAllMaterialMaps,
  buildMaterialMaps,
  mapBytes,
} from '../../src/materials/maps';
import type { MapDerivations } from '../../src/materials/maps';
import {
  createMaterialDiagnostics,
  materialDiagnostics,
  publishMaterialDiagnostics,
  recordFallback,
  resetMaterialDiagnostics,
} from '../../src/materials/diagnostics';
import { RGBA_CHANNELS, TEXTURE_SIZE } from '../../src/materials/constants';
import { FLAT_NORMAL_ENCODED, decodeNormalTexel } from '../../src/materials/normal';
import { FALLBACK_ROUGHNESS, decodeRoughness } from '../../src/materials/roughness';
import { generationStats } from '../../src/materials/generate';
import { MATERIAL_NAMES, MATERIAL_TABLE } from '../../src/materials/table';
import { createDiagnostics } from '../../src/diag/diag';

// FR-005 / FR-006 / FR-007, US2-S6..S8. Three maps per material, one UV space,
// a declared degradation instead of a stall, and the memory cost as a number.

const SIZE = 64;

beforeEach(() => {
  resetMaterialDiagnostics();
});

describe('US2-S6: three maps, one size, one UV space', () => {
  it.each([...MATERIAL_NAMES])('%s ships albedo, normal and roughness at one size', (name) => {
    const maps = buildMaterialMaps(name, SIZE);
    const texels = SIZE * SIZE;
    expect(maps.name).toBe(name);
    expect(maps.size).toBe(SIZE);
    expect(maps.albedo.length).toBe(texels * RGBA_CHANNELS);
    expect(maps.normal.length).toBe(texels * RGBA_CHANNELS);
    expect(maps.roughness.length).toBe(texels * RGBA_CHANNELS);
    expect(maps.height.length).toBe(texels);
  });

  it.each([...MATERIAL_NAMES])('%s addresses all three maps by the same UV', (name) => {
    const maps = buildMaterialMaps(name, SIZE);
    // One UV maps to one texel index in every map: no offset, no half-texel
    // shift, no transposition. Sampling (u, v) reaches the same row and column.
    const samples: ReadonlyArray<readonly [number, number]> = [
      [0, 0],
      [0.5, 0.5],
      [0.999, 0.001],
      [0.25, 0.75],
    ];
    for (const [u, v] of samples) {
      const x = Math.min(SIZE - 1, Math.floor(u * SIZE));
      const y = Math.min(SIZE - 1, Math.floor(v * SIZE));
      const index = y * SIZE + x;
      expect(index * RGBA_CHANNELS + 3).toBeLessThan(maps.albedo.length);
      expect(maps.albedo[index * RGBA_CHANNELS + 3]).toBe(255);
      expect(maps.normal[index * RGBA_CHANNELS + 3]).toBe(255);
      expect(maps.roughness[index * RGBA_CHANNELS + 3]).toBe(255);
      // The height field the other two were derived from is on the same grid.
      expect(Number.isFinite(maps.height[index])).toBe(true);
    }
  });

  it('defaults to the declared texture size for every map', () => {
    const maps = buildMaterialMaps('steel');
    for (const buffer of [maps.albedo, maps.normal, maps.roughness]) {
      expect(buffer.length).toBe(TEXTURE_SIZE * TEXTURE_SIZE * RGBA_CHANNELS);
    }
    expect(maps.size).toBe(TEXTURE_SIZE);
  });

  it('derives the normal from that material own height field', () => {
    const maps = buildMaterialMaps('brick', SIZE);
    const expected = DEFAULT_DERIVATIONS.normal(maps.height, SIZE);
    expect(Array.from(maps.normal)).toEqual(Array.from(expected));
    expect(maps.hasNormal).toBe(true);
    expect(maps.hasRoughness).toBe(true);
  });

  it('derives the roughness inside that material declared band', () => {
    const maps = buildMaterialMaps('steel', SIZE);
    const { min, max } = MATERIAL_TABLE.steel.roughness;
    for (let i = 0; i < SIZE * SIZE; i += 1) {
      const value = decodeRoughness(maps.roughness, i);
      expect(value).toBeGreaterThanOrEqual(min - 1 / 255);
      expect(value).toBeLessThanOrEqual(max + 1 / 255);
    }
  });
});

describe('US2-S7: a failed derivation degrades, it does not stall', () => {
  const throwingNormal: MapDerivations = {
    normal: () => {
      throw new Error('synthetic normal failure');
    },
    roughness: DEFAULT_DERIVATIONS.roughness,
  };
  const throwingRoughness: MapDerivations = {
    normal: DEFAULT_DERIVATIONS.normal,
    roughness: () => {
      throw new Error('synthetic roughness failure');
    },
  };

  it('ships a flat normal, keeps the albedo, and records the fallback', () => {
    const maps = buildMaterialMaps('stone', SIZE, throwingNormal);
    expect(maps.hasNormal).toBe(false);
    expect(maps.hasRoughness).toBe(true);
    for (let i = 0; i < SIZE * SIZE; i += 1) {
      const o = i * RGBA_CHANNELS;
      expect(maps.normal[o]).toBe(FLAT_NORMAL_ENCODED[0]);
      expect(maps.normal[o + 1]).toBe(FLAT_NORMAL_ENCODED[1]);
      expect(maps.normal[o + 2]).toBe(FLAT_NORMAL_ENCODED[2]);
      expect(decodeNormalTexel(maps.normal, i)[2]).toBeGreaterThan(0);
    }
    // An untextured surface is never an allowed outcome: the albedo is intact.
    const reference = buildMaterialMaps('stone', SIZE);
    expect(Array.from(maps.albedo)).toEqual(Array.from(reference.albedo));
    const fallbacks = materialDiagnostics().fallbacks;
    expect(fallbacks).toHaveLength(1);
    expect(fallbacks[0]?.material).toBe('stone');
    expect(fallbacks[0]?.map).toBe('normal');
    expect(fallbacks[0]?.reason).toContain('synthetic normal failure');
  });

  it('ships the declared constant roughness, keeps the albedo, records it', () => {
    const maps = buildMaterialMaps('wood', SIZE, throwingRoughness);
    expect(maps.hasRoughness).toBe(false);
    expect(maps.hasNormal).toBe(true);
    for (let i = 0; i < SIZE * SIZE; i += 1) {
      expect(Math.abs(decodeRoughness(maps.roughness, i) - FALLBACK_ROUGHNESS)).toBeLessThanOrEqual(
        1 / 255,
      );
    }
    const reference = buildMaterialMaps('wood', SIZE);
    expect(Array.from(maps.albedo)).toEqual(Array.from(reference.albedo));
    expect(materialDiagnostics().fallbacks.map((f) => f.map)).toEqual(['roughness']);
  });

  it('degrades both maps at once and still ships an albedo', () => {
    const maps = buildMaterialMaps('blood-stone', SIZE, {
      normal: throwingNormal.normal,
      roughness: throwingRoughness.roughness,
    });
    expect(maps.hasNormal).toBe(false);
    expect(maps.hasRoughness).toBe(false);
    expect(maps.albedo.some((byte) => byte !== 0)).toBe(true);
    expect(materialDiagnostics().fallbacks).toHaveLength(2);
  });

  it('reports the degradation on window.__diag.materials.fallbacks', () => {
    buildMaterialMaps('steel', SIZE, throwingNormal);
    const diag = createDiagnostics();
    publishMaterialDiagnostics(diag);
    expect(diag.materials).toBeDefined();
    expect(diag.materials!.fallbacks).toHaveLength(1);
    expect(diag.materials!.fallbacks[0]).toMatchObject({ material: 'steel', map: 'normal' });
  });

  it('records one line per (material, map), not one per retry', () => {
    recordFallback({ material: 'steel', map: 'normal', reason: 'first' });
    recordFallback({ material: 'steel', map: 'normal', reason: 'second' });
    expect(materialDiagnostics().fallbacks).toHaveLength(1);
    expect(materialDiagnostics().fallbacks[0]?.reason).toBe('first');
  });

  it('records no fallback at all on the happy path', () => {
    buildAllMaterialMaps(SIZE);
    expect(materialDiagnostics().fallbacks).toEqual([]);
    for (const entry of materialDiagnostics().materials) {
      expect(entry.hasNormal).toBe(true);
      expect(entry.hasRoughness).toBe(true);
    }
  });
});

describe('US2-S8: the map set reports its cost as a number', () => {
  it('computes bytes from the declared size and channel count', () => {
    expect(mapBytes(SIZE, 1)).toBe(SIZE * SIZE * RGBA_CHANNELS);
    expect(mapBytes(TEXTURE_SIZE, MAPS_PER_MATERIAL * MATERIAL_NAMES.length)).toBe(
      TEXTURE_SIZE * TEXTURE_SIZE * RGBA_CHANNELS * MAPS_PER_MATERIAL * MATERIAL_NAMES.length,
    );
  });

  it('publishes textureCount, bytes, generatedMs and the per-material list', () => {
    const built = buildAllMaterialMaps(SIZE);
    const report = built.diagnostics;
    expect(MAPS_PER_MATERIAL).toBe(3);
    expect(report.textureCount).toBe(MATERIAL_NAMES.length * MAPS_PER_MATERIAL);
    expect(report.bytes).toBe(mapBytes(SIZE, report.textureCount));
    expect(report.generatedMs).toBe(generationStats().generatedMs);
    expect(report.generatedMs).toBeGreaterThanOrEqual(0);
    expect(report.materials.map((entry) => entry.name)).toEqual([...MATERIAL_NAMES]);
    for (const entry of report.materials) {
      expect(Object.keys(entry).sort()).toEqual(['hasNormal', 'hasRoughness', 'name']);
    }
  });

  it('makes a resolution change visible as a different byte count', () => {
    const small = buildAllMaterialMaps(SIZE).diagnostics.bytes;
    resetMaterialDiagnostics();
    const large = buildAllMaterialMaps(SIZE * 2).diagnostics.bytes;
    expect(large).toBe(small * 4);
  });

  it('returns one complete map set per declared material', () => {
    const built = buildAllMaterialMaps(SIZE);
    expect(Object.keys(built.maps).sort()).toEqual([...MATERIAL_NAMES].sort());
    for (const name of MATERIAL_NAMES) {
      expect(built.maps[name].size).toBe(SIZE);
      expect(built.maps[name].normal.length).toBe(SIZE * SIZE * RGBA_CHANNELS);
    }
  });

  it('reaches window.__diag additively, renaming nothing 001 declared', () => {
    const diag = createDiagnostics('webgpu');
    buildAllMaterialMaps(SIZE);
    publishMaterialDiagnostics(diag);
    expect(diag.renderer).toBe('webgpu');
    expect(diag.ready).toBe(false);
    expect(diag.level).toBeNull();
    expect(diag.errors).toEqual([]);
    expect(diag.materials!.textureCount).toBe(MATERIAL_NAMES.length * MAPS_PER_MATERIAL);
  });
});

describe('the diagnostics shape US3 and US4 write through', () => {
  it('declares every field the plan names, zero-initialised', () => {
    const fresh = createMaterialDiagnostics();
    expect(fresh).toEqual({
      generatedMs: 0,
      textureCount: 0,
      bytes: 0,
      untexturedMeshes: 0,
      lights: 0,
      shadowsEnabled: false,
      fallbacks: [],
      materials: [],
    });
  });

  it('is reset back to that shape between builds', () => {
    buildAllMaterialMaps(SIZE);
    expect(materialDiagnostics().textureCount).toBeGreaterThan(0);
    resetMaterialDiagnostics();
    expect(materialDiagnostics()).toEqual(createMaterialDiagnostics());
  });
});
