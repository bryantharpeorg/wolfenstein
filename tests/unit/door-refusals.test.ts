import { describe, it, expect } from 'vitest';
import { createDoor, stepDoor, interactDoor, type Door } from '../../src/interaction/door';
import { DOOR_TRAVEL_MS, DOOR_DWELL_MS } from '../../src/interaction/params';
import { INTERACT_OUTCOMES, isMovingRefusal } from '../../src/interaction/outcomes';

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
  // US1-S5 names both moving states, so both are asserted here: the refusal, and
  // the untouched state and progress. Which name the refusal carries is US1-S6's
  // subject and is asserted separately below.
  for (const state of ['opening', 'closing'] as const) {
    it(`refuses a door in ${state}, leaving state and progress untouched`, () => {
      const door = doorInState(state);
      if (state === 'closing') advance(door, DOOR_TRAVEL_MS / 2);
      const before = door.progress;
      expect(door.state).toBe(state);

      const outcome = interactDoor(door);
      expect(isMovingRefusal(outcome)).toBe(true);
      expect(door.state).toBe(state);
      expect(door.progress).toBe(before);
    });

    it(`does not reverse or re-trigger a door that is ${state}`, () => {
      const door = doorInState(state);
      const before = door.progress;
      for (let i = 0; i < 100; i += 1) {
        expect(isMovingRefusal(interactDoor(door))).toBe(true);
      }
      // Neither the progress nor the direction of travel moved under the spam.
      expect(door.progress).toBe(before);
      expect(door.state).toBe(state);
      advance(door, DOOR_TRAVEL_MS);
      expect(door.state).toBe(state === 'opening' ? 'open' : 'closed');
      expect(door.progress).toBe(state === 'opening' ? 1 : 0);
    });
  }

  it('names the opening case blocked-moving and the closing case refusing-closing', () => {
    expect(interactDoor(doorInState('opening'))).toBe('blocked-moving');
    expect(interactDoor(doorInState('closing'))).toBe('refusing-closing');
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
