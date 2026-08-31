// [US2] The `__diag.run` shape (FR-008, US2-S7), attached to 001's `Diagnostics`
// by module augmentation from this file rather than by editing `src/diag/diag.ts` —
// the same seam `combat/combat-diag.ts` and `interaction/interaction-diag.ts` already
// use. FR-008, FR-014 and FR-018 add three objects from three stories of one spec, and
// three one-line additions to one shared interface is the contention the registry and
// this pattern both exist to avoid.
//
// The contract is additive over 001-007: this file declares `run` and touches no field
// any earlier spec declared, so nothing is renamed, removed or repurposed (US2-S7).
// Pure: no DOM, no three.js — the object is built here and the system writes into it.

import type { Diagnostics } from '../diag/diag';
import { ratingBandFor } from './rating';
import type { RunState } from './state';
import type { RunStats } from './stats';

/** Every field FR-008 lists, each named for the counter it reports. Only `state`,
 *  `elapsedMs`, `rating` and `completions` are this spec's; the rest are read from
 *  `__diag.combat`, `__diag.interaction` and the guard roster and copied, never
 *  recomputed (FR-006). */
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

/** One list for the smoke harness to check the published object against, in the
 *  shape `COMBAT_DIAGNOSTIC_FIELDS` established. */
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
    // The band a run that has taken nothing selects, so the field is never null and a
    // harness reading it before the first completion reads a rating rather than a hole.
    rating: ratingBandFor(0).name,
    completions: 0,
  };
}

/** Idempotent, so a second reader may ensure it without clearing the first's writes. */
export function ensureRunDiag(diag: Diagnostics): RunDiagnostics {
  diag.run ??= createRunDiagnostics();
  return diag.run;
}

/**
 * Copies one frame's projection into the published object (FR-006, FR-008).
 *
 * Field for field from the `RunStats` the screen is drawn from, so the displayed
 * values and the reported values have one source and cannot drift: there is no path
 * by which `__diag.run.kills` and the "5/8" on the canvas come from different reads.
 */
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
