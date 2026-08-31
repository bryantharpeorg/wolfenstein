// The whole `__diag.materials` shape (FR-015), attached to 001's Diagnostics by
// TypeScript module augmentation rather than by editing `src/diag/diag.ts` —
// that file is 001's contract, and every later spec would otherwise queue up on
// adjacent lines of it. US3 writes `untexturedMeshes` and US4 `lights` and
// `shadowsEnabled` through the setters below, so neither reopens this file.
import type { Diagnostics } from '../diag/diag';
import type { MaterialName } from './table';

export type FallbackMap = 'normal' | 'roughness';

/** One degradation: the `DECISIONS.md` line and the `fallbacks` entry FR-007
 * asks for, with why the derivation could not be completed. */
export interface MaterialFallback {
  readonly material: MaterialName;
  readonly map: FallbackMap;
  readonly reason: string;
}

/** What one material shipped with, per US2-S7's reporting requirement. */
export interface MaterialMapReport {
  readonly name: MaterialName;
  readonly hasNormal: boolean;
  readonly hasRoughness: boolean;
}

export interface MaterialDiagnostics {
  /** What generation cost, how many maps exist, and their total bytes, so a
   * resolution change is a number rather than a stutter (US2-S8). */
  generatedMs: number;
  textureCount: number;
  bytes: number;
  /** Meshes reached by no material — US3's field; zero is the passing value. */
  untexturedMeshes: number;
  /** The lighting rig's two facts — US4's fields. */
  lights: number;
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

// Materials are built once per page load (FR-004), so one build is one record:
// a module-level object, not a value threaded through every call site that
// might have a degradation to report.
let current: MaterialDiagnostics = createMaterialDiagnostics();

export const materialDiagnostics = (): MaterialDiagnostics => current;

/** Drops the record. The seam a test — or a reload — starts empty through. */
export function resetMaterialDiagnostics(): void {
  current = createMaterialDiagnostics();
}

/** Clears what one build owns, keeping what US3 and US4 have written. */
export function beginMaterialBuild(): void {
  current.fallbacks = [];
  current.materials = [];
}

/** Records one degradation (FR-007), idempotent per (material, map): a retry of
 * the same failed derivation is the same one line, not two. */
export function recordFallback(fallback: MaterialFallback): void {
  const seen = current.fallbacks.some(
    (e) => e.material === fallback.material && e.map === fallback.map,
  );
  if (!seen) current.fallbacks.push({ ...fallback });
}

/** Records what one material shipped with, replacing any earlier entry. */
export function recordMaterialMaps(report: MaterialMapReport): void {
  const at = current.materials.findIndex((e) => e.name === report.name);
  const entry: MaterialMapReport = {
    name: report.name,
    hasNormal: report.hasNormal,
    hasRoughness: report.hasRoughness,
  };
  if (at === -1) current.materials.push(entry);
  else current.materials[at] = entry;
}

/** The cost of the map set (US2-S8), written by `buildAllMaterialMaps`. */
export function recordMapSetCost(generatedMs: number, textureCount: number, bytes: number): void {
  current.generatedMs = generatedMs;
  current.textureCount = textureCount;
  current.bytes = bytes;
}

export function setUntexturedMeshes(count: number): void {
  current.untexturedMeshes = count;
}

export function setLightingDiagnostics(lights: number, shadowsEnabled: boolean): void {
  current.lights = lights;
  current.shadowsEnabled = shadowsEnabled;
}

/** Attaches the record to the object published as `__diag`. Additive: every
 * field 001 through 004 declared is left exactly as it was (FR-015). */
export function publishMaterialDiagnostics(diag: Diagnostics): MaterialDiagnostics {
  diag.materials = current;
  return current;
}

/** The one `DECISIONS.md` line a degradation is recorded as (FR-007). */
export function fallbackDecisionLine(date: string, fallback: MaterialFallback): string {
  return (
    `- ${date} | 005-materials | \`${fallback.material}\` shipped with the declared fallback ` +
    `${fallback.map} map: ${fallback.reason}. Its albedo is unaffected — an untextured ` +
    `surface is never an allowed outcome (FR-007).`
  );
}
