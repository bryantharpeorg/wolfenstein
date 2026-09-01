/**
 * `window.__materialsProbe()` — the harness's window onto facts that only exist
 * once the scene is built (US4-S3, US4-S5).
 *
 * "One set of maps per material, shared by every mesh" and "mipmaps and the
 * declared anisotropy are in effect" are claims about live GPU objects, and no
 * count in `__diag` can make them: `textureCount: 15` stays 15 whether the
 * fifteen textures are shared by ninety meshes or cloned per mesh. So the probe
 * walks the skinned meshes and counts the *distinct* objects hanging off them.
 */
import type { Mesh, Texture } from 'three';
import { MeshStandardMaterial } from 'three';

export interface MaterialsProbe {
  /** Level surfaces this system skinned. */
  readonly meshes: number;
  /** Distinct material names bound across them, sorted. */
  readonly names: readonly string[];
  /** Distinct `MeshStandardMaterial` instances — one per name, or the sharing
   * FR-010's draw-call budget depends on is not happening. */
  readonly materialInstances: number;
  /** Distinct texture objects across every bound material's three maps. */
  readonly textureInstances: number;
  /** Meshes whose material carries no albedo map. */
  readonly withoutAlbedo: number;
  /** Distinct anisotropy levels, so a texture clamped by the driver is visible,
   * and distinct minification filters as three.js constants. */
  readonly anisotropy: readonly number[];
  readonly minFilters: readonly number[];
  /** Whether every uploaded map asks for a mipmap chain. */
  readonly mipmapped: boolean;
}

declare global {
  interface Window {
    /** Harness only; the game never calls it. */
    __materialsProbe?: () => MaterialsProbe;
  }
}

function mapsOf(material: MeshStandardMaterial): Texture[] {
  return [material.map, material.normalMap, material.roughnessMap].filter(
    (texture): texture is Texture => texture != null,
  );
}

export function readMaterialsProbe(meshes: readonly Mesh[]): MaterialsProbe {
  const names = new Set<string>();
  const materialIds = new Set<string>();
  const textureIds = new Set<string>();
  const anisotropy = new Set<number>();
  const minFilters = new Set<number>();
  const textures: Texture[] = [];
  let withoutAlbedo = 0;

  for (const mesh of meshes) {
    const bound = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of bound) {
      if (!(material instanceof MeshStandardMaterial)) {
        withoutAlbedo += 1;
        continue;
      }
      if (material.map == null) withoutAlbedo += 1;
      names.add(material.name);
      materialIds.add(material.uuid);
      for (const texture of mapsOf(material)) {
        if (textureIds.has(texture.uuid)) continue;
        textureIds.add(texture.uuid);
        textures.push(texture);
        anisotropy.add(texture.anisotropy);
        minFilters.add(texture.minFilter);
      }
    }
  }

  return {
    meshes: meshes.length,
    names: [...names].sort(),
    materialInstances: materialIds.size,
    textureInstances: textureIds.size,
    withoutAlbedo,
    anisotropy: [...anisotropy].sort((a, b) => a - b),
    minFilters: [...minFilters].sort((a, b) => a - b),
    mipmapped: textures.length > 0 && textures.every((texture) => texture.generateMipmaps),
  };
}

/** Publishes the probe. Called once, from the materials system's setup. */
export function installMaterialsProbe(meshes: readonly Mesh[]): void {
  if (typeof window === 'undefined') return;
  window.__materialsProbe = () => readMaterialsProbe(meshes);
}
