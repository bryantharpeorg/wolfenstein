// The one place in `src/materials/` where a generated buffer meets three.js.
// Everything upstream of this file is `Uint8ClampedArray` in and out, which is
// what makes a texture regression a hash diff under `npm run test` rather than
// an opinion about a screenshot (FR-001, US1-S1). Everything downstream is the
// renderer's business. `tests/unit/materials-purity.test.ts` asserts this file
// is the only exemption and that nothing else under `src/materials/` imports it.
//
// Two jobs: wrap a finished buffer as a `DataTexture` with the sampling FR-011
// declares (mipmaps, repeat wrapping, a declared anisotropy, the right colour
// space per map role), and hand out exactly one `MeshStandardMaterial` per
// material name so five materials upload five map sets rather than one per mesh
// (FR-010, US3-S8, US3-S10).

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
import { MAPS_PER_MATERIAL, buildAllMaterialMaps, type MaterialMapSet } from './maps';
import { MATERIAL_NAMES } from './table';
import type { MaterialName } from './table';

/**
 * The anisotropy every generated texture is uploaded with (FR-011, US3-S10). A
 * declared level rather than the driver's maximum: the longest corridor in 002's
 * level is 62 tiles, which four taps already resolve without aliasing into
 * noise, and the harness renders on a software rasterizer where every extra tap
 * is paid in full on every fragment.
 */
export const TEXTURE_ANISOTROPY = 4;

/** Which map a buffer is, which decides its colour space (FR-011). */
export type MapRole = 'albedo' | 'normal' | 'roughness';

/**
 * A finished buffer as a texture. Albedo is sRGB because it is colour; normal
 * and roughness are linear because they are numbers that happen to be stored in
 * colour channels, and decoding them through a transfer function would bend
 * every slope US2 derived.
 */
export function createMapTexture(
  data: Uint8ClampedArray,
  size: number,
  role: MapRole,
): DataTexture {
  // A view over the generator's own bytes, not a copy: the clamped array and the
  // unsigned one the uploader wants have the same layout, and copying five
  // full-resolution RGBA buffers to satisfy a type would be a megabyte apiece.
  const view = new Uint8Array(data.buffer as ArrayBuffer, data.byteOffset, data.length);
  const texture = new DataTexture(view, size, size, RGBAFormat, UnsignedByteType);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  // One repeat per world tile is carried by the UVs, not by a repeat factor:
  // src/materials/uv.ts already hands the sampler tile-space coordinates.
  texture.repeat.set(1, 1);
  texture.generateMipmaps = true;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.magFilter = LinearFilter;
  texture.anisotropy = TEXTURE_ANISOTROPY;
  texture.colorSpace = role === 'albedo' ? SRGBColorSpace : NoColorSpace;
  texture.name = `${role}`;
  texture.needsUpdate = true;
  return texture;
}

export interface MaterialTextures {
  readonly albedo: DataTexture;
  readonly normal: DataTexture;
  readonly roughness: DataTexture;
}

interface CacheEntry {
  readonly material: MeshStandardMaterial;
  readonly textures: MaterialTextures;
  readonly set: MaterialMapSet;
}

// The cache is module state, so the *page* has one entry per material name and
// every mesh that asks for `brick` is handed the same object. A second mesh
// costs no upload; a hundred meshes cost no upload (FR-010, US3-S8).
const cache = new Map<MaterialName, CacheEntry>();
let sets: Record<MaterialName, MaterialMapSet> | null = null;

/** Builds every map set once, memoized. Later calls return the first build. */
export function ensureMaterialMaps(): Record<MaterialName, MaterialMapSet> {
  if (sets == null) sets = buildAllMaterialMaps();
  return sets;
}

function buildEntry(name: MaterialName): CacheEntry {
  const set = ensureMaterialMaps()[name];
  const textures: MaterialTextures = {
    albedo: createMapTexture(set.albedo, set.size, 'albedo'),
    normal: createMapTexture(set.normal, set.size, 'normal'),
    roughness: createMapTexture(set.roughness, set.size, 'roughness'),
  };
  for (const [role, texture] of Object.entries(textures)) {
    texture.name = `${name}:${role}`;
  }
  const material = new MeshStandardMaterial({
    name,
    map: textures.albedo,
    normalMap: textures.normal,
    roughnessMap: textures.roughness,
    // The maps carry the response; the scalars must not scale it away. Metalness
    // stays zero on every material, steel included: this scene has no
    // environment map, and a metallic surface with nothing to reflect renders
    // black. Steel reads as steel through its roughness band instead.
    roughness: 1,
    metalness: 0,
  });
  return { material, textures, set };
}

/**
 * The one `MeshStandardMaterial` this page has for that name (FR-010, US3-S8).
 * Every wall run, door, floor and ceiling bound to `brick` is handed this exact
 * object, so the five materials are five uploads however many meshes use them.
 */
export function materialFor(name: MaterialName): MeshStandardMaterial {
  let entry = cache.get(name);
  if (entry == null) {
    entry = buildEntry(name);
    cache.set(name, entry);
  }
  return entry.material;
}

/** All five, built. Callers that texture a whole level want this, not five calls. */
export function sharedMaterials(): Record<MaterialName, MeshStandardMaterial> {
  const built = {} as Record<MaterialName, MeshStandardMaterial>;
  for (const name of MATERIAL_NAMES) built[name] = materialFor(name);
  return built;
}

export interface TextureSurvey {
  /** Materials built so far — five once the level is textured. */
  readonly materials: number;
  /** Distinct `DataTexture` objects uploaded across them. */
  readonly textures: number;
  /** Maps per material: three, and the same three for every mesh using it. */
  readonly mapsPerMaterial: number;
  /** Every texture's name, `<material>:<role>`, so a duplicate is nameable. */
  readonly names: string[];
}

/**
 * What was actually uploaded, counted off the cache rather than assumed — the
 * runtime half of US3-S8, read back through the materials system's probe.
 */
export function textureSurvey(): TextureSurvey {
  const distinct = new Set<DataTexture>();
  const names: string[] = [];
  for (const entry of cache.values()) {
    for (const texture of [entry.textures.albedo, entry.textures.normal, entry.textures.roughness]) {
      distinct.add(texture);
      names.push(texture.name);
    }
  }
  return {
    materials: cache.size,
    textures: distinct.size,
    mapsPerMaterial: MAPS_PER_MATERIAL,
    names: names.sort(),
  };
}

/** Every texture built so far, in cache order. The materials system hands these
 *  to the renderer at load time so the first rendered frame does not pay for
 *  fifteen uploads and their mip chains (US3-S11). */
export function builtTextures(): DataTexture[] {
  const all: DataTexture[] = [];
  for (const entry of cache.values()) {
    all.push(entry.textures.albedo, entry.textures.normal, entry.textures.roughness);
  }
  return all;
}

/** Test seam only. The page builds its materials once and never disposes them. */
export function disposeSharedMaterials(): void {
  for (const entry of cache.values()) {
    entry.textures.albedo.dispose();
    entry.textures.normal.dispose();
    entry.textures.roughness.dispose();
    entry.material.dispose();
  }
  cache.clear();
  sets = null;
}
