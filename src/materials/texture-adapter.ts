// The one place in `src/materials/` where a generated buffer meets three.js
// (FR-011). Everything upstream of this file is `Uint8ClampedArray` in and
// `Uint8ClampedArray` out, which is what lets `npm run test` decide whether a
// texture is right; everything downstream is a renderer's problem. Keeping the
// boundary to a single module is what makes that claim checkable — see the
// import-graph assertion in `tests/unit/materials-purity.test.ts`.
//
// It also owns the sharing rule (FR-010, US3-S8): one `DataTexture` per
// (material, map) and one `MeshStandardMaterial` per material, cached by name for
// the life of the page. Five materials therefore upload five albedo, five normal
// and five roughness maps in total, however many meshes sample them — the
// difference between fifteen textures and fifteen per mesh.

import {
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  MeshStandardMaterial,
  NoColorSpace,
  RGBAFormat,
  RepeatWrapping,
  SRGBColorSpace,
  UnsignedByteType,
} from 'three';
import { RGBA_CHANNELS } from './constants';
import { MAPS_PER_MATERIAL } from './maps';
import type { MaterialMapSet } from './maps';
import type { MaterialName } from './table';

/**
 * The declared anisotropy level (FR-011, US3-S10). Sampled across the level's
 * longest corridor a floor texel covers a fraction of a pixel in one axis and
 * many in the other; trilinear filtering alone answers that by blurring to a
 * distant mip, and the corridor turns to mush. Eight taps is the usual point of
 * diminishing returns and is inside every target backend's minimum. three.js
 * clamps it to the renderer's own maximum at upload, so a backend that offers
 * less degrades rather than fails.
 */
export const TEXTURE_ANISOTROPY = 8;

/** Which of a material's three maps a texture is. */
export type MapKind = 'albedo' | 'normal' | 'roughness';

/** The three maps in the order a material set declares them. */
export const MAP_KINDS: readonly MapKind[] = ['albedo', 'normal', 'roughness'];

const textures = new Map<string, DataTexture>();
const materials = new Map<MaterialName, MeshStandardMaterial>();

/**
 * Albedo is authored in sRGB and must be decoded before it is lit; normal and
 * roughness are numbers, not colours, and decoding them would bend the surface.
 */
function colorSpaceOf(kind: MapKind): typeof SRGBColorSpace | typeof NoColorSpace {
  return kind === 'albedo' ? SRGBColorSpace : NoColorSpace;
}

/**
 * Wraps a finished buffer into a `DataTexture`: repeat wrapping so tile-space UVs
 * beyond `1` keep sampling, mipmaps with trilinear minification and the declared
 * anisotropy so a grazing angle does not alias, and the right colour space for
 * the map's kind (FR-011, US3-S10).
 */
export function createMapTexture(
  data: Uint8ClampedArray,
  size: number,
  kind: MapKind,
): DataTexture {
  // `DataTexture` is typed against a view over a plain `ArrayBuffer`; a generated
  // buffer is a view over `ArrayBufferLike`, which is the same bytes. The cast is
  // the whole reason this module exists: it is the one place the generated data
  // stops being data and becomes a texture.
  const view = data as unknown as Uint8ClampedArray & { buffer: ArrayBuffer };
  const texture = new DataTexture(view, size, size, RGBAFormat, UnsignedByteType);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.generateMipmaps = true;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.magFilter = LinearFilter;
  texture.anisotropy = TEXTURE_ANISOTROPY;
  texture.colorSpace = colorSpaceOf(kind);
  texture.needsUpdate = true;
  return texture;
}

/** One material's one texture of one kind, built at most once (FR-010, US3-S8). */
export function mapTexture(set: MaterialMapSet, kind: MapKind): DataTexture {
  const key = `${set.name}:${kind}`;
  const cached = textures.get(key);
  if (cached != null) return cached;
  const created = createMapTexture(set[kind], set.size, kind);
  textures.set(key, created);
  return created;
}

/**
 * The one `MeshStandardMaterial` every mesh of this material shares (FR-010,
 * US3-S8). Roughness and metalness are left at the standard material's defaults
 * so the roughness map US2 derived is what varies the surface — a second scalar
 * here would silently override the map the table declares.
 */
export function sharedMaterial(set: MaterialMapSet): MeshStandardMaterial {
  const cached = materials.get(set.name);
  if (cached != null) return cached;
  const material = new MeshStandardMaterial({
    name: set.name,
    map: mapTexture(set, 'albedo'),
    normalMap: mapTexture(set, 'normal'),
    roughnessMap: mapTexture(set, 'roughness'),
  });
  materials.set(set.name, material);
  return material;
}

/** An already-built material, or null. Never builds: a caller with no map set in
 * hand cannot be the one that decides what the material is. */
export function builtMaterial(name: MaterialName): MeshStandardMaterial | null {
  return materials.get(name) ?? null;
}

export interface TextureCacheStats {
  /** Distinct `DataTexture` objects uploaded, across every material. */
  readonly textures: number;
  /** Distinct `MeshStandardMaterial` objects, one per material name. */
  readonly materials: number;
  /** What those textures weigh, from the declared channel count. */
  readonly bytes: number;
  /** True while every material holds exactly one set of maps (US3-S8). */
  readonly oneSetPerMaterial: boolean;
}

/** What the cache actually holds — the number US3-S8 is asserted on, read from
 * the cache rather than assumed from the table. */
export function textureCacheStats(): TextureCacheStats {
  let bytes = 0;
  for (const texture of textures.values()) {
    bytes += texture.image.width * texture.image.height * RGBA_CHANNELS;
  }
  return {
    textures: textures.size,
    materials: materials.size,
    bytes,
    oneSetPerMaterial: textures.size === materials.size * MAPS_PER_MATERIAL,
  };
}

/** Drops every cached texture and material, disposing the GPU side. For tests
 * and for nothing else: the page shares these for its whole lifetime. */
export function resetTextureCacheForTest(): void {
  for (const texture of textures.values()) texture.dispose();
  for (const material of materials.values()) material.dispose();
  textures.clear();
  materials.clear();
}
