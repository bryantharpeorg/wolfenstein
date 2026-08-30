import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { INTERACT_OUTCOMES, type InteractOutcome } from '../../src/interaction/outcomes';
import { buildDoorField, interactWithDoors } from '../../src/interaction/door-field';
import { stepDoor } from '../../src/interaction/door';
import { registerDoorGate, resetDoorGatesForTest } from '../../src/interaction/gate-registry';
import { createCrushGate } from '../../src/interaction/crush';
import { createInventory, addKey } from '../../src/interaction/keys';
import { lockGate } from '../../src/interaction/locks';
import { DOOR_TRAVEL_MS, DOOR_DWELL_MS } from '../../src/interaction/params';
import { advance } from './door-advance';

// A fixture level small enough to reason about, holding every door arrangement
// the outcome set names: one locked door, and a pair whose leaves contend for the
// same tile so the neighbour rule has something to refuse.
//
//   z2 x3  a gold-locked door
//   z4 x4  a door whose leaf retracts into x5 ...
//   z4 x5  ... which is itself a door
const GRID = [
  '11111111111',
  '10000000001',
  '111D1111111',
  '10000000001',
  '1110DD11111',
  '10000000001',
  '11111111111',
];

const LOCKS = { '3,2': 'gold', '4,4': 'none', '5,4': 'none' } as const;

/** Standing in the middle of a tile, which is where a player is. */
function at(x: number, z: number): [number, number] {
  return [x + 0.5, z + 0.5];
}

function freshField() {
  return buildDoorField(GRID, LOCKS);
}

function isDeclared(outcome: InteractOutcome): boolean {
  return (INTERACT_OUTCOMES as readonly string[]).includes(outcome);
}

describe('every interact command resolves to a declared outcome (FR-009, US2-S7)', () => {
  beforeEach(() => resetDoorGatesForTest());
  afterEach(() => resetDoorGatesForTest());

  it('names each of the seven reachable reasons at least once', () => {
    const inventory = createInventory();
    registerDoorGate(lockGate(LOCKS, inventory));
    const field = freshField();
    const seen = new Set<InteractOutcome>();
    const record = (outcome: InteractOutcome): void => {
      expect(isDeclared(outcome)).toBe(true);
      seen.add(outcome);
    };

    // no-target: nothing interactable within reach.
    record(interactWithDoors(field, ...at(8, 5)).outcome);

    // locked-missing-key: the gold door, and no gold key.
    record(interactWithDoors(field, ...at(3, 1)).outcome);

    // opened, then blocked-moving while the leaf travels.
    addKey(inventory, 'gold');
    record(interactWithDoors(field, ...at(3, 1)).outcome);
    advance(field.doors[0]!, DOOR_TRAVEL_MS / 2);
    record(interactWithDoors(field, ...at(3, 1)).outcome);

    // opened-now once it is fully open.
    advance(field.doors[0]!, DOOR_TRAVEL_MS);
    record(interactWithDoors(field, ...at(3, 1)).outcome);

    // refusing-closing once the dwell has elapsed and the leaf is travelling shut.
    advance(field.doors[0]!, DOOR_DWELL_MS + DOOR_TRAVEL_MS / 4);
    record(interactWithDoors(field, ...at(3, 1)).outcome);

    // blocked-neighbour: the x4 leaf wants the tile the open x5 door occupies.
    record(interactWithDoors(field, ...at(5, 3)).outcome);
    record(interactWithDoors(field, ...at(4, 3)).outcome);

    expect([...seen].sort()).toEqual(
      [
        'blocked-moving',
        'blocked-neighbour',
        'locked-missing-key',
        'no-target',
        'opened',
        'opened-now',
        'refusing-closing',
      ].sort(),
    );
  });

  it('answers every tile of the fixture with a declared outcome, never an empty result', () => {
    const inventory = createInventory();
    addKey(inventory, 'silver');
    registerDoorGate(lockGate(LOCKS, inventory));
    const field = freshField();

    let resolutions = 0;
    // Four passes over every tile: the doors are in different states each time
    // round, so the same tile exercises a different branch.
    for (let pass = 0; pass < 4; pass += 1) {
      for (let z = 0; z < GRID.length; z += 1) {
        for (let x = 0; x < GRID[z]!.length; x += 1) {
          const { outcome, door } = interactWithDoors(field, ...at(x, z));
          expect(outcome).toBeTypeOf('string');
          expect(outcome).not.toBe('');
          expect(outcome).toBeDefined();
          expect(isDeclared(outcome)).toBe(true);
          // A door-shaped outcome always names its door; only `no-target` has none.
          if (outcome === 'no-target') expect(door).toBeNull();
          else expect(door).not.toBeNull();
          resolutions += 1;
        }
      }
      for (const door of field.doors) advance(door, DOOR_TRAVEL_MS / 2);
    }

    expect(resolutions).toBe(4 * GRID.length * GRID[0]!.length);
  });

  it('answers a locked door the same way however many times it is asked', () => {
    registerDoorGate(lockGate(LOCKS, createInventory()));
    const field = freshField();

    for (let i = 0; i < 50; i += 1) {
      const { outcome } = interactWithDoors(field, ...at(3, 3));
      expect(outcome).toBe('locked-missing-key');
      expect(isDeclared(outcome)).toBe(true);
    }
  });

  it('reports declared outcomes from the step loop too, crush included', () => {
    const inventory = createInventory();
    addKey(inventory, 'gold');
    registerDoorGate(lockGate(LOCKS, inventory));
    const player = { x: 3.5, z: 2.5, radius: 0.3 };
    registerDoorGate(createCrushGate(() => player));
    const field = freshField();
    const door = field.doors[0]!;

    interactWithDoors(field, ...at(3, 1));
    advance(door, DOOR_TRAVEL_MS + DOOR_DWELL_MS, 100, player);
    const stepped = stepDoor(door, 100, { player });

    expect(stepped.outcomes.length).toBeGreaterThan(0);
    for (const outcome of stepped.outcomes) {
      expect(isDeclared(outcome)).toBe(true);
    }
  });

  it('declares no outcome twice, and none empty', () => {
    expect(new Set(INTERACT_OUTCOMES).size).toBe(INTERACT_OUTCOMES.length);
    for (const outcome of INTERACT_OUTCOMES) expect(outcome).not.toBe('');
  });
});
