import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { RGBA_CHANNELS } from '../../src/materials/constants';
import { MATERIAL_NAMES, MATERIAL_TABLE } from '../../src/materials/table';
import { generateAlbedo, generationStats } from '../../src/materials/generate';
import { deriveNormalMap, flatNormalMap } from '../../src/materials/normal';
import {
  FALLBACK_ROUGHNESS,
  constantRoughnessMap,
  deriveRoughnessMap,
} from '../../src/materials/roughness';
import {
  materialDiagnostics,
  resetMaterialDiagnostics,
} from '../../src/materials/diagnostics';
import {
  DEFAULT_DERIVATIONS,
  MAPS_PER_MATERIAL,
  buildAllMaterialMaps,
  buildMaterialMaps,
  textureBytes,
} from '../../src/materials/maps';
import type { MapDerivations } from '../../src/materials/maps';

// FR-005, FR-006, FR-007 / US2-S6..S8. A material is a complete map set or it
// is a declared degradation; it is never a surface with no albedo.

const SIZE = 32;

function throwingNormal(): MapDerivations {
  return {
    normal: () => {
      throw new Error('normal derivation failed');
    },
    roughness: DEFAULT_DERIVATIONS.roughness,
  };
}

function throwingRoughness(): MapDerivations {
  return {
    normal: DEFAULT_DERIVATIONS.normal,
    roughness: () => {
      throw new Error('roughness derivation failed');
    },
  };
}

beforeEach(() => {
  resetMaterialDiagnostics();
});

describe('three maps in one UV space (US2-S6)', () => {
  it.each(MATERIAL_NAMES)('%s', (name) => {
    const set = buildMaterialMaps(name, SIZE);
    expect(set.size).toBe(SIZE);
    for (const map of [set.albedo, set.normal, set.roughness]) {
      expect(map.length).toBe(SIZE * SIZE * RGBA_CHANNELS);
    }
    expect(set.height.length).toBe(SIZE * SIZE);
    expect(set.hasNormal).toBe(true);
    expect(set.hasRoughness).toBe(true);
  });

  it('addresses every map by the same texel offset, with no sampling shift', () => {
    const set = buildMaterialMaps('brick', SIZE);
    const generated = generateAlbedo('brick', SIZE);
    // Byte equality against the maps derived independently from the same height
    // field is what proves no map is rotated, flipped or offset by a row.
    expect(Array.from(set.albedo)).toEqual(Array.from(generated.albedo));
    expect(Array.from(set.normal)).toEqual(Array.from(deriveNormalMap(generated.height, SIZE)));
    expect(Array.from(set.roughness)).toEqual(
      Array.from(deriveRoughnessMap(generated.height, SIZE, MATERIAL_TABLE['brick'].roughness)),
    );
  });
});

describe('a failed derivation degrades rather than stalls (FR-007, US2-S7)', () => {
  it('ships a flat normal, the declared constant roughness and its albedo', () => {
    const set = buildMaterialMaps('stone', SIZE, throwingNormal());
    expect(set.hasNormal).toBe(false);
    expect(set.hasRoughness).toBe(false);
    expect(Array.from(set.normal)).toEqual(Array.from(flatNormalMap(SIZE)));
    expect(Array.from(set.roughness)).toEqual(
      Array.from(constantRoughnessMap(SIZE, FALLBACK_ROUGHNESS)),
    );
    expect(Array.from(set.albedo)).toEqual(Array.from(generateAlbedo('stone', SIZE).albedo));
  });

  it('records the degradation in the diagnostics fallbacks list', () => {
    buildMaterialMaps('stone', SIZE, throwingNormal());
    const { fallbacks } = materialDiagnostics();
    expect(fallbacks).toHaveLength(1);
    expect(fallbacks[0]!.name).toBe('stone');
    expect(fallbacks[0]!.map).toBe('normal');
    expect(fallbacks[0]!.reason).toContain('normal derivation failed');
  });

  it('degrades the same way when the roughness derivation is the one that fails', () => {
    const set = buildMaterialMaps('wood', SIZE, throwingRoughness());
    expect(set.hasNormal).toBe(false);
    expect(set.hasRoughness).toBe(false);
    expect(Array.from(set.albedo)).toEqual(Array.from(generateAlbedo('wood', SIZE).albedo));
    expect(materialDiagnostics().fallbacks[0]!.map).toBe('roughness');
  });

  it('never records a fallback for a material that derived cleanly', () => {
    buildMaterialMaps('steel', SIZE);
    expect(materialDiagnostics().fallbacks).toHaveLength(0);
  });

  it('is described as one line in DECISIONS.md', () => {
    const decisions = readFileSync(
      fileURLToPath(new URL('../../DECISIONS.md', import.meta.url)),
      'utf8',
    );
    const line = decisions
      .split('\n')
      .find((entry) => /005-materials/.test(entry) && /flat normal/i.test(entry));
    expect(line).toBeDefined();
    expect(line).toMatch(/FALLBACK_ROUGHNESS|constant roughness/);
  });
});

describe('the whole map set is reported as a number (US2-S8)', () => {
  it('publishes the texture count, byte total and per-material map flags', () => {
    const all = buildAllMaterialMaps(SIZE);
    const diag = materialDiagnostics();

    expect(Object.keys(all)).toHaveLength(MATERIAL_NAMES.length);
    expect(diag.textureCount).toBe(MATERIAL_NAMES.length * MAPS_PER_MATERIAL);
    expect(diag.bytes).toBe(SIZE * SIZE * RGBA_CHANNELS * MAPS_PER_MATERIAL * MATERIAL_NAMES.length);
    expect(diag.bytes).toBe(textureBytes(SIZE, diag.textureCount));
    expect(diag.generatedMs).toBe(generationStats().generatedMs);
    expect(diag.materials.map((entry) => entry.name)).toEqual([...MATERIAL_NAMES]);
    for (const entry of diag.materials) {
      expect(entry.hasNormal).toBe(true);
      expect(entry.hasRoughness).toBe(true);
    }
  });

  it('makes a resolution change visible as a different byte total', () => {
    expect(textureBytes(SIZE * 2, 15)).toBe(textureBytes(SIZE, 15) * 4);
  });

  it('reports the degraded material in the per-material list', () => {
    buildAllMaterialMaps(SIZE, throwingNormal());
    const diag = materialDiagnostics();
    expect(diag.fallbacks).toHaveLength(MATERIAL_NAMES.length);
    expect(diag.materials.every((entry) => entry.hasNormal === false)).toBe(true);
    expect(diag.textureCount).toBe(MATERIAL_NAMES.length * MAPS_PER_MATERIAL);
  });
});
