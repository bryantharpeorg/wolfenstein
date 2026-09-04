// The `window.__diag.crosshair` shape (FR-005, US1-S6), attached to 001's
// Diagnostics by module augmentation rather than by editing `src/diag/diag.ts`
// — the same shape `src/combat/combat-diag.ts` established, additive over the
// whole 001–009 contract: no existing field is renamed, removed or repurposed,
// and the fields this story does not yet write are declared now so later
// stories extend this file instead of the shared diagnostics.
//
// Pure: no `three`, no DOM. The system publishes it; the tests and the smoke
// harness read it.

import type { Diagnostics } from '../diag/diag';
import type { FeedbackMarkKind } from './crosshair-feedback';

/** Every field FR-005 requires and the harness checks for, tagged with the
 *  story that gives it meaning. */
export interface CrosshairDiagnostics {
  /** The current gap, in pixels, between the reticle's arms. */
  gap: number; // US1: resting gap derived from the weapon's spread
  /** Whether the reticle is currently drawn at all. */
  hidden: boolean; // US1: false while the reticle is on screen
  /** Whether every source the reticle reads — the weapon table's spread and the
   *  diagnostics it publishes from — was defined on the last frame. */
  sourcesDefined: boolean; // US1
  /** Declared length in pixels of each arm beyond the gap. */
  armLengthPx: number; // US1
  /** The render order the reticle's quad composites at. */
  renderOrder: number; // US1
  /** Where the quad's centre lands on screen, in pixels, from the last resize. */
  centreXPx: number; // US1
  centreYPx: number; // US1
  /** Screen pixels the reticle's canvas covers, edge to edge. */
  spanPx: number; // US1
  /** How many times the stroke set has been recomputed and re-drawn. */
  composites: number; // US1
  /** The mark the reticle is currently showing: none, hit or kill (US3). */
  mark: FeedbackMarkKind; // US3
}

/** One list for the smoke harness to check the published object against. */
export const CROSSHAIR_DIAGNOSTIC_FIELDS = [
  'gap', 'hidden', 'sourcesDefined', 'armLengthPx', 'renderOrder',
  'centreXPx', 'centreYPx', 'spanPx', 'composites', 'mark',
] as const satisfies readonly (keyof CrosshairDiagnostics)[];

declare module '../diag/diag' {
  interface Diagnostics {
    crosshair?: CrosshairDiagnostics;
  }
}

export function createCrosshairDiagnostics(): CrosshairDiagnostics {
  return {
    gap: 0,
    hidden: false,
    sourcesDefined: false,
    armLengthPx: 0,
    renderOrder: 0,
    centreXPx: 0,
    centreYPx: 0,
    spanPx: 0,
    composites: 0,
    mark: 'none',
  };
}

/** Idempotent, so this and later stories may each ensure it without resetting
 *  the fields another published. */
export function ensureCrosshairDiag(diag: Diagnostics): CrosshairDiagnostics {
  diag.crosshair ??= createCrosshairDiagnostics();
  return diag.crosshair;
}