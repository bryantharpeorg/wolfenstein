// The `window.__diag.interaction` shape (FR-017), attached additively to the
// Diagnostics object 001 owns, by TypeScript module augmentation rather than by
// editing `src/diag/diag.ts` — the route 003 took for `__diag.player`, which
// leaves every field 001 and 002 declared untouched.
//
// The whole FR-017 field set is declared here, in the story that creates the
// file. `interaction` is one object with one shape: if US1 declared three fields
// and US3 added five, US3 would be editing US1's module, which is exactly the
// contention this layout exists to avoid. US2 and US3 populate fields through
// the setters below; neither reopens this contract.
//
// Pure: no DOM, no three.js. It describes the diagnostics object; it does not
// reach for one.

import type { Diagnostics } from '../diag/diag';
import type { InteractOutcome } from './outcomes';

/** The key kinds 002's door-lock table declares. US2 fills these counts. */
export type KeyKind = 'silver' | 'gold';

export type KeyCounts = Record<KeyKind, number>;

export interface InteractionDiagnostics {
  /** Every `D` tile in the level. */
  doorsTotal: number;
  /** How many of them are currently open. Always an integer (FR-018). */
  doorsOpen: number;
  /** Monotonic count of secrets pushed; never exceeds `secretsTotal` (US3). */
  secretsFound: number;
  secretsTotal: number;
  /** Key inventory counts per kind (US2). */
  keys: KeyCounts;
  /** The outcome of the most recent interact resolution; never an empty result. */
  lastReason: InteractOutcome | null;
  /** The key kind named by the most recent `locked-missing-key` refusal (US2). */
  lastRefusalKeyKind: KeyKind | null;
  /** Proof that keys are retained rather than spent (FR-010); US2 keeps it false. */
  keyConsumed: boolean;
}

declare module '../diag/diag' {
  interface Diagnostics {
    interaction?: InteractionDiagnostics;
  }
}

export function createInteractionDiagnostics(): InteractionDiagnostics {
  return {
    doorsTotal: 0,
    doorsOpen: 0,
    secretsFound: 0,
    secretsTotal: 0,
    keys: { silver: 0, gold: 0 },
    lastReason: null,
    lastRefusalKeyKind: null,
    keyConsumed: false,
  };
}

/**
 * Attaches `interaction` to the diagnostics object with the complete FR-017
 * shape zero-initialised, and returns it. Idempotent: a second call returns the
 * same object rather than replacing it, so three systems can each ensure it.
 */
export function ensureInteractionDiag(diag: Diagnostics): InteractionDiagnostics {
  if (diag.interaction == null) {
    diag.interaction = createInteractionDiagnostics();
  }
  return diag.interaction;
}

/**
 * Records one interact resolution (FR-006). `lastRefusalKeyKind` is set only by
 * a `locked-missing-key` refusal and cleared by every other outcome, so a stale
 * key name can never be read as the reason for a later refusal.
 */
export function recordOutcome(
  interaction: InteractionDiagnostics,
  outcome: InteractOutcome,
  keyKind: KeyKind | null = null,
): void {
  interaction.lastReason = outcome;
  interaction.lastRefusalKeyKind = outcome === 'locked-missing-key' ? keyKind : null;
}

export function setDoorCounts(
  interaction: InteractionDiagnostics,
  total: number,
  open: number,
): void {
  interaction.doorsTotal = total;
  interaction.doorsOpen = open;
}

export function setSecretCounts(
  interaction: InteractionDiagnostics,
  found: number,
  total: number,
): void {
  interaction.secretsFound = found;
  interaction.secretsTotal = total;
}

export function setKeyCounts(interaction: InteractionDiagnostics, counts: KeyCounts): void {
  interaction.keys = { silver: counts.silver, gold: counts.gold };
}

/** Records whether the last unlock spent a key. It never should (FR-010). */
export function setKeyConsumed(interaction: InteractionDiagnostics, consumed: boolean): void {
  interaction.keyConsumed = consumed;
}
