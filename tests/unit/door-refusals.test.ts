import { describe, it, expect } from 'vitest';
import { createDoor, stepDoor, interactDoor } from '../../src/interaction/door';
import { DOOR_TRAVEL_MS, DOOR_DWELL_MS } from '../../src/interaction/params';
import { INTERACT_OUTCOMES, isMovingRefusal } from '../../src/interaction/outcomes';
import { advance, doorInState } from './door-advance';

describe('a moving door refuses the interact command (US1-S5, FR-003)', () => {
  // S5 names both moving states and the refusal each one answers with:
  // `blocked-moving` when opening, `refusing-closing` when closing (S6).
  const NAMES = { opening: 'blocked-moving', closing: 'refusing-closing' } as const;

  for (const state of ['opening', 'closing'] as const) {
    it(`refuses a door in ${state} with ${NAMES[state]}, leaving it untouched`, () => {
      const door = doorInState(state);
      if (state === 'closing') advance(door, DOOR_TRAVEL_MS / 2);
      const before = door.progress;
      expect(door.state).toBe(state);

      const outcome = interactDoor(door);
      expect(outcome).toBe(NAMES[state]);
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
});

describe('a closing door refuses until it is closed (US1-S6, FR-003)', () => {
  it('completes the close before any re-open is possible', () => {
    const door = doorInState('closing');
    // Spam interact throughout the close; none of it may re-open the door.
    for (let elapsed = 0; elapsed < DOOR_TRAVEL_MS; elapsed += 50) {
      const before = door.progress;
      expect(interactDoor(door)).toBe('refusing-closing');
      expect(door.state).toBe('closing');
      expect(door.progress).toBe(before);
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
    for (const state of ['closed', 'opening', 'open', 'closing'] as const) {
      const outcome = interactDoor(doorInState(state));
      expect(outcome).toBeTruthy();
      expect(INTERACT_OUTCOMES).toContain(outcome);
    }
    expect(interactDoor(createDoor({ x: 0, z: 0, axis: 'x' }))).toBe('opened');
  });
});
