import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createInventory, addKey, keyCounts, type KeyInventory } from '../../src/interaction/keys';
import { lockDecision, lockGate, requiredKeyFor } from '../../src/interaction/locks';
import { createDoor, interactDoor } from '../../src/interaction/door';
import { registerDoorGate, resetDoorGatesForTest } from '../../src/interaction/gate-registry';
import { DOOR_TRAVEL_MS, DOOR_DWELL_MS } from '../../src/interaction/params';
import { advance } from './door-advance';

const GOLD_DOOR = { x: 31, z: 42, lock: 'gold' } as const;
const SILVER_DOOR = { x: 42, z: 31, lock: 'silver' } as const;
const LOCKS = { '31,42': 'gold', '42,31': 'silver', '21,10': 'none' } as const;

describe('lock decision (FR-009, FR-010, US2-S3, US2-S4, US2-S5)', () => {
  it('refuses with locked-missing-key naming gold when the inventory has no gold key', () => {
    const inventory = createInventory();

    const decision = lockDecision('gold', inventory);

    expect(decision).not.toBeNull();
    expect(decision?.outcome).toBe('locked-missing-key');
    expect(decision?.missingKey).toBe('gold');
    expect(decision?.keyConsumed).toBe(false);
  });

  it('allows once the matching key is held, and spends nothing (FR-010)', () => {
    const inventory = createInventory();
    addKey(inventory, 'gold');

    expect(lockDecision('gold', inventory)).toBeNull();
    expect(keyCounts(inventory)).toEqual({ silver: 0, gold: 1 });
  });

  it('names silver for a silver door held against a gold key - any key is not enough', () => {
    const inventory = createInventory();
    addKey(inventory, 'gold');

    const decision = lockDecision('silver', inventory);

    expect(decision?.outcome).toBe('locked-missing-key');
    expect(decision?.missingKey).toBe('silver');
    expect(keyCounts(inventory)).toEqual({ silver: 0, gold: 1 });
  });

  it('allows an unlocked door with an empty inventory', () => {
    expect(lockDecision('none', createInventory())).toBeNull();
  });

  it('reads the required kind from the lock table, falling back to the door', () => {
    expect(requiredKeyFor(LOCKS, GOLD_DOOR)).toBe('gold');
    expect(requiredKeyFor(LOCKS, SILVER_DOOR)).toBe('silver');
    expect(requiredKeyFor(LOCKS, { x: 21, z: 10, lock: 'none' })).toBe(null);
    expect(requiredKeyFor({}, { x: 9, z: 9, lock: 'gold' })).toBe('gold');
  });
});

describe('lock gate (FR-009, FR-010)', () => {
  it('refuses an interact against a gold door held with no gold key', () => {
    const inventory = createInventory();
    const gate = lockGate(LOCKS, inventory);

    expect(gate({ door: GOLD_DOOR, phase: 'interact' })).toBe('locked-missing-key');
  });

  it('reports the missing kind to its observer, and reports no key spent', () => {
    const inventory = createInventory();
    const seen: Array<{ kind: string; consumed: boolean }> = [];
    const gate = lockGate(LOCKS, inventory, (kind, consumed) => seen.push({ kind, consumed }));

    gate({ door: SILVER_DOOR, phase: 'interact' });

    expect(seen).toEqual([{ kind: 'silver', consumed: false }]);
  });

  it('allows the same door once its key is carried, and the key survives', () => {
    const inventory = createInventory();
    const gate = lockGate(LOCKS, inventory);
    addKey(inventory, 'gold');

    expect(gate({ door: GOLD_DOOR, phase: 'interact' })).toBeNull();
    expect(keyCounts(inventory)).toEqual({ silver: 0, gold: 1 });
  });

  it('reads the live inventory, so a key picked up after registration counts', () => {
    const inventory = createInventory();
    const gate = lockGate(LOCKS, inventory);

    expect(gate({ door: GOLD_DOOR, phase: 'interact' })).toBe('locked-missing-key');
    addKey(inventory, 'gold');
    expect(gate({ door: GOLD_DOOR, phase: 'interact' })).toBeNull();
  });

  it('never refuses the close phase - a lock gates opening, not shutting', () => {
    const inventory = createInventory();
    const gate = lockGate(LOCKS, inventory);

    expect(gate({ door: GOLD_DOOR, phase: 'close' })).toBeNull();
  });

  it('allows an unlocked door', () => {
    const gate = lockGate(LOCKS, createInventory());

    expect(gate({ door: { x: 21, z: 10, lock: 'none' }, phase: 'interact' })).toBeNull();
  });
});

