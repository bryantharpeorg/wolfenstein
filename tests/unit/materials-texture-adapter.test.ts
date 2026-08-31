import { describe, it, expect, beforeEach } from 'vitest';
import {
  LinearFilter,
  LinearMipmapLinearFilter,
  NoColorSpace,
  RepeatWrapping,
  SRGBColorSpace,
} from 'three';
import { RGBA_CHANNELS } from '../../src/materials/constants';
import { MAPS_PER_MATERIAL, buildMaterialMaps } from '../../src/materials/maps';
import { MATERIAL_NAMES } from '../../src/materials/table';
import {
  MAP_KINDS,
  TEXTURE_ANISOTROPY,
  builtMaterial,
  createMapTexture,
  mapTexture,
  resetTextureCacheForTest,
  sharedMaterial,
  textureCacheStats,
} from '../../src/materials/texture-adapter';

// FR-010 / FR-011, US3-S8, US3-S10: the adapter is the only module in
// `src/materials/` that knows what a renderer is, and the two things it owns are
// the sampling state a grazing angle needs and the sharing rule that keeps five
// materials at five map sets rather than one set per mesh.

// Small enough to build all five in a test run; the page uses TEXTURE_SIZE.
const SIZE = 16;

beforeEach(() => {
  resetTextureCacheForTest();
});

describe('a wrapped map', () => {
  const set = () => buildMaterialMaps('brick', SIZE);

  it('repeats rather than clamping, so tile-space UVs past 1 keep sampling', () => {
    const texture = createMapTexture(set().albedo, SIZE, 'albedo');
    expect(texture.wrapS).toBe(RepeatWrapping);
    expect(texture.wrapT).toBe(RepeatWrapping);
  });

  it('is mipmapped and filtered at the declared anisotropy (US3-S10)', () => {
    const texture = createMapTexture(set().albedo, SIZE, 'albedo');
    expect(texture.generateMipmaps).toBe(true);
    expect(texture.minFilter).toBe(LinearMipmapLinearFilter);
    expect(texture.magFilter).toBe(LinearFilter);
    expect(TEXTURE_ANISOTROPY).toBeGreaterThan(1);
    expect(texture.anisotropy).toBe(TEXTURE_ANISOTROPY);
  });

  it('decodes albedo as sRGB and leaves normal and roughness linear', () => {
    const maps = set();
    expect(createMapTexture(maps.albedo, SIZE, 'albedo').colorSpace).toBe(SRGBColorSpace);
    expect(createMapTexture(maps.normal, SIZE, 'normal').colorSpace).toBe(NoColorSpace);
    expect(createMapTexture(maps.roughness, SIZE, 'roughness').colorSpace).toBe(NoColorSpace);
  });

  it('carries the buffer it was handed, at the size it was generated', () => {
    const maps = set();
    const texture = createMapTexture(maps.albedo, SIZE, 'albedo');
    expect(texture.image.width).toBe(SIZE);
    expect(texture.image.height).toBe(SIZE);
    expect(texture.image.data).toBe(maps.albedo);
    // `needsUpdate` is a write-only setter in three.js; the version it bumps is
    // the readable proof that the buffer was marked for upload.
    expect(texture.version).toBeGreaterThan(0);
  });
});

describe('the per-name cache', () => {
  it('builds one material per name, shared by every caller (US3-S8)', () => {
    const maps = buildMaterialMaps('stone', SIZE);
    const first = sharedMaterial(maps);
    const second = sharedMaterial(buildMaterialMaps('stone', SIZE));
    expect(second).toBe(first);
    expect(builtMaterial('stone')).toBe(first);
  });

  it('builds one texture per (material, map), not one per request', () => {
    const maps = buildMaterialMaps('wood', SIZE);
    for (const kind of MAP_KINDS) {
      expect(mapTexture(maps, kind)).toBe(mapTexture(maps, kind));
    }
    expect(textureCacheStats().textures).toBe(MAPS_PER_MATERIAL);
  });

  it('gives the five materials exactly one set of maps each (US3-S8)', () => {
    for (const name of MATERIAL_NAMES) sharedMaterial(buildMaterialMaps(name, SIZE));
    // Ask a second time, as a second mesh of the same material would.
    for (const name of MATERIAL_NAMES) sharedMaterial(buildMaterialMaps(name, SIZE));

    const stats = textureCacheStats();
    expect(stats.materials).toBe(MATERIAL_NAMES.length);
    expect(stats.textures).toBe(MATERIAL_NAMES.length * MAPS_PER_MATERIAL);
    expect(stats.oneSetPerMaterial).toBe(true);
    expect(stats.bytes).toBe(stats.textures * SIZE * SIZE * RGBA_CHANNELS);
  });

  it('gives every material all three maps, so no surface ships without albedo', () => {
    for (const name of MATERIAL_NAMES) {
      const material = sharedMaterial(buildMaterialMaps(name, SIZE));
      expect(material.name).toBe(name);
      expect(material.map).not.toBeNull();
      expect(material.normalMap).not.toBeNull();
      expect(material.roughnessMap).not.toBeNull();
    }
  });

  it('shares one texture object between the material and a direct request', () => {
    const maps = buildMaterialMaps('steel', SIZE);
    const material = sharedMaterial(maps);
    expect(material.map).toBe(mapTexture(maps, 'albedo'));
    expect(material.normalMap).toBe(mapTexture(maps, 'normal'));
    expect(material.roughnessMap).toBe(mapTexture(maps, 'roughness'));
  });

  it('reports nothing built before anything asks', () => {
    expect(textureCacheStats().textures).toBe(0);
    expect(builtMaterial('brick')).toBeNull();
  });
});
