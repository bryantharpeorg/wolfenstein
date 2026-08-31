// The one file in `src/materials/` that knows a renderer exists (FR-011): a
// finished buffer goes in, a `DataTexture` comes out, and one
// `MeshStandardMaterial` per material name is shared by every mesh wearing it
// (FR-010, US3-S8). It imports no DOM API, so it still loads under vitest.

import {
  type ColorSpace,
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  LinearSRGBColorSpace,
  MeshStandardMaterial,
  RGBAFormat,
  RepeatWrapping,
  SRGBColorSpace,
  UnsignedByteType,
} from 'three';
import { buildMaterialMaps, type MaterialMapSet } from './maps';
import { TEXTURE_SIZE } from './constants';
import type { MaterialName } from './table';

/** The declared anisotropy (FR-011, US3-S10): enough that the level's longest
 * corridor does not alias at a grazing angle, and inside every WebGL2 and
 * WebGPU minimum — the renderer clamps to its own maximum. */
export const TEXTURE_ANISOTROPY = 8;

type MapChannel = 'albedo' | 'normal' | 'roughness';

/** Albedo is authored in sRGB; a normal and a roughness are numbers, not
 * colours, and are sampled linearly or the shading is wrong (FR-011). */
const COLOUR_SPACES: Readonly<Record<MapChannel, ColorSpace>> = {
  albedo: SRGBColorSpace,
  normal: LinearSRGBColorSpace,
  roughness: LinearSRGBColorSpace,
};

export interface SharedMaterial {
  readonly name: MaterialName;
  /** The one material object every mesh of this name shares (FR-010). */
  readonly material: MeshStandardMaterial;
  /** Its three maps, in albedo/normal/roughness order (US3-S8). */
  readonly textures: readonly DataTexture[];
}

/** Repeat-wrapped so a UV past one tile keeps sampling, mipmapped and
 * anisotropic so a grazing view down a corridor resolves instead of shimmering
 * (US3-S10). The buffer is re-viewed, not copied — same bytes. */
function createMapTexture(
  buffer: Uint8ClampedArray,
  size: number,
  channel: MapChannel,
): DataTexture {
  const view = new Uint8Array(buffer.buffer as ArrayBuffer, buffer.byteOffset, buffer.byteLength);
  const texture = new DataTexture(view, size, size, RGBAFormat, UnsignedByteType);
  texture.name = channel;
  texture.colorSpace = COLOUR_SPACES[channel];
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.magFilter = LinearFilter;
  // Trilinear: a non-mip minification filter would silently discard the
  // mipmaps that are half of what stops the aliasing.
  texture.minFilter = LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = TEXTURE_ANISOTROPY;
  texture.needsUpdate = true;
  return texture;
}

// One entry per material name for the page's lifetime. This is where FR-010 is
// enforced: a second mesh of the same material gets this object, not a second
// upload of the same three maps.
const cache = new Map<MaterialName, SharedMaterial>();

/** The shared material for one name, built on first ask and returned by
 * identity after. `built` lets a caller that already assembled every set avoid
 * paying for the derivations twice. Roughness stays at 1 so US2's declared
 * bands, and only they, decide the response. */
export function sharedMaterial(
  name: MaterialName,
  size: number = TEXTURE_SIZE,
  built?: MaterialMapSet,
): SharedMaterial {
  const cached = cache.get(name);
  if (cached != null) return cached;

  const maps = built ?? buildMaterialMaps(name, size);
  const textures = (['albedo', 'normal', 'roughness'] as const).map((channel) =>
    createMapTexture(maps[channel], maps.size, channel),
  );
  const entry: SharedMaterial = {
    name,
    textures,
    material: new MeshStandardMaterial({
      name,
      map: textures[0],
      normalMap: textures[1],
      roughnessMap: textures[2],
      roughness: 1,
      metalness: 0,
    }),
  };
  cache.set(name, entry);
  return entry;
}
