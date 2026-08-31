// One material's complete map set: `{albedo, normal, roughness, height}`, all
// three maps at the declared size and on one grid, so a single UV addresses all
// of them with no sampling offset (FR-005, FR-006, US2-S6).
//
// The degradation FR-007 declares lives here too. A normal or roughness
// derivation that cannot be completed does not stall the build and does not
// leave a surface bare: that material ships with a flat normal or the declared
// constant roughness, still carries its albedo, and the fact is recorded once
// in `__diag.materials.fallbacks` and once in `DECISIONS.md` (US2-S7).
//
// Pure: no three.js, no DOM. `texture-adapter.ts` is US3's, and is the one
// place a buffer meets a renderer.

import { RGBA_CHANNELS, TEXTURE_SIZE } from './constants';
import {
  beginMaterialBuild,
  materialDiagnostics,
  recordFallback,
  recordMapSetCost,
  recordMaterialMaps,
} from './diagnostics';
import type { MaterialDiagnostics } from './diagnostics';
import { generateAlbedo, generationStats } from './generate';
import { deriveNormalMap, flatNormalMap } from './normal';
import { FALLBACK_ROUGHNESS, constantRoughnessMap, deriveRoughnessMap } from './roughness';
import { MATERIAL_NAMES, MATERIAL_TABLE } from './table';
import type { MaterialName, RoughnessRange } from './table';

/** Albedo, normal and roughness — the three maps whose bytes US2-S8 counts.
 * The height field is not among them: it is the input the other two are derived
 * from and it never reaches the GPU. */
export const MAPS_PER_MATERIAL = 3;

export interface MaterialMaps {
  readonly name: MaterialName;
  readonly size: number;
  readonly albedo: Uint8ClampedArray;
  readonly normal: Uint8ClampedArray;
  readonly roughness: Uint8ClampedArray;
  /** The field the other two were derived from, kept for assertions; it is not
   * uploaded and is not counted in `bytes`. */
  readonly height: Float32Array;
  /** False when the flat-normal fallback was taken (FR-007). */
  readonly hasNormal: boolean;
  /** False when the constant-roughness fallback was taken (FR-007). */
  readonly hasRoughness: boolean;
}

/**
 * The two derivations, injectable. In production these are the real ones; a
 * test substitutes a throwing derivation to exercise FR-007's degradation
 * without having to corrupt a height field into failing.
 */
export interface MapDerivations {
  normal(height: Float32Array, size: number): Uint8ClampedArray;
  roughness(height: Float32Array, size: number, range: RoughnessRange): Uint8ClampedArray;
}

export const DEFAULT_DERIVATIONS: MapDerivations = {
  normal: (height, size) => deriveNormalMap(height, size),
  roughness: (height, size, range) => deriveRoughnessMap(height, size, range),
};

/** Texture memory for `mapCount` RGBA maps at one edge length (US2-S8). */
export function mapBytes(size: number, mapCount: number): number {
  return size * size * RGBA_CHANNELS * mapCount;
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * One material's three maps. The normal and the roughness are derived from that
 * material's own height field — never from the luminance of its albedo (FR-005)
 * — and every buffer returned is `size * size` RGBA texels on the same grid.
 */
export function buildMaterialMaps(
  name: MaterialName,
  size: number = TEXTURE_SIZE,
  derivations: MapDerivations = DEFAULT_DERIVATIONS,
): MaterialMaps {
  const generated = generateAlbedo(name, size);
  const range = MATERIAL_TABLE[name].roughness;

  let normal: Uint8ClampedArray;
  let hasNormal = true;
  try {
    normal = derivations.normal(generated.height, size);
  } catch (error) {
    // A flat normal lights as if the surface were flat, which is a visible
    // degradation. A missing map would be a black wall, which is not allowed.
    normal = flatNormalMap(size);
    hasNormal = false;
    recordFallback({ material: name, map: 'normal', reason: reasonOf(error) });
  }

  let roughness: Uint8ClampedArray;
  let hasRoughness = true;
  try {
    roughness = derivations.roughness(generated.height, size, range);
  } catch (error) {
    roughness = constantRoughnessMap(size, FALLBACK_ROUGHNESS);
    hasRoughness = false;
    recordFallback({ material: name, map: 'roughness', reason: reasonOf(error) });
  }

  recordMaterialMaps({ name, hasNormal, hasRoughness });

  return {
    name,
    size,
    // The albedo is never conditional: whatever else degraded, the surface is
    // textured (FR-007).
    albedo: generated.albedo,
    normal,
    roughness,
    height: generated.height,
    hasNormal,
    hasRoughness,
  };
}

export interface MaterialMapSet {
  readonly size: number;
  readonly maps: Record<MaterialName, MaterialMaps>;
  /** The record published as `__diag.materials` (FR-015, US2-S8). */
  readonly diagnostics: MaterialDiagnostics;
}

/**
 * Every declared material's map set, plus the numbers US2-S8 wants reported:
 * what generation cost, how many maps exist, and how many bytes they are. A
 * resolution change moves `bytes` by a factor of four, which is a number in
 * diagnostics rather than a stutter someone has to notice.
 */
export function buildAllMaterialMaps(
  size: number = TEXTURE_SIZE,
  derivations: MapDerivations = DEFAULT_DERIVATIONS,
): MaterialMapSet {
  beginMaterialBuild();

  const maps = {} as Record<MaterialName, MaterialMaps>;
  for (const name of MATERIAL_NAMES) maps[name] = buildMaterialMaps(name, size, derivations);

  const textureCount = MATERIAL_NAMES.length * MAPS_PER_MATERIAL;
  recordMapSetCost(generationStats().generatedMs, textureCount, mapBytes(size, textureCount));

  return { size, maps, diagnostics: materialDiagnostics() };
}
