// The `window.__diag.player` shape (FR-014), attached additively to the
// Diagnostics object 001 owns. The interface is extended by TypeScript module
// augmentation rather than by editing `src/diag/diag.ts`, so no field owned by
// 001 or 002 is renamed, removed or repurposed.

import type { Diagnostics } from '../diag/diag';

export interface PlayerDiagnostics {
  x: number;
  z: number;
  yaw: number;
  pitch: number;
  speed: number;
  sprinting: boolean;
  pointerLocked: boolean;
  stuck: boolean;
  bobOffset: number;
}

declare module '../diag/diag' {
  interface Diagnostics {
    player?: PlayerDiagnostics;
  }
}

export function createPlayerDiagnostics(): PlayerDiagnostics {
  return {
    x: 0,
    z: 0,
    yaw: 0,
    pitch: 0,
    speed: 0,
    sprinting: false,
    pointerLocked: false,
    stuck: false,
    bobOffset: 0,
  };
}

/**
 * Attaches `player` to the diagnostics object with the complete FR-014 shape
 * zero-initialised, and returns it. Idempotent: a second call returns the same
 * object rather than replacing it.
 */
export function ensurePlayerDiag(diag: Diagnostics): PlayerDiagnostics {
  if (diag.player == null) {
    diag.player = createPlayerDiagnostics();
  }
  return diag.player;
}
