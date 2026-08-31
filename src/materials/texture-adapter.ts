// The one place in `src/materials/` where a generated buffer meets three.js —
// the seam keeping a texture regression a hash diff rather than an opinion about
// a screenshot (FR-001, US1-S1), asserted by name in `materials-purity.test.ts`.
// Two jobs: wrap a buffer with the sampling FR-011 declares, and hand out one
// `MeshStandardMaterial` per name, so five materials upload five sets (US3-S8).

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
import { buildAllMaterialMaps, type MaterialMapSet } from './maps';
import { MATERIAL_NAMES } from './table';
import type { MaterialName } from './table';

/** The anisotropy every texture is uploaded with (FR-011, US3-S10): declared,
 *  not the driver's maximum, because four taps resolve the 62-tile corridor and
 *  the software harness pays every tap per fragment. */
export const TEXTURE_ANISOTROPY = 4;

/** Which map a buffer is, which decides its colour space (FR-011). */
export type MapRole = 'albedo' | 'normal' | 'roughness';

const ROLES: MapRole[] = ['albedo', 'normal', 'roughness'];

/** A finished buffer as a texture. Albedo is sRGB because it is colour; normal
 *  and roughness are linear numbers stored in colour channels, and a transfer
 *  function would bend every slope US2 derived. */
export function createMapTexture(data: Uint8ClampedArray, size: number, role: MapRole): DataTexture {
  // A view over the generator's own bytes: same layout, and copying five RGBA
  // buffers to satisfy a type would cost a megabyte apiece.
  const view = new Uint8Array(data.buffer as ArrayBuffer, data.byteOffset, data.length);
  const texture = new DataTexture(view, size, size, RGBAFormat, UnsignedByteType);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  // One repeat per tile is carried by the UVs, not by a repeat factor.
  texture.repeat.set(1, 1);
  texture.generateMipmaps = true;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.magFilter = LinearFilter;
  texture.anisotropy = TEXTURE_ANISOTROPY;
  texture.colorSpace = role === 'albedo' ? SRGBColorSpace : NoColorSpace;
  texture.needsUpdate = true;
  return texture;
}

interface CacheEntry {
  readonly material: MeshStandardMaterial;
  readonly textures: Record<MapRole, DataTexture>;
}

// Module state, so the *page* has one entry per material name: a second mesh
// asking for `brick` costs no upload, and nor does a hundredth (FR-010, US3-S8).
const cache = new Map<MaterialName, CacheEntry>();
let sets: Record<MaterialName, MaterialMapSet> | null = null;

function buildEntry(name: MaterialName): CacheEntry {
  if (sets == null) sets = buildAllMaterialMaps();
  const set = sets[name];
  const textures = {} as Record<MapRole, DataTexture>;
  for (const role of ROLES) {
    textures[role] = createMapTexture(set[role], set.size, role);
    textures[role].name = `${name}:${role}`;
  }
  const material = new MeshStandardMaterial({
    name,
    map: textures.albedo,
    normalMap: textures.normal,
    roughnessMap: textures.roughness,
    // The maps carry the response, so the scalars must not scale it away, and
    // metalness stays zero even for steel: with no environment map, a metal
    // surface with nothing to reflect renders black.
    roughness: 1,
    metalness: 0,
  });
  return { material, textures };
}

/** The one `MeshStandardMaterial` this page has for that name: every surface
 *  bound to `brick` gets this object, so five materials are five uploads however
 *  many meshes wear them (FR-010, US3-S8). */
export function materialFor(name: MaterialName): MeshStandardMaterial {
  let entry = cache.get(name);
  if (entry == null) {
    entry = buildEntry(name);
    cache.set(name, entry);
  }
  return entry.material;
}

/** All five, built. Callers texturing a whole level want this, not five calls. */
export function sharedMaterials(): Record<MaterialName, MeshStandardMaterial> {
  const built = {} as Record<MaterialName, MeshStandardMaterial>;
  for (const name of MATERIAL_NAMES) built[name] = materialFor(name);
  return built;
}

/** One texture's sampling, read off the uploaded object, so US3-S10 is a fact
 *  about what the page holds rather than about what the source says. */
export interface TextureReport {
  readonly name: string;
  readonly role: MapRole;
  readonly size: number;
  readonly generateMipmaps: boolean;
  readonly minFilter: number;
  readonly anisotropy: number;
  readonly wrapS: number;
  readonly wrapT: number;
  readonly colorSpace: string;
}

/** Materials built, distinct textures across them, every `<material>:<role>`
 *  name so a duplicate is nameable, and the anisotropy, mipmap filter and
 *  wrapping in force — three's own constants, so the harness asserts against
 *  them without knowing the numbers (FR-011, US3-S8). */
export interface TextureSurvey {
  readonly materials: number;
  readonly textures: number;
  readonly names: string[];
  readonly anisotropy: number;
  readonly mipmapFilter: number;
  readonly repeatWrapping: number;
  readonly reports: TextureReport[];
}

/** What was uploaded, counted off the cache rather than assumed: US3-S8's
 *  runtime half, read back through the materials system's probe. */
export function textureSurvey(): TextureSurvey {
  const distinct = new Set<DataTexture>();
  const reports: TextureReport[] = [];
  for (const entry of cache.values()) {
    for (const role of ROLES) {
      const texture = entry.textures[role];
      distinct.add(texture);
      reports.push({
        name: texture.name,
        role,
        size: texture.image.width,
        generateMipmaps: texture.generateMipmaps,
        minFilter: texture.minFilter,
        anisotropy: texture.anisotropy,
        wrapS: texture.wrapS,
        wrapT: texture.wrapT,
        colorSpace: texture.colorSpace,
      });
    }
  }
  return {
    materials: cache.size,
    textures: distinct.size,
    names: reports.map((report) => report.name).sort(),
    anisotropy: TEXTURE_ANISOTROPY,
    mipmapFilter: LinearMipmapLinearFilter,
    repeatWrapping: RepeatWrapping,
    reports,
  };
}

/** Handed to the renderer at load, so the first frame does not pay for fifteen
 *  mip chains (US3-S11). */
export function builtTextures(): DataTexture[] {
  return [...cache.values()].flatMap((entry) => ROLES.map((role) => entry.textures[role]));
}
