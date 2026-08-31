// The whole `__diag.materials` shape (FR-015), attached to 001's Diagnostics by
// TypeScript module augmentation rather than by editing `src/diag/diag.ts` —
// that file is 001's contract, and every later spec would otherwise queue up on
// adjacent lines of it. Nothing here is renamed, removed or repurposed from
// what 001 through 004 already publish; this is a new object beside them.
//
// US2 fills the map-set fields, US3 fills `untexturedMeshes` and US4 fills
// `lights` and `shadowsEnabled` — each through the writers below, so no story
// after this one has to reopen this file.
//
// Pure: no three.js, and no DOM. The `Diagnostics` object reaches this module
// as an argument; the boot system that owns the page globals hands it over.

import type { Diagnostics } from '../diag/diag';
import type { MaterialName } from './table';

/** Which of a material's derived maps degraded to its declared fallback. */
export type FallbackMap = 'normal' | 'roughness';

/** One recorded degradation — the line FR-007 wants in `DECISIONS.md` and the
 * entry it wants in `__diag.materials.fallbacks`. */
export interface MaterialFallback {
  readonly material: MaterialName;
  readonly map: FallbackMap;
  /** Why the derivation could not be completed, for the DECISIONS.md line. */
  readonly reason: string;
}

/** What one material shipped with, per US2-S7's reporting requirement. */
export interface MaterialMapReport {
  readonly name: MaterialName;
  readonly hasNormal: boolean;
  readonly hasRoughness: boolean;
}

export interface MaterialDiagnostics {
  /** Milliseconds spent generating albedo and height, from `generate.ts`. */
  generatedMs: number;
  /** How many maps were built across every material (US2-S8). */
  textureCount: number;
  /** Total texture memory from the declared size and channel count, so a
   * resolution change is visible as a number rather than as a stutter. */
  bytes: number;
  /** Meshes reached by no material — US3 writes it; zero is the passing value. */
  untexturedMeshes: number;
  /** Lights in the scene — US4 writes it. */
  lights: number;
  /** Whether the renderer's shadow map is on — US4 writes it. */
  shadowsEnabled: boolean;
  /** Every degradation FR-007 took, one entry per (material, map). */
  fallbacks: MaterialFallback[];
  materials: MaterialMapReport[];
}

declare module '../diag/diag' {
  interface Diagnostics {
    materials?: MaterialDiagnostics;
  }
}

export function createMaterialDiagnostics(): MaterialDiagnostics {
  return {
    generatedMs: 0,
    textureCount: 0,
    bytes: 0,
    untexturedMeshes: 0,
    lights: 0,
    shadowsEnabled: false,
    fallbacks: [],
    materials: [],
  };
}

// The accumulator. Materials are built once per page load (FR-004), so the
// record of that build is one module-level object rather than a value threaded
// through every call site that might want to record a degradation.
let current: MaterialDiagnostics = createMaterialDiagnostics();

/** The accumulated record, readable by anything that wants to assert on it. */
export function materialDiagnostics(): MaterialDiagnostics {
  return current;
}

/** Drops the accumulated record. The seam a test — or a reload — builds from a
 * known-empty state through. */
export function resetMaterialDiagnostics(): void {
  current = createMaterialDiagnostics();
}

/** Clears what one build owns — its fallbacks and its per-material list —
 * without discarding what US3 and US4 have already written. */
export function beginMaterialBuild(): void {
  current.fallbacks = [];
  current.materials = [];
}

/**
 * Records one degradation (FR-007). Idempotent per `(material, map)`: a retry
 * of the same failed derivation is the same one line, not two.
 */
export function recordFallback(fallback: MaterialFallback): void {
  const already = current.fallbacks.some(
    (entry) => entry.material === fallback.material && entry.map === fallback.map,
  );
  if (already) return;
  current.fallbacks.push({ ...fallback });
}

/** Records what one material shipped with, replacing any earlier entry. */
export function recordMaterialMaps(report: MaterialMapReport): void {
  const index = current.materials.findIndex((entry) => entry.name === report.name);
  const entry: MaterialMapReport = {
    name: report.name,
    hasNormal: report.hasNormal,
    hasRoughness: report.hasRoughness,
  };
  if (index === -1) current.materials.push(entry);
  else current.materials[index] = entry;
}

/** Records the cost of the map set (US2-S8), written by `buildAllMaterialMaps`. */
export function recordMapSetCost(generatedMs: number, textureCount: number, bytes: number): void {
  current.generatedMs = generatedMs;
  current.textureCount = textureCount;
  current.bytes = bytes;
}

/** How many meshes no material reached — US3's field, written through here so
 * US3 never reopens this file (FR-010). */
export function setUntexturedMeshes(count: number): void {
  current.untexturedMeshes = count;
}

/** The lighting rig's two facts — US4's fields, for the same reason. */
export function setLightingDiagnostics(lights: number, shadowsEnabled: boolean): void {
  current.lights = lights;
  current.shadowsEnabled = shadowsEnabled;
}

/**
 * Attaches the accumulated record to 001's diagnostics object — the one the
 * page publishes as `__diag`. Additive: every field 001 through 004 declared is
 * left exactly as it was (FR-015).
 */
export function publishMaterialDiagnostics(diag: Diagnostics): MaterialDiagnostics {
  diag.materials = current;
  return current;
}

/** One `DECISIONS.md` line per degradation, in the format that file already
 * uses. FR-007 asks for the line; this is the sentence it is made of. */
export function fallbackDecisionLine(date: string, fallback: MaterialFallback): string {
  return (
    `- ${date} | 005-materials | \`${fallback.material}\` shipped with the declared fallback ` +
    `${fallback.map} map: ${fallback.reason}. Its albedo is unaffected — an untextured ` +
    `surface is never an allowed outcome (FR-007).`
  );
}
