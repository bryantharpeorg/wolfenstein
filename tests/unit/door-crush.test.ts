import { describe, it, expect, beforeEach } from 'vitest';
import { createDoor, stepDoor, interactDoor, type Door } from '../../src/interaction/door';
import { doorWouldCrush, doorTravelVolume, createCrushGate } from '../../src/interaction/crush';
import { registerDoorGate, resetDoorGatesForTest } from '../../src/interaction/gate-registry';
import { DOOR_TRAVEL_MS, DOOR_DWELL_MS } from '../../src/interaction/params';

const RADIUS = 0.3;

type Capsule = { x: number; z: number; radius: number };

function advance(door: Door, totalMs: number, tickMs = 100, player?: Capsule): void {
  let remaining = totalMs;
  while (remaining > 1e-9) {
    const step = Math.min(tickMs, remaining);
    stepDoor(door, step, player == null ? {} : { player });
    remaining -= step;
  }
}

/** A door at tile (4,4) sliding north-to-south, already closing at half travel. */
function closingDoor(): Door {
  const door = createDoor({ x: 4, z: 4, axis: 'z', direction: 1 });
  interactDoor(door);
  advance(door, DOOR_TRAVEL_MS);
  advance(door, DOOR_DWELL_MS);
  expect(door.state).toBe('closing');
  advance(door, DOOR_TRAVEL_MS / 2);
  return door;
}

beforeEach(() => {
  resetDoorGatesForTest();
});

describe('the door travel volume (FR-015)', () => {
  it('covers the door tile and the part of the recess the leaf still fills', () => {
    const door = createDoor({ x: 4, z: 4, axis: 'z', direction: 1 });
    door.state = 'closing';
    door.progress = 0.5;

    const volume = doorTravelVolume(door);
    expect(volume.minX).toBeCloseTo(4, 12);
    expect(volume.maxX).toBeCloseTo(5, 12);
    expect(volume.minZ).toBeCloseTo(4, 12);
    expect(volume.maxZ).toBeCloseTo(5.5, 12);
  });
});

describe('crush detection against a player capsule of radius 0.3 (FR-015)', () => {
  it('reports intersection for a player standing in the doorway', () => {
    const door = closingDoor();
    expect(doorWouldCrush(door, 4.5, 4.5, RADIUS)).toBe(true);
  });

  it('reports intersection for a player clipping the doorway edge', () => {
    const door = closingDoor();
    expect(doorWouldCrush(door, 3.85, 4.5, RADIUS)).toBe(true);
  });

  it('reports no intersection for a player clear of the travel volume', () => {
    const door = closingDoor();
    expect(doorWouldCrush(door, 2.5, 4.5, RADIUS)).toBe(false);
    expect(doorWouldCrush(door, 4.5, 2.0, RADIUS)).toBe(false);
  });

  it('takes the position as arguments rather than reading a global', () => {
    const door = closingDoor();
    expect(doorWouldCrush(door, 4.5, 4.5, 0)).toBe(true);
    expect(doorWouldCrush(door, 6.5, 4.5, RADIUS)).toBe(false);
  });
});

describe('a closing door reverses rather than crushing the player (FR-015, Edge Cases)', () => {
  it('aborts the close, reverses to opening and reports crush-reversed', () => {
    const door = closingDoor();
    const progressBefore = door.progress;

    const result = stepDoor(door, 100, { player: { x: 4.5, z: 4.5, radius: RADIUS } });

    expect(result.outcomes).toContain('crush-reversed');
    expect(door.state).toBe('opening');
    expect(door.progress).toBeGreaterThan(progressBefore);
  });

  it('re-opens fully and never reaches closed while the player stands in it', () => {
    const door = closingDoor();
    const player = { x: 4.5, z: 4.5, radius: RADIUS };

    for (let i = 0; i < 200; i += 1) {
      stepDoor(door, 100, { player });
      expect(door.state).not.toBe('closed');
    }
    expect(door.state).toBe('open');
    expect(door.progress).toBe(1);
  });

  it('closes normally once the player has stepped clear', () => {
    const door = closingDoor();
    advance(door, DOOR_TRAVEL_MS, 50, { x: 9.5, z: 9.5, radius: RADIUS });
    expect(door.state).toBe('closed');
    expect(door.progress).toBe(0);
  });
});

describe('the crush gate registered by the render layer (FR-015)', () => {
  it('reverses a closing door through the gate registry', () => {
    let player: Capsule | null = { x: 4.5, z: 4.5, radius: RADIUS };
    const door = closingDoor();
    registerDoorGate(createCrushGate(() => player));

    const result = stepDoor(door, 100);
    expect(result.outcomes).toContain('crush-reversed');
    expect(door.state).toBe('opening');

    // Player leaves; the door is free to complete a later close.
    player = null;
    advance(door, DOOR_TRAVEL_MS);
    expect(door.state).toBe('open');
    advance(door, DOOR_DWELL_MS + DOOR_TRAVEL_MS);
    expect(door.state).toBe('closed');
  });

  it('leaves the interact command alone — it is a close-phase gate only', () => {
    registerDoorGate(createCrushGate(() => ({ x: 4.5, z: 4.5, radius: RADIUS })));
    const door = createDoor({ x: 4, z: 4, axis: 'z', direction: 1 });
    expect(interactDoor(door)).toBe('opened');
    expect(door.state).toBe('opening');
  });
});
