// Refusal gates, mirroring `src/boot/registry.ts` (FR-006, FR-015). A gate is
// asked before a door opens and again before it closes, returning a declared
// outcome to refuse or null to allow. US2's lock check and the render layer's
// crush gate both register from their own files, so `door.ts` is written once.

import type { InteractOutcome } from './outcomes';
import type { Door } from './door';

/** `interact` is a player command against a closed door; `close` is the machine
 * deciding whether the leaf may travel shut. */
export type DoorGatePhase = 'interact' | 'close';

export interface DoorGateQuery {
  readonly door: Door;
  readonly phase: DoorGatePhase;
}

export type DoorGate = (query: DoorGateQuery) => InteractOutcome | null;

const gates: DoorGate[] = [];

export function registerDoorGate(gate: DoorGate): void {
  gates.push(gate);
}

export function collectDoorGates(): readonly DoorGate[] {
  return gates;
}

/** The first refusal, or null when every gate allows. Kept here rather than in
 * `door.ts` so the iteration order has one owner. */
export function firstRefusal(door: Door, phase: DoorGatePhase): InteractOutcome | null {
  for (const gate of gates) {
    const outcome = gate({ door, phase });
    if (outcome != null) return outcome;
  }
  return null;
}

export function resetDoorGatesForTest(): void {
  gates.length = 0;
}
