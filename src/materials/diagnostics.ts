// The `__diag.materials` shape (FR-015), attached to 001's Diagnostics object by
// TypeScript module augmentation rather than by editing `src/diag/diag.ts` — the
// file every other spec would otherwise queue up to extend. The whole field set
// is declared here once, so US3 and US4 write their own numbers through the
// setters below instead of reopening this contract.
//
// The state lives in this module, not on the diagnostics object, because the
// map set is built by pure code that has no renderer context to write into.
// `attachMaterialDiagnostics` hands the *same* object to the diagnostics
// record, so a later write is visible to whoever already read the field.

import type { Diagnostics } from '../diag/diag';
import type { MaterialName } from './table';

/** Which of a material's two derived maps could not be produced (FR-007). */
export type MaterialMapKind = 'normal' | 'roughness';

export interface MaterialFallback {
  readonly name: MaterialName;
  readonly map: MaterialMapKind;
  /** What went wrong, in one line, so the degradation is legible in the page. */
  readonly reason: string;
}

/** Per-material proof that the set is complete, or a named record that it is not. */
export interface MaterialMapReport {
  readonly name: MaterialName;
  readonly hasNormal: boolean;
  readonly hasRoughness: boolean;
}

export interface MaterialDiagnostics {
  /** Milliseconds spent generating the albedo and height fields (FR-004). */
  generatedMs: number;
  /** How many maps were built across every material (US2-S8). */
  textureCount: number;
  /** Texture memory from the declared size and channel count (US2-S8). */
  bytes: number;
  /** Meshes reaching the frame with no material bound. US3 writes it. */
  untexturedMeshes: number;
  /** Lights in the rig. US4 writes it. */
  lights: number;
  /** Whether the renderer's shadow map is on. US4 writes it. */
  shadowsEnabled: boolean;
  /** Every degradation taken, one entry per material and map (FR-007). */
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

let state: MaterialDiagnostics = createMaterialDiagnostics();

/** The live record. Reads see every write made so far, in any order. */
export function materialDiagnostics(): MaterialDiagnostics {
  return state;
}

/**
 * Merges a patch into the record — the one writer US3 and US4 use for their own
 * fields, so nobody has to reopen this module to add a number to the page.
 */
export function publishMaterialDiagnostics(patch: Partial<MaterialDiagnostics>): MaterialDiagnostics {
  Object.assign(state, patch);
  return state;
}

/**
 * Records one degradation (FR-007). Idempotent per `(name, map)`: rebuilding a
 * material that already failed does not grow the list a second time.
 */
export function recordFallback(fallback: MaterialFallback): void {
  const already = state.fallbacks.some(
    (entry) => entry.name === fallback.name && entry.map === fallback.map,
  );
  if (!already) state.fallbacks.push(fallback);
}

/** Publishes the record onto the diagnostics object, by reference. Idempotent. */
export function attachMaterialDiagnostics(diag: Diagnostics): MaterialDiagnostics {
  diag.materials = state;
  return state;
}

/** Drops every recorded number. For tests; the page never calls it. */
export function resetMaterialDiagnostics(): void {
  state = createMaterialDiagnostics();
}
