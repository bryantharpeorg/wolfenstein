// Shared stepping helpers: a door is advanced the way a frame loop would, in
// ticks of a stated size, so a test names a wall-clock duration rather than a
// frame count. Not a test file — vitest collects only `*.test.ts`.

import { createDoor, stepDoor, interactDoor, type Door } from '../../src/interaction/door';
import { DOOR_TRAVEL_MS, DOOR_DWELL_MS } from '../../src/interaction/params';

export interface Capsule {
  x: number;
  z: number;
  radius: number;
}

export function advance(door: Door, totalMs: number, tickMs = 100, player?: Capsule): void {
  let remaining = totalMs;
  while (remaining > 1e-9) {
    const step = Math.min(tickMs, remaining);
    stepDoor(door, step, player == null ? {} : { player });
    remaining -= step;
  }
}

/** A door driven into `state` by elapsed time alone — no state is ever assigned. */
export function doorInState(
  state: 'closed' | 'opening' | 'open' | 'closing',
  x = 2,
  z = 2,
  axis: 'x' | 'z' = 'x',
): Door {
  const door = createDoor({ x, z, axis, direction: 1 });
  if (state === 'closed') return door;
  interactDoor(door);
  if (state === 'opening') {
    advance(door, DOOR_TRAVEL_MS / 2);
    return door;
  }
  advance(door, DOOR_TRAVEL_MS);
  if (state === 'open') return door;
  advance(door, DOOR_DWELL_MS);
  return door;
}
