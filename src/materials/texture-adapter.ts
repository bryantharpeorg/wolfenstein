// The one place in `src/materials/` where a generated buffer meets three.js
// (FR-011); everything upstream is `Uint8ClampedArray` in and out, which is what
// lets `npm run test` decide whether a texture is right, and
// `materials-purity.test.ts` asserts the boundary is this file alone. It also
// owns the sharing rule (FR-010, US3-S8): one `DataTexture` per (material, map)
// and one `MeshStandardMaterial` per material, cached for the page's life, so
// five materials upload fifteen maps however many meshes sample them.

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

/** The declared anisotropy level (FR-011, US3-S10). Down the longest corridor a
 * floor texel covers a fraction of a pixel in one axis and many in the other, and
 * trilinear filtering answers that by blurring to a distant mip. three.js clamps
 * this at upload, so a backend offering less degrades rather than fails. */
export const TEXTURE_ANISOTROPY = 8;

/** A material's three maps, in declaration order. */
export type MapKind = 'albedo' | 'normal' | 'roughness';
export const MAP_KINDS: readonly MapKind[] = ['albedo', 'normal', 'roughness'];

const textures = new Map<string, DataTexture>();
const materials = new Map<MaterialName, MeshStandardMaterial>();

/** Wraps a finished buffer into a `DataTexture`: repeat wrapping so tile-space
 * UVs beyond `1` keep sampling, mipmaps and the declared anisotropy so a grazing
 * angle does not alias, and the colour space the kind needs — albedo sRGB, but
 * normal and roughness are numbers a decode would bend (FR-011, US3-S10). */
export function createMapTexture(
  data: Uint8ClampedArray,
  size: number,
  kind: MapKind,
): DataTexture {
  // `DataTexture` is typed against a view over a plain `ArrayBuffer`; a generated
  // buffer views `ArrayBufferLike` — the same bytes.
  const view = data as unknown as Uint8ClampedArray & { buffer: ArrayBuffer };
  const texture = new DataTexture(view, size, size, RGBAFormat, UnsignedByteType);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.generateMipmaps = true;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.magFilter = LinearFilter;
  texture.anisotropy = TEXTURE_ANISOTROPY;
  texture.colorSpace = kind === 'albedo' ? SRGBColorSpace : NoColorSpace;
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

/** The one `MeshStandardMaterial` every mesh of this material shares (FR-010,
 * US3-S8); roughness and metalness stay at their defaults so US2's map is what
 * varies the surface. */
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

/** Textures and materials uploaded, what they weigh, whether each material holds
 * one map set (US3-S8), and the sampling state they carry (US3-S10). */
export interface TextureCacheStats {
  readonly textures: number;
  readonly materials: number;
  readonly bytes: number;
  readonly oneSetPerMaterial: boolean;
  readonly minAnisotropy: number;
  readonly allMipmapped: boolean;
  readonly allRepeatWrapped: boolean;
}

/** What the cache holds — read from the textures rather than assumed. */
export function textureCacheStats(): TextureCacheStats {
  let bytes = 0;
  let minAnisotropy = Infinity;
  let allMipmapped = true;
  let allRepeatWrapped = true;
  for (const texture of textures.values()) {
    bytes += texture.image.width * texture.image.height * RGBA_CHANNELS;
    minAnisotropy = Math.min(minAnisotropy, texture.anisotropy);
    allMipmapped &&= texture.generateMipmaps && texture.minFilter === LinearMipmapLinearFilter;
    allRepeatWrapped &&= texture.wrapS === RepeatWrapping && texture.wrapT === RepeatWrapping;
  }
  return {
    textures: textures.size,
    materials: materials.size,
    bytes,
    oneSetPerMaterial: textures.size === materials.size * MAPS_PER_MATERIAL,
    minAnisotropy: textures.size === 0 ? 0 : minAnisotropy,
    allMipmapped,
    allRepeatWrapped,
  };
}
