import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createInventory, addKey, keyCounts, type KeyInventory } from '../../src/interaction/keys';
import { lockDecision, lockGate, requiredKeyFor } from '../../src/interaction/locks';
import { createDoor, interactDoor } from '../../src/interaction/door';
import { registerDoorGate, resetDoorGatesForTest } from '../../src/interaction/gate-registry';
import { DOOR_TRAVEL_MS, DOOR_DWELL_MS } from '../../src/interaction/params';
import { advance } from './door-advance';

const GOLD_DOOR = { x: 31, z: 42, lock: 'gold' } as const;
const SILVER_DOOR = { x: 42, z: 31, lock: 'silver' } as const;
const OPEN_DOOR = { x: 21, z: 10, lock: 'none' } as const;
const LOCKS = { '31,42': 'gold', '42,31': 'silver', '21,10': 'none' } as const;

const carrying = (...kinds: Array<'silver' | 'gold'>): KeyInventory => {
  const inventory = createInventory();
  for (const kind of kinds) addKey(inventory, kind);
  return inventory;
};

describe('lock decision (FR-009, FR-010, US2-S3, US2-S4, US2-S5)', () => {
  it('refuses by naming the missing kind, and never spends a key to say so', () => {
    // A gold door with no gold key, and a silver door held against a gold key:
    // possession of *any* key is not sufficient (US2-S5).
    for (const [lock, held, missing] of [
      ['gold', [], 'gold'],
      ['silver', ['gold'], 'silver'],
      ['gold', ['silver'], 'gold'],
    ] as const) {
      const inventory = carrying(...held);
      expect(lockDecision(lock, inventory)).toEqual({
        outcome: 'locked-missing-key',
        missingKey: missing,
        keyConsumed: false,
      });
      expect(keyCounts(inventory)).toEqual(keyCounts(carrying(...held)));
    }
  });

  it('allows once the matching key is held, and spends nothing (FR-010)', () => {
    const inventory = carrying('gold');
    expect(lockDecision('gold', inventory)).toBeNull();
    expect(keyCounts(inventory)).toEqual({ silver: 0, gold: 1 });
  });

  it('allows an unlocked door with an empty inventory', () => {
    expect(lockDecision('none', createInventory())).toBeNull();
  });

  it('reads the required kind from the lock table, falling back to the door', () => {
    expect(requiredKeyFor(LOCKS, GOLD_DOOR)).toBe('gold');
    expect(requiredKeyFor(LOCKS, SILVER_DOOR)).toBe('silver');
    expect(requiredKeyFor(LOCKS, OPEN_DOOR)).toBe(null);
    expect(requiredKeyFor({}, { x: 9, z: 9, lock: 'gold' })).toBe('gold');
  });
});

describe('lock gate (FR-009, FR-010)', () => {
  it('refuses a gold door with no gold key, naming the kind to its observer', () => {
    const seen: Array<{ kind: string; consumed: boolean }> = [];
    const gate = lockGate(LOCKS, createInventory(), (kind, consumed) =>
      seen.push({ kind, consumed }),
    );

    expect(gate({ door: GOLD_DOOR, phase: 'interact' })).toBe('locked-missing-key');
    expect(seen).toEqual([{ kind: 'gold', consumed: false }]);
  });

  it('reads the live inventory, so a key picked up after registration counts', () => {
    const inventory = createInventory();
    const gate = lockGate(LOCKS, inventory);

    expect(gate({ door: GOLD_DOOR, phase: 'interact' })).toBe('locked-missing-key');
    addKey(inventory, 'gold');
    expect(gate({ door: GOLD_DOOR, phase: 'interact' })).toBeNull();
    expect(keyCounts(inventory)).toEqual({ silver: 0, gold: 1 });
  });

  it('never refuses the close phase, nor an unlocked door — a lock gates opening', () => {
    const gate = lockGate(LOCKS, createInventory());
    expect(gate({ door: GOLD_DOOR, phase: 'close' })).toBeNull();
    expect(gate({ door: OPEN_DOOR, phase: 'interact' })).toBeNull();
  });
});

// The same decision answered by a real door, so the state and progress US2-S3 and
// US2-S4 name are observed on US1's machine rather than assumed.
describe('a locked door on the door machine (FR-009, FR-010, US2-S3, US2-S4, US2-S5)', () => {
  beforeEach(() => resetDoorGatesForTest());
  afterEach(() => resetDoorGatesForTest());

  const goldDoor = () => createDoor({ x: 31, z: 42, axis: 'z', lock: 'gold' });

  it('refuses a gold door with locked-missing-key, closed and at progress 0', () => {
    registerDoorGate(lockGate(LOCKS, createInventory()));
    const door = goldDoor();

    expect(interactDoor(door)).toBe('locked-missing-key');
    expect(door.state).toBe('closed');
    expect(door.progress).toBe(0);
  });

  it('stays shut under a hundred refused presses', () => {
    registerDoorGate(lockGate(LOCKS, createInventory()));
    const door = goldDoor();

    for (let i = 0; i < 100; i += 1) expect(interactDoor(door)).toBe('locked-missing-key');
    advance(door, DOOR_TRAVEL_MS * 2);

    expect(door.state).toBe('closed');
    expect(door.progress).toBe(0);
  });

  it('opens for the matching key, and the key is still there afterwards', () => {
    const inventory = carrying('gold');
    registerDoorGate(lockGate(LOCKS, inventory));
    const door = goldDoor();

    expect(interactDoor(door)).toBe('opened');
    expect(door.state).toBe('opening');
    expect(keyCounts(inventory)).toEqual({ silver: 0, gold: 1 });

    // And it goes on opening, then closes on its own: the unlock is not a flicker,
    // and the lock does not hold a door shut once it is time to close.
    advance(door, DOOR_TRAVEL_MS);
    expect(door.state).toBe('open');
    advance(door, DOOR_DWELL_MS + DOOR_TRAVEL_MS);
    expect(door.state).toBe('closed');

    // The same door, later: the key was never spent, so it opens again.
    expect(interactDoor(door)).toBe('opened');
    expect(keyCounts(inventory)).toEqual({ silver: 0, gold: 1 });
  });

  it('refuses a silver door held against a gold key, naming silver', () => {
    const inventory = carrying('gold');
    const named: string[] = [];
    registerDoorGate(lockGate(LOCKS, inventory, (kind) => named.push(kind)));
    const door = createDoor({ x: 42, z: 31, axis: 'x', lock: 'silver' });

    expect(interactDoor(door)).toBe('locked-missing-key');
    expect(named).toEqual(['silver']);
    expect(door.state).toBe('closed');
    expect(door.progress).toBe(0);
    expect(keyCounts(inventory)).toEqual({ silver: 0, gold: 1 });
  });

  it('lets an unlocked door open with an empty inventory', () => {
    registerDoorGate(lockGate(LOCKS, createInventory()));
    const door = createDoor({ x: 21, z: 10, axis: 'x', lock: 'none' });

    expect(interactDoor(door)).toBe('opened');
    expect(door.state).toBe('opening');
  });
});
