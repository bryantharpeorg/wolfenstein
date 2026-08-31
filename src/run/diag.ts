// [US2] The `__diag.run` shape (FR-008, US2-S7), attached to 001's `Diagnostics` by module
// augmentation from this file rather than by editing `src/diag/diag.ts` — the seam
// `combat-diag.ts` already uses, so three stories of one spec do not queue up in one shared
// interface. Additive: nothing 001-007 declared is renamed, removed or repurposed.

import type { Diagnostics } from '../diag/diag';
import { ratingBandFor } from './rating';
import type { RunState } from './state';
import type { RunStats } from './stats';

/** Every field FR-008 lists. Only `state`, `elapsedMs`, `rating` and `completions` are
 *  this spec's; the rest are copied from the counters that own them (FR-006). */
export interface RunDiagnostics {
  state: RunState;
  elapsedMs: number;
  kills: number;
  guardsTotal: number;
  secretsFound: number;
  secretsTotal: number;
  treasureFound: number;
  treasureTotal: number;
  score: number;
  rating: string;
  completions: number;
}

/** One list to check the published object against, as `COMBAT_DIAGNOSTIC_FIELDS` does. */
export const RUN_DIAGNOSTIC_FIELDS = [
  'state', 'elapsedMs', 'kills', 'guardsTotal', 'secretsFound', 'secretsTotal',
  'treasureFound', 'treasureTotal', 'score', 'rating', 'completions',
] as const satisfies readonly (keyof RunDiagnostics)[];

declare module '../diag/diag' {
  interface Diagnostics {
    run?: RunDiagnostics;
  }
}

export function createRunDiagnostics(): RunDiagnostics {
  return {
    state: 'playing',
    elapsedMs: 0,
    kills: 0,
    guardsTotal: 0,
    secretsFound: 0,
    secretsTotal: 0,
    treasureFound: 0,
    treasureTotal: 0,
    score: 0,
    // The band a run that has taken nothing selects, so a read before the first
    // completion is a rating rather than a hole.
    rating: ratingBandFor(0).name,
    completions: 0,
  };
}

/** Idempotent, so a second reader may ensure it without clearing the first's writes. */
export function ensureRunDiag(diag: Diagnostics): RunDiagnostics {
  diag.run ??= createRunDiagnostics();
  return diag.run;
}

/** Copies one frame's projection into the published object (FR-006, FR-008), field for
 *  field from the `RunStats` the screen is drawn from, so the two cannot drift. */
export function publishRunDiagnostics(
  run: RunDiagnostics,
  state: RunState,
  stats: RunStats,
  rating: string,
  completions: number,
): void {
  run.state = state;
  run.elapsedMs = stats.elapsedMs;
  run.kills = stats.kills;
  run.guardsTotal = stats.guardsTotal;
  run.secretsFound = stats.secretsFound;
  run.secretsTotal = stats.secretsTotal;
  run.treasureFound = stats.treasureFound;
  run.treasureTotal = stats.treasureTotal;
  run.score = stats.score;
  run.rating = rating;
  run.completions = completions;
}
