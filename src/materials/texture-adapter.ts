// The generator/adapter seam, from the renderer's side (FR-011, US4-S3, US4-S5).
//
// This is the only module under `src/materials/` that imports three, and it does
// exactly one thing: wrap a finished buffer in a `DataTexture` with the sampling
// state a wall needs — repeat wrapping so the tile-space UVs of `uv.ts` tile,
// mipmaps and a declared anisotropy so a corridor seen end-on stays a surface
// instead of aliasing into noise, sRGB for the colour a human sees and linear
// for the two maps that are numbers rather than colours.
//
// It also owns the texture economy. `sharedMaterial()` is memoized per material
// name, so twenty meshes wearing brick upload one set of maps between them
// rather than twenty. Nothing here regenerates: the cache is the page's, for the
// page's lifetime, which is why a viewport resize costs nothing (US4-S4).

import {
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  LinearSRGBColorSpace,
  MeshStandardMaterial,
  RepeatWrapping,
  RGBAFormat,
  SRGBColorSpace,
  UnsignedByteType,
} from 'three';
import type { ColorSpace } from 'three';
import type { MaterialMapSet } from './maps';
import type { MaterialName } from './table';

/** The anisotropy level this project declares (FR-011, US4-S5). Sixteen is the
 *  common hardware ceiling; eight is the level a grazing corridor needs and is
 *  affordable everywhere. Clamped against what the renderer reports it can do,
 *  since asking for more than the driver supports silently gets you less. */
export const TEXTURE_ANISOTROPY = 8;

/** Albedo, normal and roughness: what one shared material uploads. */
export const MAPS_PER_UPLOAD = 3;

/** The declared level, clamped to what the driver actually supports. */
export function resolveAnisotropy(maxSupported: number): number {
  if (!Number.isFinite(maxSupported) || maxSupported < 1) return 1;
  return Math.min(TEXTURE_ANISOTROPY, Math.floor(maxSupported));
}

/**
 * One buffer, one texture. Mipmapped and trilinear, because the alternative at
 * a grazing angle is a shimmer; repeat-wrapped, because `uv.ts` hands out UVs
 * that count tiles and expects the sampler to wrap them.
 */
export function createMapTexture(
  data: Uint8ClampedArray,
  size: number,
  colorSpace: ColorSpace,
  anisotropy: number,
): DataTexture {
  // A zero-copy `Uint8Array` view over the generator's clamped buffer: the
  // upload path is typed for the former and a copy of fifteen megabytes of
  // texture would be a load-time cost paid for nothing.
  const view = new Uint8Array(data.buffer as ArrayBuffer, data.byteOffset, data.byteLength);
  const texture = new DataTexture(view, size, size, RGBAFormat, UnsignedByteType);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.generateMipmaps = true;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.magFilter = LinearFilter;
  texture.anisotropy = anisotropy;
  texture.colorSpace = colorSpace;
  texture.needsUpdate = true;
  return texture;
}

/** A standard material wearing one material's three maps. Uncached: the caller
 *  that wants sharing asks for `sharedMaterial`. */
export function createStandardMaterial(
  set: MaterialMapSet,
  maxAnisotropy: number = TEXTURE_ANISOTROPY,
): MeshStandardMaterial {
  const anisotropy = resolveAnisotropy(maxAnisotropy);
  const material = new MeshStandardMaterial({
    map: createMapTexture(set.albedo, set.size, SRGBColorSpace, anisotropy),
    normalMap: createMapTexture(set.normal, set.size, LinearSRGBColorSpace, anisotropy),
    roughnessMap: createMapTexture(set.roughness, set.size, LinearSRGBColorSpace, anisotropy),
    // Full scalars so the two derived maps are what shades the surface; a
    // scalar below one would quietly wash the derivation US2 paid for out.
    roughness: 1,
    metalness: 0,
  });
  material.name = set.name;
  return material;
}

const cache = new Map<MaterialName, MeshStandardMaterial>();

/**
 * The one material per name (US4-S3). Every mesh bound to `brick` is handed the
 * same object, so the uploaded texture count is a function of how many
 * materials the level uses and not of how many meshes wear them.
 */
export function sharedMaterial(
  set: MaterialMapSet,
  maxAnisotropy: number = TEXTURE_ANISOTROPY,
): MeshStandardMaterial {
  const cached = cache.get(set.name);
  if (cached) return cached;
  const material = createStandardMaterial(set, maxAnisotropy);
  cache.set(set.name, material);
  return material;
}

/** Which materials have been uploaded, in a stable order. */
export function cachedMaterialNames(): MaterialName[] {
  return [...cache.keys()].sort();
}

/** How many map sets are live — one per cached material, never one per mesh. */
export function uploadedTextureCount(): number {
  return cache.size * MAPS_PER_UPLOAD;
}

/** Test seam. The page never empties the cache; that is what makes it a cache. */
export function disposeMaterialCache(): void {
  for (const material of cache.values()) {
    material.map?.dispose();
    material.normalMap?.dispose();
    material.roughnessMap?.dispose();
    material.dispose();
  }
  cache.clear();
}
