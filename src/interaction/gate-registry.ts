// Refusal gates for doors, mirroring `src/boot/registry.ts` (FR-006, FR-015).
//
// A gate is a function the door machine consults before it opens, and again
// before it closes. It returns a declared outcome to refuse, or null to allow.
// The point is the seam: a later story adds a refusal condition — US2's lock
// check — by registering from its own file, so `door.ts` is written once here
// and never reopened. The render layer registers the crush gate the same way,
// because the player's position lives on its side of the DOM line.
//
// Pure: no DOM, no three.js.

import type { InteractOutcome } from './outcomes';
import type { Door } from './door';

/**
 * When a gate is being asked. `interact` is a player command against a closed
 * door; `close` is the machine deciding whether the leaf may travel shut.
 */
export type DoorGatePhase = 'interact' | 'close';

export interface DoorGateQuery {
  readonly door: Door;
  readonly phase: DoorGatePhase;
}

/** Returns the outcome that refuses the door, or null to allow it through. */
export type DoorGate = (query: DoorGateQuery) => InteractOutcome | null;

const gates: DoorGate[] = [];

/** Register a refusal gate. Called for side effect from a system's setup. */
export function registerDoorGate(gate: DoorGate): void {
  gates.push(gate);
}

/** Every registered gate, in registration order. */
export function collectDoorGates(): readonly DoorGate[] {
  return gates;
}

/**
 * Asks every gate and returns the first refusal, or null when all allow. Kept
 * here rather than in `door.ts` so the iteration order has one owner.
 */
export function firstRefusal(door: Door, phase: DoorGatePhase): InteractOutcome | null {
  for (const gate of gates) {
    const outcome = gate({ door, phase });
    if (outcome != null) return outcome;
  }
  return null;
}

/** Test seam only. Production code never unregisters. */
export function resetDoorGatesForTest(): void {
  gates.length = 0;
}
