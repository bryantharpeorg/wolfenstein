// The one place in src/materials/ that three.js is allowed (FR-011). It wraps
// the finished Uint8ClampedArray buffers from maps.ts into DataTextures, builds
// one MeshStandardMaterial per material name, and shares that material across
// every mesh that uses it — so five materials upload one set of maps each, not
// one set per mesh (FR-010, US3-S8).

import {
  DataTexture,
  LinearFilter,
  LinearMipmapNearestFilter,
  MeshStandardMaterial,
  RepeatWrapping,
  RGBAFormat,
  UnsignedByteType,
  SRGBColorSpace,
  LinearSRGBColorSpace,
} from 'three';
import type { Material } from 'three';
import type { MaterialMapSet } from './maps';
import { MATERIAL_NAMES, type MaterialName } from './table';

/** Mipmaps on, with a declared anisotropy level for grazing angles (US4-S5).
 * Eight is the level every desktop backend this project targets supports, and
 * it is the number the smoke harness asserts is in effect — a texture that
 * reports a lower one has been clamped by the driver. */
export const MATERIAL_ANISOTROPY = 8;

/** The declared minification filter: bilinear within one mipmap level, nearest
 * level selection, with anisotropy layered on top.
 *
 * Trilinear (`LinearMipmapLinearFilter`) would blend the two bracketing levels
 * as well, and on hardware it is the obvious default. It is not the default
 * here because the two settings multiply: trilinear doubles the probes an
 * anisotropic sample takes, and at anisotropy 8 across three maps on five
 * materials that is up to sixteen texel fetches per sample on a rasterizer with
 * no texture units. Measured on the smoke harness's software renderer pinned to
 * two cores, over the same scene: 33ms/frame untextured-filtering (nearest),
 * 48ms with this filter at anisotropy 8, and 167ms with trilinear at
 * anisotropy 8 — a fifth of the frame rate, under 001's floor, for a level of
 * mip-transition smoothness no acceptance scenario asks for.
 *
 * What US4-S5 does ask for survives intact: the chain is built and sampled, and
 * anisotropy 8 is honoured — a driver's anisotropic path takes its probes
 * within the selected level, so grazing angles stay sharp rather than aliasing
 * into noise. What is given up is the cross-fade at a mip boundary. See
 * DECISIONS.md. */
export const MATERIAL_MIN_FILTER = LinearMipmapNearestFilter;

/** Three.js material + its backing textures, so a resize or re-bind can reason
 * about what is already uploaded. */
export interface AdaptedMaterial {
  readonly name: MaterialName;
  readonly material: MeshStandardMaterial;
  readonly albedo: DataTexture;
  readonly normal: DataTexture;
  readonly roughness: DataTexture;
}

function makeDataTexture(
  buffer: Uint8ClampedArray,
  size: number,
  colorSpace: 'srgb' | 'linear-srgb',
): DataTexture {
  // DataTexture's constructor accepts ArrayBufferView; three.js types demand
  // ArrayBuffer specifically. The runtime buffer is an ordinary Uint8ClampedArray
  // whose backing store is a normal ArrayBuffer.
  const texture = new DataTexture(
    new Uint8Array(buffer.buffer as ArrayBuffer, buffer.byteOffset, buffer.byteLength),
    size,
    size,
    RGBAFormat,
    UnsignedByteType,
  );
  texture.colorSpace = colorSpace === 'srgb' ? SRGBColorSpace : LinearSRGBColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.mipmaps = [];
  texture.generateMipmaps = true;
  // A DataTexture defaults to NearestFilter on both filters, and a nearest
  // minification filter never samples a mipmap and ignores anisotropy outright
  // — so `generateMipmaps = true` alone leaves a grazing-angle wall aliasing
  // into noise with the mipmap chain built and unused (US4-S5).
  texture.minFilter = MATERIAL_MIN_FILTER;
  texture.magFilter = LinearFilter;
  texture.anisotropy = MATERIAL_ANISOTROPY;
  texture.needsUpdate = true;
  return texture;
}

const materialCache = new Map<MaterialName, AdaptedMaterial>();

/**
 * Builds or returns the one MeshStandardMaterial for `name`. The same material
 * instance is handed to every mesh using that name, keeping texture uploads at
 * exactly one set per material (FR-010, FR-011, US3-S8).
 */
export function adaptMaterial(maps: MaterialMapSet): AdaptedMaterial {
  const cached = materialCache.get(maps.name);
  if (cached != null) return cached;

  const albedo = makeDataTexture(maps.albedo, maps.size, 'srgb');
  const normal = makeDataTexture(maps.normal, maps.size, 'linear-srgb');
  const roughness = makeDataTexture(maps.roughness, maps.size, 'linear-srgb');

  const material = new MeshStandardMaterial({
    map: albedo,
    normalMap: normal,
    roughnessMap: roughness,
    roughness: 1,
    metalness: 0,
  });

  // Names the material after its table entry, so a mesh's binding is legible in
  // a scene walk and in the devtools inspector rather than anonymous.
  material.name = maps.name;

  const adapted: AdaptedMaterial = { name: maps.name, material, albedo, normal, roughness };
  materialCache.set(maps.name, adapted);
  return adapted;
}

/**
 * Replaces the three maps hanging off an already-adapted material in place. The
 * scene graph holds the *material*, never the texture, so the sharper set
 * reaches every mesh at once without a re-bind; the superseded textures are
 * disposed, so one set per material stays resident rather than two (FR-011,
 * US4-S3, US4-S6).
 */
export function upgradeMaterialMaps(maps: MaterialMapSet): AdaptedMaterial {
  const cached = materialCache.get(maps.name);
  if (cached == null) {
    throw new Error(`upgradeMaterialMaps: ${maps.name} was never adapted`);
  }

  const albedo = makeDataTexture(maps.albedo, maps.size, 'srgb');
  const normal = makeDataTexture(maps.normal, maps.size, 'linear-srgb');
  const roughness = makeDataTexture(maps.roughness, maps.size, 'linear-srgb');

  const { material } = cached;
  material.map = albedo;
  material.normalMap = normal;
  material.roughnessMap = roughness;
  material.needsUpdate = true;

  cached.albedo.dispose();
  cached.normal.dispose();
  cached.roughness.dispose();

  const upgraded: AdaptedMaterial = { name: maps.name, material, albedo, normal, roughness };
  materialCache.set(maps.name, upgraded);
  return upgraded;
}

/** Every adapted material currently in the cache, in declaration order. */
export function adaptedMaterials(): AdaptedMaterial[] {
  return MATERIAL_NAMES.map((name) => materialCache.get(name)).filter((entry): entry is AdaptedMaterial => entry != null);
}

/** Test seam: drop the cache so tests get a fresh adapter. */
export function resetMaterialCache(): void {
  materialCache.clear();
}

/** Whether a material has a usable albedo map. Takes the base `Material` so a
 * scene walk can ask it of anything it finds, not just the ones we built. */
export function hasAlbedoMap(material: Material): boolean {
  return (material as { map?: unknown }).map != null;
}
