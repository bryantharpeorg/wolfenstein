// The lock decision (FR-009, FR-010): a door locked to a kind the player does not
// carry refuses by *naming that kind*, so the refusal reaches the HUD and `__diag`
// as a distinct reason rather than as a dead keypress. Pure: no DOM, no three.js,
// and no import of the door machine either — `lockGate` returns a function in the
// shape US1's gate registry expects, and the shape is structural, so neither file
// has to know the other.

import type { LockKind } from '../level';
import { hasKey, type KeyInventory, type KeyKind } from './keys';

export const LOCKED_MISSING_KEY = 'locked-missing-key';

/** Just enough of a door for the lock question: which kind it is locked to. */
export interface LockedDoorView {
  readonly x: number;
  readonly z: number;
  readonly lock: LockKind;
}

/** A gate is asked before a closed door opens, and again before it closes. A lock
 * has an opinion only about the first. */
export interface LockGateQuery {
  readonly door: LockedDoorView;
  readonly phase: string;
}

export interface LockRefusal {
  readonly outcome: typeof LOCKED_MISSING_KEY;
  /** The kind the player is missing — the whole point of the refusal (FR-009). */
  readonly missingKey: KeyKind;
  /** Always false: opening a locked door never spends the key (FR-010). */
  readonly keyConsumed: false;
}

/** Observer for a refusal, so the render layer can publish the named kind to
 * `__diag` without this module knowing that diagnostics exist (US2-S8). */
export type LockRefusalObserver = (missingKey: KeyKind, keyConsumed: boolean) => void;

export type LockTable = Readonly<Record<string, LockKind>>;

const keyKindOf = (lock: LockKind): KeyKind | null =>
  lock === 'silver' || lock === 'gold' ? lock : null;

/** The level's lock table wins, falling back to the door's own lock. */
const lockOf = (locks: LockTable, door: LockedDoorView): LockKind =>
  locks[`${door.x},${door.z}`] ?? door.lock;

/** The kind a door demands, or null when it demands none. */
export function requiredKeyFor(locks: LockTable, door: LockedDoorView): KeyKind | null {
  return keyKindOf(lockOf(locks, door));
}

/** Null when the door may open; a refusal naming the missing kind otherwise. The
 * inventory is read and never written — a key opens its door as many times as the
 * player likes (FR-010, US2-S4). */
export function lockDecision(lock: LockKind, inventory: KeyInventory): LockRefusal | null {
  const required = keyKindOf(lock);
  if (required == null || hasKey(inventory, required)) return null;
  return { outcome: LOCKED_MISSING_KEY, missingKey: required, keyConsumed: false };
}

/** The gate the door machine asks before opening a closed door. `inventory` is
 * held by reference, so a key collected after registration counts immediately. */
export function lockGate(
  locks: LockTable,
  inventory: KeyInventory,
  onRefusal?: LockRefusalObserver,
): (query: LockGateQuery) => typeof LOCKED_MISSING_KEY | null {
  return (query) => {
    if (query.phase !== 'interact') return null;
    const refusal = lockDecision(lockOf(locks, query.door), inventory);
    if (refusal == null) return null;
    onRefusal?.(refusal.missingKey, refusal.keyConsumed);
    return refusal.outcome;
  };
}