// The gate registered on US1's door machine: the same decision, now answered by
// a real door, so the state and progress US2-S3 and US2-S4 name are observed
// rather than assumed.
describe('a locked door on the door machine (FR-009, FR-010, US2-S3, US2-S4, US2-S5)', () => {
  beforeEach(() => resetDoorGatesForTest());
  afterEach(() => resetDoorGatesForTest());

  function armed(inventory: KeyInventory): void {
    registerDoorGate(lockGate(LOCKS, inventory));
  }

  it('refuses a gold door with locked-missing-key, closed and at progress 0', () => {
    const inventory = createInventory();
    armed(inventory);
    const door = createDoor({ x: 31, z: 42, axis: 'z', lock: 'gold' });

    const outcome = interactDoor(door);

    expect(outcome).toBe('locked-missing-key');
    expect(door.state).toBe('closed');
    expect(door.progress).toBe(0);
  });

  it('stays shut under a hundred refused presses', () => {
    const inventory = createInventory();
    armed(inventory);
    const door = createDoor({ x: 31, z: 42, axis: 'z', lock: 'gold' });

    for (let i = 0; i < 100; i += 1) expect(interactDoor(door)).toBe('locked-missing-key');
    advance(door, DOOR_TRAVEL_MS * 2);

    expect(door.state).toBe('closed');
    expect(door.progress).toBe(0);
  });

  it('opens for the matching key and leaves the key in the inventory', () => {
    const inventory = createInventory();
    addKey(inventory, 'gold');
    armed(inventory);
    const door = createDoor({ x: 31, z: 42, axis: 'z', lock: 'gold' });

    const outcome = interactDoor(door);

    expect(outcome).toBe('opened');
    expect(door.state).toBe('opening');
    expect(keyCounts(inventory)).toEqual({ silver: 0, gold: 1 });
    // And it goes on opening: the unlock is not a one-frame flicker.
    advance(door, DOOR_TRAVEL_MS);
    expect(door.state).toBe('open');
    expect(keyCounts(inventory)).toEqual({ silver: 0, gold: 1 });
  });

  it('opens the same door again later - the key was never spent', () => {
    const inventory = createInventory();
    addKey(inventory, 'gold');
    armed(inventory);
    const door = createDoor({ x: 31, z: 42, axis: 'z', lock: 'gold' });

    interactDoor(door);
    advance(door, DOOR_TRAVEL_MS + DOOR_DWELL_MS + DOOR_TRAVEL_MS);
    expect(door.state).toBe('closed');

    expect(interactDoor(door)).toBe('opened');
    expect(keyCounts(inventory)).toEqual({ silver: 0, gold: 1 });
  });

  it('refuses a silver door held against a gold key, naming silver', () => {
    const inventory = createInventory();
    addKey(inventory, 'gold');
    const named: string[] = [];
    registerDoorGate(lockGate(LOCKS, inventory, (kind) => named.push(kind)));
    const door = createDoor({ x: 42, z: 31, axis: 'x', lock: 'silver' });

    const outcome = interactDoor(door);

    expect(outcome).toBe('locked-missing-key');
    expect(named).toEqual(['silver']);
    expect(door.state).toBe('closed');
    expect(door.progress).toBe(0);
  });

  it('lets an unlocked door open with an empty inventory', () => {
    armed(createInventory());
    const door = createDoor({ x: 21, z: 10, axis: 'x', lock: 'none' });

    expect(interactDoor(door)).toBe('opened');
    expect(door.state).toBe('opening');
  });

  it('does not hold an unlocked-by-key door shut once it is time to close', () => {
    const inventory = createInventory();
    addKey(inventory, 'gold');
    armed(inventory);
    const door = createDoor({ x: 31, z: 42, axis: 'z', lock: 'gold' });

    interactDoor(door);
    advance(door, DOOR_TRAVEL_MS);
    advance(door, DOOR_DWELL_MS);
    advance(door, DOOR_TRAVEL_MS);

    expect(door.state).toBe('closed');
  });
});
