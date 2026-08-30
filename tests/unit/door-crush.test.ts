import { describe, it, expect, beforeEach } from 'vitest';
import { createDoor, stepDoor, interactDoor } from '../../src/interaction/door';
import { doorWouldCrush, doorTravelVolume, createCrushGate } from '../../src/interaction/crush';
import { registerDoorGate, resetDoorGatesForTest } from '../../src/interaction/gate-registry';
import { DOOR_TRAVEL_MS, DOOR_DWELL_MS } from '../../src/interaction/params';
import { advance, doorInState, type Capsule } from './door-advance';

const RADIUS = 0.3;

/** A door at tile (4,4) sliding north-to-south, already closing at half travel. */
function closingDoor(): ReturnType<typeof createDoor> {
  const door = doorInState('closing', 4, 4, 'z');
  advance(door, DOOR_TRAVEL_MS / 2);
  return door;
}

beforeEach(resetDoorGatesForTest);

describe('the door travel volume (FR-015)', () => {
  it('covers the door tile and the part of the recess the leaf still fills', () => {
    const door = createDoor({ x: 4, z: 4, axis: 'z', direction: 1 });
    door.state = 'closing';
    door.progress = 0.5;

    expect(doorTravelVolume(door)).toEqual({ minX: 4, maxX: 5, minZ: 4, maxZ: 5.5 });
  });
});

describe('crush detection against a player capsule of radius 0.3 (FR-015)', () => {
  it('reports intersection for a player standing in the doorway', () => {
    expect(doorWouldCrush(closingDoor(), 4.5, 4.5, RADIUS)).toBe(true);
  });

  it('reports intersection for a player clipping the doorway edge', () => {
    expect(doorWouldCrush(closingDoor(), 3.85, 4.5, RADIUS)).toBe(true);
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
    const before = door.progress;

    const result = stepDoor(door, 100, { player: { x: 4.5, z: 4.5, radius: RADIUS } });

    expect(result.outcomes).toContain('crush-reversed');
    expect(door.state).toBe('opening');
    expect(door.progress).toBeGreaterThan(before);
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

    expect(stepDoor(door, 100).outcomes).toContain('crush-reversed');
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
