import { describe, it, expect } from 'vitest';
import { BoxGeometry, LinearFilter, LinearMipmapLinearFilter, Mesh } from 'three';
import { buildMaterialMaps } from '../../src/materials/maps';
import { MATERIAL_NAMES } from '../../src/materials/table';
import {
  MATERIAL_ANISOTROPY,
  adaptMaterial,
  resetMaterialCache,
} from '../../src/materials/texture-adapter';
import { readMaterialsProbe } from '../../src/systems/materials/probe';

// US4-S3, US4-S5. `textureCount: 15` is a number the page wrote about itself and
// reads the same whether fifteen textures are shared by ninety meshes or
// duplicated per mesh. The probe counts distinct objects on the meshes, which is
// what the smoke harness asserts against — so it is worth its own test.

const SIZE = 8;

function skinnedScene(meshesPerMaterial: number): Mesh[] {
  resetMaterialCache();
  const meshes: Mesh[] = [];
  for (const name of MATERIAL_NAMES) {
    const adapted = adaptMaterial(buildMaterialMaps(name, SIZE));
    for (let i = 0; i < meshesPerMaterial; i += 1) {
      const mesh = new Mesh(new BoxGeometry(1, 1, 1));
      mesh.material = adapted.material;
      meshes.push(mesh);
    }
  }
  return meshes;
}

describe('the materials probe', () => {
  it('counts one material and one map set per name however many meshes use them', () => {
    const probe = readMaterialsProbe(skinnedScene(18));

    expect(probe.meshes).toBe(MATERIAL_NAMES.length * 18);
    expect(probe.names).toEqual([...MATERIAL_NAMES].sort());
    expect(probe.materialInstances).toBe(MATERIAL_NAMES.length);
    expect(probe.textureInstances).toBe(MATERIAL_NAMES.length * 3);
    expect(probe.withoutAlbedo).toBe(0);
  });

  it('reports the mipmap and anisotropy state the harness asserts', () => {
    const probe = readMaterialsProbe(skinnedScene(2));
    expect(probe.mipmapped).toBe(true);
    expect(probe.anisotropy).toEqual([MATERIAL_ANISOTROPY]);
    expect(probe.minFilters).toEqual([LinearMipmapLinearFilter]);
    expect(probe.minFilters).not.toContain(LinearFilter);
  });

  it('sees through the sharing when a mesh is given its own copy', () => {
    // The regression the probe exists to catch: a per-mesh clone still reports
    // `textureCount: 15` in diagnostics while uploading five times that.
    const meshes = skinnedScene(3);
    const stray = meshes[0]!;
    const original = stray.material;
    if (Array.isArray(original)) throw new Error('expected a single material');
    stray.material = original.clone();

    const probe = readMaterialsProbe(meshes);
    expect(probe.materialInstances).toBe(MATERIAL_NAMES.length + 1);
    // A cloned material shares its parent's texture objects, so the map set
    // count is what stays honest here; the material count is what moved.
    expect(probe.textureInstances).toBe(MATERIAL_NAMES.length * 3);
  });

  it('counts a mesh left on the flat colour 002 gave it as carrying no albedo', () => {
    const meshes = skinnedScene(1);
    const bare = new Mesh(new BoxGeometry(1, 1, 1));
    meshes.push(bare);
    expect(readMaterialsProbe(meshes).withoutAlbedo).toBe(1);
  });

  it('reports an empty scene without claiming it is mipmapped', () => {
    const probe = readMaterialsProbe([]);
    expect(probe.meshes).toBe(0);
    expect(probe.mipmapped).toBe(false);
  });
});
