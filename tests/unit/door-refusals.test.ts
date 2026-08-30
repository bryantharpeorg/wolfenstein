import { describe, it, expect } from 'vitest';
import { createDoor, stepDoor, interactDoor, type Door } from '../../src/interaction/door';
import { DOOR_TRAVEL_MS, DOOR_DWELL_MS } from '../../src/interaction/params';
import { INTERACT_OUTCOMES } from '../../src/interaction/outcomes';

function advance(door: Door, totalMs: number, tickMs = 100): void {
  let remaining = totalMs;
  while (remaining > 1e-9) {
    const step = Math.min(tickMs, remaining);
    stepDoor(door, step);
    remaining -= step;
  }
}

function doorInState(state: 'opening' | 'open' | 'closing'): Door {
  const door = createDoor({ x: 2, z: 2, axis: 'x' });
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

describe('a moving door refuses the interact command (US1-S5, FR-003)', () => {
  it('reports blocked-moving while opening, leaving state and progress untouched', () => {
    const door = doorInState('opening');
    const before = door.progress;

    expect(interactDoor(door)).toBe('blocked-moving');
    expect(door.state).toBe('opening');
    expect(door.progress).toBe(before);
  });

  it('does not reverse or re-trigger a door that is opening', () => {
    const door = doorInState('opening');
    for (let i = 0; i < 100; i += 1) {
      expect(interactDoor(door)).toBe('blocked-moving');
    }
    advance(door, DOOR_TRAVEL_MS);
    expect(door.state).toBe('open');
    expect(door.progress).toBe(1);
  });
});

describe('a closing door refuses until it is closed (US1-S6, FR-003)', () => {
  it('reports refusing-closing and leaves state and progress untouched', () => {
    const door = doorInState('closing');
    advance(door, DOOR_TRAVEL_MS / 2);
    const before = door.progress;

    expect(door.state).toBe('closing');
    expect(interactDoor(door)).toBe('refusing-closing');
    expect(door.state).toBe('closing');
    expect(door.progress).toBe(before);
  });

  it('completes the close before any re-open is possible', () => {
    const door = doorInState('closing');
    // Spam interact throughout the close; none of it may re-open the door.
    for (let elapsed = 0; elapsed < DOOR_TRAVEL_MS; elapsed += 50) {
      expect(interactDoor(door)).toBe('refusing-closing');
      stepDoor(door, 50);
    }
    expect(door.state).toBe('closed');
    expect(door.progress).toBe(0);

    // Only now does it accept a command again.
    expect(interactDoor(door)).toBe('opened');
    expect(door.state).toBe('opening');
  });
});

describe('an open door resets its dwell (US1-S7, FR-004)', () => {
  it('reports opened-now and stays open', () => {
    const door = doorInState('open');
    expect(interactDoor(door)).toBe('opened-now');
    expect(door.state).toBe('open');
    expect(door.progress).toBe(1);
  });

  it('resets the dwell timer so the door does not close on the original schedule', () => {
    const door = doorInState('open');
    advance(door, DOOR_DWELL_MS - 100);
    expect(door.state).toBe('open');

    expect(interactDoor(door)).toBe('opened-now');

    // The original dwell would have expired 100 ms from here; the reset one does not.
    advance(door, DOOR_DWELL_MS - 100);
    expect(door.state).toBe('open');

    advance(door, 100);
    expect(door.state).toBe('closing');
  });
});

describe('every resolution is a declared outcome (FR-006)', () => {
  it('never returns an empty or undeclared result', () => {
    const states = ['closed', 'opening', 'open', 'closing'] as const;
    for (const state of states) {
      const door =
        state === 'closed' ? createDoor({ x: 2, z: 2, axis: 'x' }) : doorInState(state);
      const outcome = interactDoor(door);
      expect(outcome).toBeTruthy();
      expect(INTERACT_OUTCOMES).toContain(outcome);
    }
  });
});
