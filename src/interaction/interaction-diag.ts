// The `window.__diag.interaction` shape (FR-017), attached to 001's Diagnostics
// by module augmentation rather than by editing `src/diag/diag.ts`. The whole
// field set is declared here, so US2 and US3 write through the setters below
// rather than reopening this contract.

import type { Diagnostics } from '../diag/diag';
import type { InteractOutcome } from './outcomes';

export type KeyKind = 'silver' | 'gold';

export type KeyCounts = Record<KeyKind, number>;

export interface InteractionDiagnostics {
  doorsTotal: number;
  /** How many of them are currently open. Always an integer (FR-018). */
  doorsOpen: number;
  secretsFound: number;
  secretsTotal: number;
  keys: KeyCounts;
  lastReason: InteractOutcome | null;
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

/** Attaches the complete FR-017 shape, zero-initialised. Idempotent, so three
 * systems can each ensure it without overwriting the others. */
export function ensureInteractionDiag(diag: Diagnostics): InteractionDiagnostics {
  if (diag.interaction == null) {
    diag.interaction = createInteractionDiagnostics();
  }
  return diag.interaction;
}

/** Records one interact resolution (FR-006). `lastRefusalKeyKind` is set only by
 * a `locked-missing-key` refusal and cleared by every other outcome. */
export function recordOutcome(
  interaction: InteractionDiagnostics,
  outcome: InteractOutcome,
  keyKind: KeyKind | null = null,
): void {
  interaction.lastReason = outcome;
  interaction.lastRefusalKeyKind = outcome === 'locked-missing-key' ? keyKind : null;
}

export function setDoorCounts(interaction: InteractionDiagnostics, total: number, open: number): void {
  interaction.doorsTotal = total;
  interaction.doorsOpen = open;
}

export function setSecretCounts(interaction: InteractionDiagnostics, found: number, total: number): void {
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
