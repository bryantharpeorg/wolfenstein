// A material as the renderer wants it: albedo, normal, roughness and the height
// field they were all derived from, every map at the declared size and in one
// UV space, so no sampling offset can exist between a texel of albedo and the
// texel of normal that shades it (FR-005, FR-006, US2-S6).
//
// Derivation is injected rather than imported at the call site so the FR-007
// degradation is exercised by a test instead of discovered in a browser: a
// derivation that throws ships a flat normal and the declared constant
// roughness, still applies the albedo, and records the reason (US2-S7).

import { RGBA_CHANNELS, TEXTURE_SIZE } from './constants';
import { generateAlbedo } from './generate';
import { generationStats } from './generate';
import { deriveNormalMap, flatNormalMap } from './normal';
import { FALLBACK_ROUGHNESS, constantRoughnessMap, deriveRoughnessMap } from './roughness';
import { MATERIAL_NAMES, MATERIAL_TABLE } from './table';
import type { MaterialName, RoughnessRange } from './table';
import { materialDiagnostics, publishMaterialDiagnostics, recordFallback } from './diagnostics';
import type { MaterialMapKind, MaterialMapReport } from './diagnostics';

/** Albedo, normal and roughness: the three maps one material ships (US2-S8). */
export const MAPS_PER_MATERIAL = 3;

export interface MaterialMapSet {
  readonly name: MaterialName;
  readonly size: number;
  readonly albedo: Uint8ClampedArray;
  readonly normal: Uint8ClampedArray;
  readonly roughness: Uint8ClampedArray;
  /** The field both derived maps read, kept so a later story can re-derive. */
  readonly height: Float32Array;
  /** False where FR-007's flat normal was shipped instead of a derived one. */
  readonly hasNormal: boolean;
  readonly hasRoughness: boolean;
}

export interface MapDerivations {
  normal(height: Float32Array, size: number): Uint8ClampedArray;
  roughness(height: Float32Array, size: number, range: RoughnessRange): Uint8ClampedArray;
}

export const DEFAULT_DERIVATIONS: MapDerivations = {
  normal: (height, size) => deriveNormalMap(height, size),
  roughness: (height, size, range) => deriveRoughnessMap(height, size, range),
};

/** Texture memory from the declared size and channel count, so a resolution
 * change is visible as a number rather than as a stutter (US2-S8). */
export function textureBytes(size: number, mapCount: number): number {
  return size * size * RGBA_CHANNELS * mapCount;
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * One material's complete map set. A failure in either derivation degrades the
 * pair together — FR-007 declares one degraded state, a flat normal *and* the
 * constant roughness, so a half-derived surface never ships. The albedo is
 * untouched by either path: a surface with no albedo map is never an allowed
 * outcome.
 */
export function buildMaterialMaps(
  name: MaterialName,
  size: number = TEXTURE_SIZE,
  derivations: MapDerivations = DEFAULT_DERIVATIONS,
): MaterialMapSet {
  const { albedo, height } = generateAlbedo(name, size);
  const range = MATERIAL_TABLE[name].roughness;

  let failed: MaterialMapKind | null = null;
  let reason = '';

  let normal: Uint8ClampedArray;
  try {
    normal = derivations.normal(height, size);
  } catch (error) {
    failed = 'normal';
    reason = reasonOf(error);
    normal = flatNormalMap(size);
  }

  let roughness: Uint8ClampedArray;
  try {
    roughness = derivations.roughness(height, size, range);
  } catch (error) {
    if (failed == null) {
      failed = 'roughness';
      reason = reasonOf(error);
    }
    roughness = constantRoughnessMap(size, FALLBACK_ROUGHNESS);
  }

  if (failed != null) {
    // One degraded state, not two: whichever half failed, the material ships
    // the flat normal and the declared constant roughness together.
    recordFallback({ name, map: failed, reason });
    return {
      name,
      size,
      albedo,
      normal: flatNormalMap(size),
      roughness: constantRoughnessMap(size, FALLBACK_ROUGHNESS),
      height,
      hasNormal: false,
      hasRoughness: false,
    };
  }

  return { name, size, albedo, normal, roughness, height, hasNormal: true, hasRoughness: true };
}

/**
 * Every material's map set, with the cost of the whole build published: the
 * generation time US1 accumulated, how many maps exist, what they weigh, and
 * per material whether its two derived maps are real or degraded (US2-S8).
 */
export function buildAllMaterialMaps(
  size: number = TEXTURE_SIZE,
  derivations: MapDerivations = DEFAULT_DERIVATIONS,
): Record<MaterialName, MaterialMapSet> {
  const sets = {} as Record<MaterialName, MaterialMapSet>;
  const reports: MaterialMapReport[] = [];

  for (const name of MATERIAL_NAMES) {
    const set = buildMaterialMaps(name, size, derivations);
    sets[name] = set;
    reports.push({ name, hasNormal: set.hasNormal, hasRoughness: set.hasRoughness });
  }

  const textureCount = reports.length * MAPS_PER_MATERIAL;
  publishMaterialDiagnostics({
    generatedMs: generationStats().generatedMs,
    textureCount,
    bytes: textureBytes(size, textureCount),
    materials: reports,
  });

  return sets;
}

/** What the last build published — the numbers a smoke check reads (FR-015). */
export function materialMapStats(): ReturnType<typeof materialDiagnostics> {
  return materialDiagnostics();
}
