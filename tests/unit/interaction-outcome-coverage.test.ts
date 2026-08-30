import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { INTERACT_OUTCOMES, type InteractOutcome } from '../../src/interaction/outcomes';
import { buildDoorField, doorAt, interactWithDoors } from '../../src/interaction/door-field';
import { stepDoor } from '../../src/interaction/door';
import { registerDoorGate, resetDoorGatesForTest } from '../../src/interaction/gate-registry';
import { createInventory } from '../../src/interaction/keys';
import { lockGate } from '../../src/interaction/locks';
import { DOOR_TRAVEL_MS, DOOR_DWELL_MS } from '../../src/interaction/params';
import { SECRET_TRAVEL_MS } from '../../src/interaction/secret';
import { buildSecretField, interactWithSecrets } from '../../src/interaction/secret-field';
import { advance } from './door-advance';
import { advanceField } from './secret-advance';
import { SECRET_FIXTURE, at } from './secret-fixture';

// US1 and US2 proved seven of the ten declared outcomes reachable. US3 adds the
// last two secret answers, so this file closes the set: every reason a press can
// be given is produced here by a real push or a real press, none by hand.

// A gold-locked door at (3,2) and a pair at (4,4)/(5,4) whose leaves contend for
// one tile, so the door-side reasons all have an arrangement that produces them.
const DOOR_GRID = [
  '11111111111',
  '10000000001',
  '111D1111111',
  '10000000001',
  '1110DD11111',
  '10000000001',
  '11111111111',
];

const LOCKS = { '3,2': 'gold', '4,4': 'none', '5,4': 'none' } as const;

// A secret at (3,3) with solid rock one tile behind it: nothing can travel.
const WALLED_SECRET = [
  '11111111111',
  '10000000001',
  '10000000001',
  '101S1000001',
  '10010000001',
  '10000000001',
  '11111111111',
];

describe('every outcome in INTERACT_OUTCOMES is produced by a real press (FR-006, US3-S8)', () => {
  beforeEach(() => resetDoorGatesForTest());
  afterEach(() => resetDoorGatesForTest());

  it('names all ten, doors and secrets together', () => {
    const seen = new Set<InteractOutcome>();
    const record = (outcome: InteractOutcome): void => {
      expect(INTERACT_OUTCOMES).toContain(outcome);
      seen.add(outcome);
    };

    // --- the door side (US1, US2) -----------------------------------------
    const inventory = createInventory();
    registerDoorGate(lockGate(LOCKS, inventory));
    const doors = buildDoorField(DOOR_GRID, LOCKS);

    record(interactWithDoors(doors, ...at(8, 5)).outcome); // no-target
    record(interactWithDoors(doors, ...at(3, 1)).outcome); // locked-missing-key

    const pair = doorAt(doors, 5, 4)!;
    record(interactWithDoors(doors, ...at(5, 3)).outcome); // opened
    record(interactWithDoors(doors, ...at(5, 3)).outcome); // blocked-moving
    record(interactWithDoors(doors, ...at(4, 3)).outcome); // blocked-neighbour
    advance(pair, DOOR_TRAVEL_MS);
    record(interactWithDoors(doors, ...at(5, 3)).outcome); // opened-now
    advance(pair, DOOR_DWELL_MS + DOOR_TRAVEL_MS / 4);
    record(interactWithDoors(doors, ...at(5, 3)).outcome); // refusing-closing
    // Standing in the doorway as it closes: the leaf reverses rather than close
    // on the player. The capsule is handed straight to the step, so this needs no
    // registry — the same fact `door-crush.test.ts` asserts at length.
    const inDoorway = { x: pair.x + 0.5, z: pair.z + 0.5, radius: 0.3 };
    for (const outcome of stepDoor(pair, 100, { player: inDoorway }).outcomes) record(outcome);

    // --- the secret side (US3) --------------------------------------------
    const secrets = buildSecretField(SECRET_FIXTURE);
    record(interactWithSecrets(secrets, ...at(3, 2)).outcome); // opened
    advanceField(secrets, SECRET_TRAVEL_MS * 2);
    record(interactWithSecrets(secrets, ...at(3, 2)).outcome); // already-open

    const walled = buildSecretField(WALLED_SECRET);
    record(interactWithSecrets(walled, ...at(3, 2)).outcome); // blocked-geometry

    expect([...seen].sort()).toEqual([...INTERACT_OUTCOMES].sort());
    expect(seen.size).toBe(INTERACT_OUTCOMES.length);
  });

  it('gives a secret an outcome for every state it can be asked in', () => {
    const field = buildSecretField(SECRET_FIXTURE);
    expect(interactWithSecrets(field, ...at(7, 4)).outcome).toBe('no-target');
    expect(interactWithSecrets(field, ...at(3, 2)).outcome).toBe('opened');

    advanceField(field, SECRET_TRAVEL_MS / 2);
    expect(interactWithSecrets(field, ...at(3, 2)).outcome).toBe('blocked-moving');

    advanceField(field, SECRET_TRAVEL_MS);
    expect(interactWithSecrets(field, ...at(3, 2)).outcome).toBe('already-open');

    const walled = buildSecretField(WALLED_SECRET);
    expect(interactWithSecrets(walled, ...at(3, 2)).outcome).toBe('blocked-geometry');
    advanceField(walled, SECRET_TRAVEL_MS * 2);
    expect(interactWithSecrets(walled, ...at(3, 2)).outcome).toBe('blocked-geometry');
  });

  it('answers every tile of the secret fixture with a declared outcome', () => {
    const field = buildSecretField(SECRET_FIXTURE);
    let resolutions = 0;
    for (let pass = 0; pass < 3; pass += 1) {
      for (let z = 0; z < SECRET_FIXTURE.length; z += 1) {
        for (let x = 0; x < SECRET_FIXTURE[z]!.length; x += 1) {
          const { outcome, secret } = interactWithSecrets(field, ...at(x, z));
          expect(INTERACT_OUTCOMES).toContain(outcome);
          if (outcome === 'no-target') expect(secret).toBeNull();
          else expect(secret).not.toBeNull();
          resolutions += 1;
        }
      }
      advanceField(field, SECRET_TRAVEL_MS / 2);
    }
    expect(resolutions).toBe(3 * SECRET_FIXTURE.length * SECRET_FIXTURE[0]!.length);
  });
});
