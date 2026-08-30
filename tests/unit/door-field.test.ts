import { describe, it, expect } from 'vitest';
import {
  buildDoorField,
  doorAt,
  findTargetDoor,
  interactWithDoors,
} from '../../src/interaction/door-field';
import { doorDestinationTile } from '../../src/interaction/door';
import { LEVEL_GRID, DOOR_LOCKS } from '../../src/level';

// Two `D` tiles side by side. Door A at (1,2) retracts west into the border;
// door B at (2,2) has no wall of its own, so its only destination is A's tile.
const ADJACENT_DOORS = ['111111', '100001', '1DD001', '100001', '111111'];

describe('door field construction (FR-016, US1-S9)', () => {
  it('builds one door per D tile of the shipped grid', () => {
    const field = buildDoorField(LEVEL_GRID, DOOR_LOCKS);
    const expected = LEVEL_GRID.join('').split('').filter((cell) => cell === 'D').length;
    expect(field.doors).toHaveLength(expected);
    expect(expected).toBeGreaterThan(0);
  });

  it('carries the lock kind declared by the level table', () => {
    const field = buildDoorField(LEVEL_GRID, DOOR_LOCKS);
    for (const door of field.doors) {
      expect(door.lock).toBe(DOOR_LOCKS[`${door.x},${door.z}`] ?? 'none');
    }
  });

  it('resolves each shipped door onto the axis of its two solid neighbours', () => {
    const field = buildDoorField(LEVEL_GRID, DOOR_LOCKS);
    const northSouth = doorAt(field, 21, 10);
    const eastWest = doorAt(field, 10, 21);

    expect(northSouth?.axis).toBe('z');
    expect(eastWest?.axis).toBe('x');
  });

  it('gives no two doors the same destination tile', () => {
    const field = buildDoorField(LEVEL_GRID, DOOR_LOCKS);
    const destinations = field.doors.map((door) => {
      const tile = doorDestinationTile(door);
      return `${tile.x},${tile.z}`;
    });
    expect(new Set(destinations).size).toBe(destinations.length);
  });

  it('resolves each door of an adjacent pair onto its own travel axis', () => {
    const field = buildDoorField(ADJACENT_DOORS);
    const a = doorAt(field, 1, 2);
    const b = doorAt(field, 2, 2);

    expect(a?.axis).toBe('x');
    expect(b?.axis).toBe('x');
    expect(doorDestinationTile(a!)).toEqual({ x: 0, z: 2 });
    expect(doorDestinationTile(b!)).toEqual({ x: 1, z: 2 });
  });
});

describe('adjacent doors refuse the second command (US1-S9, FR-016)', () => {
  it('opens the first and refuses the second with blocked-neighbour', () => {
    const field = buildDoorField(ADJACENT_DOORS);

    const first = interactWithDoors(field, 1.5, 1.5);
    expect(first.outcome).toBe('opened');
    expect(first.door).toBe(doorAt(field, 1, 2));

    const second = interactWithDoors(field, 2.5, 1.5);
    expect(second.outcome).toBe('blocked-neighbour');
    expect(second.door).toBe(doorAt(field, 2, 2));
    expect(doorAt(field, 2, 2)?.state).toBe('closed');
    expect(doorAt(field, 2, 2)?.progress).toBe(0);
  });

  it('refuses whichever of the pair is commanded second', () => {
    const field = buildDoorField(ADJACENT_DOORS);

    expect(interactWithDoors(field, 2.5, 1.5).outcome).toBe('opened');
    expect(interactWithDoors(field, 1.5, 1.5).outcome).toBe('blocked-neighbour');
    expect(doorAt(field, 1, 2)?.state).toBe('closed');
  });

  it('never lets two doors travel into the same tile at once', () => {
    const field = buildDoorField(ADJACENT_DOORS);
    interactWithDoors(field, 1.5, 1.5);
    interactWithDoors(field, 2.5, 1.5);

    const moving = field.doors.filter((door) => door.state !== 'closed');
    expect(moving).toHaveLength(1);
  });
});

describe('door targeting (FR-006)', () => {
  it('finds the door adjacent to the player', () => {
    const field = buildDoorField(LEVEL_GRID, DOOR_LOCKS);
    expect(findTargetDoor(field, 20.5, 10.5)).toBe(doorAt(field, 21, 10));
    expect(findTargetDoor(field, 22.5, 10.5)).toBe(doorAt(field, 21, 10));
    expect(findTargetDoor(field, 21.5, 10.5)).toBe(doorAt(field, 21, 10));
  });

  it('returns no-target when the player is nowhere near a door', () => {
    const field = buildDoorField(LEVEL_GRID, DOOR_LOCKS);
    expect(findTargetDoor(field, 5.5, 5.5)).toBeNull();

    const result = interactWithDoors(field, 5.5, 5.5);
    expect(result.outcome).toBe('no-target');
    expect(result.door).toBeNull();
  });
});
