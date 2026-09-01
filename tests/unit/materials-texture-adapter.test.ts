import { describe, it, expect, beforeEach } from 'vitest';
import {
  BoxGeometry,
  LinearFilter,
  LinearMipmapLinearFilter,
  LinearSRGBColorSpace,
  Mesh,
  RepeatWrapping,
  SRGBColorSpace,
  type Texture,
} from 'three';
import { buildMaterialMaps, MAPS_PER_MATERIAL } from '../../src/materials/maps';
import { MATERIAL_NAMES, type MaterialName } from '../../src/materials/table';
import {
  MATERIAL_ANISOTROPY,
  adaptMaterial,
  adaptedMaterials,
  resetMaterialCache,
  upgradeMaterialMaps,
} from '../../src/materials/texture-adapter';
import { readMaterialsProbe } from '../../src/systems/materials/probe';

// FR-011 / US4-S3, US4-S5. One MeshStandardMaterial and one set of maps per
// material, shared by every mesh; and every uploaded map is mipmapped, filtered
// with a mipmap minification filter and given the declared anisotropy, or a
// corridor wall at a grazing angle aliases into noise no matter what the
// generator produced.

/** Small enough to build five materials in a unit test; the adapter's contract
 * is about texture state, not resolution. */
const SIZE = 16;

const mapsOf = (name: MaterialName) => buildMaterialMaps(name, SIZE);

function everyTexture(): Texture[] {
  return adaptedMaterials().flatMap((entry) => [entry.albedo, entry.normal, entry.roughness]);
}

/** A scene of level surfaces, each bound to its material the way the system's
 * scene walk binds them. */
function skinnedScene(meshesPerMaterial: number): Mesh[] {
  const meshes: Mesh[] = [];
  for (const name of MATERIAL_NAMES) {
    const adapted = adaptMaterial(mapsOf(name));
    for (let i = 0; i < meshesPerMaterial; i += 1) {
      const mesh = new Mesh(new BoxGeometry(1, 1, 1));
      mesh.material = adapted.material;
      meshes.push(mesh);
    }
  }
  return meshes;
}

describe('the texture adapter (US4-S5)', () => {
  beforeEach(() => {
    resetMaterialCache();
  });

  it('mipmaps every uploaded map and filters it with a mipmap filter', () => {
    expect(MATERIAL_ANISOTROPY).toBeGreaterThan(1);
    adaptMaterial(mapsOf('brick'));
    const textures = everyTexture();
    expect(textures).toHaveLength(MAPS_PER_MATERIAL);

    for (const texture of textures) {
      // generateMipmaps alone is not enough: a DataTexture defaults to
      // NearestFilter, and a nearest minification filter never samples a mipmap
      // and ignores anisotropy entirely.
      expect(texture.generateMipmaps).toBe(true);
      expect(texture.minFilter).toBe(LinearMipmapLinearFilter);
      expect(texture.magFilter).toBe(LinearFilter);
      expect(texture.anisotropy).toBe(MATERIAL_ANISOTROPY);
      expect(texture.wrapS).toBe(RepeatWrapping);
      expect(texture.wrapT).toBe(RepeatWrapping);
    }
  });

  it('uploads albedo as sRGB and the derived maps as linear', () => {
    const adapted = adaptMaterial(mapsOf('steel'));
    expect(adapted.albedo.colorSpace).toBe(SRGBColorSpace);
    expect(adapted.normal.colorSpace).toBe(LinearSRGBColorSpace);
    expect(adapted.roughness.colorSpace).toBe(LinearSRGBColorSpace);
  });
});

describe('one map set per material (US4-S3)', () => {
  beforeEach(() => {
    resetMaterialCache();
  });

  it('hands every caller the same material instance for a name', () => {
    const first = adaptMaterial(mapsOf('wood'));
    const second = adaptMaterial(mapsOf('wood'));
    expect(second).toBe(first);
    expect(second.material).toBe(first.material);
    expect(second.albedo).toBe(first.albedo);
  });

  it('uploads exactly one set of maps for five materials, not one per mesh', () => {
    // Ten meshes each asking for its material is the shape the scene walk has.
    const meshes = skinnedScene(10);

    const adapted = adaptedMaterials();
    expect(adapted).toHaveLength(MATERIAL_NAMES.length);
    const textures = everyTexture();
    expect(textures).toHaveLength(MATERIAL_NAMES.length * MAPS_PER_MATERIAL);
    expect(new Set(textures.map((texture) => texture.uuid)).size).toBe(textures.length);

    // And the same claim as the smoke harness makes it: counted off the live
    // scene rather than off a number this code wrote about itself.
    const probe = readMaterialsProbe(meshes);
    expect(probe.meshes).toBe(MATERIAL_NAMES.length * 10);
    expect(probe.names).toEqual([...MATERIAL_NAMES].sort());
    expect(probe.materialInstances).toBe(MATERIAL_NAMES.length);
    expect(probe.textureInstances).toBe(MATERIAL_NAMES.length * MAPS_PER_MATERIAL);
    expect(probe.withoutAlbedo).toBe(0);
    expect(probe.mipmapped).toBe(true);
    expect(probe.anisotropy).toEqual([MATERIAL_ANISOTROPY]);
    expect(probe.minFilters).toEqual([LinearMipmapLinearFilter]);
  });

  it('sees through the sharing when one mesh is given its own copy', () => {
    // The regression the probe exists to catch: a per-mesh clone still reports
    // `textureCount: 15` in diagnostics while uploading five times that.
    const meshes = skinnedScene(3);
    const stray = meshes[0]!;
    const original = stray.material;
    if (Array.isArray(original)) throw new Error('expected a single material');
    stray.material = original.clone();
    expect(readMaterialsProbe(meshes).materialInstances).toBe(MATERIAL_NAMES.length + 1);

    // A mesh left on the flat colour 002 gave it carries no albedo at all.
    meshes.push(new Mesh(new BoxGeometry(1, 1, 1)));
    expect(readMaterialsProbe(meshes).withoutAlbedo).toBe(1);
    expect(readMaterialsProbe([]).mipmapped).toBe(false);
  });

  it('keeps the set at one when a material is upgraded in place', () => {
    const adapted = adaptMaterial(mapsOf('stone'));
    const material = adapted.material;
    const versionBefore = material.version;
    const disposed = new Set<string>();
    for (const texture of [adapted.albedo, adapted.normal, adapted.roughness]) {
      texture.addEventListener('dispose', () => disposed.add(texture.uuid));
    }

    const upgraded = upgradeMaterialMaps(buildMaterialMaps('stone', SIZE * 2));

    // The mesh graph holds the material, never the texture, so an upgrade must
    // reuse the material instance and replace what hangs off it.
    expect(upgraded.material).toBe(material);
    expect(material.map).toBe(upgraded.albedo);
    expect(material.normalMap).toBe(upgraded.normal);
    expect(material.roughnessMap).toBe(upgraded.roughness);
    // `needsUpdate` is write-only on a three.js Material; the version counter is
    // what it bumps, and what tells the renderer to recompile the program.
    expect(material.version).toBeGreaterThan(versionBefore);

    // The superseded set is released rather than left resident: still one set.
    expect(disposed.size).toBe(MAPS_PER_MATERIAL);
    expect(everyTexture()).toHaveLength(MAPS_PER_MATERIAL);
    expect(adaptedMaterials()).toHaveLength(1);
  });

  it('refuses to upgrade a material that was never adapted', () => {
    expect(() => upgradeMaterialMaps(buildMaterialMaps('blood-stone', SIZE))).toThrow(
      /never adapted/,
    );
  });
});
