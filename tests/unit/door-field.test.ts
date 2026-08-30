import { describe, it, expect } from 'vitest';
import { buildDoorField, doorAt, findTargetDoor, interactWithDoors } from '../../src/interaction/door-field';
import { doorDestinationTile } from '../../src/interaction/door';
import { LEVEL_GRID, DOOR_LOCKS } from '../../src/level';
import { emitFaces } from '../../src/geometry/faces';
import { isDoorTileGeometry } from '../../src/systems/doors/doorway-mesh';

// Two `D` tiles side by side. Door A at (1,2) retracts west into the border;
// door B at (2,2) has no wall of its own, so its only destination is A's tile.
const ADJACENT_DOORS = ['111111', '100001', '1DD001', '100001', '111111'];

const shipped = (): ReturnType<typeof buildDoorField> => buildDoorField(LEVEL_GRID, DOOR_LOCKS);

describe('door field construction (FR-016, US1-S9)', () => {
  it('builds one door per D tile of the shipped grid, each with its declared lock', () => {
    const field = shipped();
    const expected = LEVEL_GRID.join('').split('').filter((cell) => cell === 'D').length;
    expect(field.doors).toHaveLength(expected);
    expect(expected).toBeGreaterThan(0);
    for (const door of field.doors) {
      expect(door.lock).toBe(DOOR_LOCKS[`${door.x},${door.z}`] ?? 'none');
    }
  });

  it('resolves each shipped door onto the axis of its two solid neighbours', () => {
    const field = shipped();
    expect(doorAt(field, 21, 10)?.axis).toBe('z');
    expect(doorAt(field, 10, 21)?.axis).toBe('x');
  });

  it('gives no two doors the same destination tile', () => {
    const destinations = shipped().doors.map((door) => {
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

    // Neither leaf ever travels into the other's tile.
    expect(field.doors.filter((door) => door.state !== 'closed')).toHaveLength(1);
  });

  it('refuses whichever of the pair is commanded second', () => {
    const field = buildDoorField(ADJACENT_DOORS);

    expect(interactWithDoors(field, 2.5, 1.5).outcome).toBe('opened');
    expect(interactWithDoors(field, 1.5, 1.5).outcome).toBe('blocked-neighbour');
    expect(doorAt(field, 1, 2)?.state).toBe('closed');
  });
});

describe('door targeting (FR-006)', () => {
  it('finds the door adjacent to the player', () => {
    const field = shipped();
    expect(findTargetDoor(field, 20.5, 10.5)).toBe(doorAt(field, 21, 10));
    expect(findTargetDoor(field, 22.5, 10.5)).toBe(doorAt(field, 21, 10));
    expect(findTargetDoor(field, 21.5, 10.5)).toBe(doorAt(field, 21, 10));
  });

  it('returns no-target when the player is nowhere near a door', () => {
    const field = shipped();
    expect(findTargetDoor(field, 5.5, 5.5)).toBeNull();

    const result = interactWithDoors(field, 5.5, 5.5);
    expect(result.outcome).toBe('no-target');
    expect(result.door).toBeNull();
  });
});

describe("recognising 002's door-tile geometry (T017)", () => {
  const faces = emitFaces(LEVEL_GRID);
  const doors = shipped().doors;

  it('matches the D wall group and no other', () => {
    const matched = Object.keys(faces.walls).filter((type) =>
      isDoorTileGeometry(faces.walls[type]!.positions, doors),
    );
    expect(matched).toEqual(['D']);
    expect(faces.walls['S']).toBeDefined();
    expect(isDoorTileGeometry(faces.floor.positions, doors)).toBe(false);
    expect(isDoorTileGeometry(faces.ceiling.positions, doors)).toBe(false);
  });

  it('hides nothing when there are no doors and nothing for an empty geometry', () => {
    expect(isDoorTileGeometry(faces.walls['D']!.positions, [])).toBe(false);
    expect(isDoorTileGeometry(new Float32Array(0), doors)).toBe(false);
  });
});
