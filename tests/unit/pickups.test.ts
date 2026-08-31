// T023 (FR-013, FR-014; US3-S1..S4, US3-S10): instantiation from 002's item spawn
// markers, the named error a marker with an undeclared kind records, radius
// collection that applies exactly once, and the second pass that does nothing at
// all. Written before `src/combat/pickups.ts` exists, per Article III.
//
// The module is driven with synthetic player positions rather than a page: every
// claim here is arithmetic over a marker table and a pair of coordinates.

import { describe, expect, it } from 'vitest';
import {
  PICKUP_RADIUS_TILES,
  UNDECLARED_PICKUP_KIND,
  buildPickupField,
  collectPickup,
  collectPickupsAt,
  pickupAt,
  pickupCenter,
  resetPickupField,
  withinPickupRadius,
  type Pickup,
  type PickupField,
} from '../../src/combat/pickups';
import { ITEM_SPAWNS } from '../../src/level';

/** An apply callback that always takes the pickup, counting the calls it saw. */
function taker(): { apply: (pickup: Pickup) => boolean; seen: Pickup[] } {
  const seen: Pickup[] = [];
  return {
    apply: (pickup) => {
      seen.push(pickup);
      return true;
    },
    seen,
  };
}

/** What the render loop passes: the player standing on a pickup's tile centre. */
function onTile(pickup: Pickup): { x: number; z: number } {
  return pickupCenter(pickup);
}

describe('one pickup per item marker (FR-013, US3-S1)', () => {
  it('instantiates exactly one pickup per marker of the shipped level', () => {
    const field = buildPickupField();
    expect(field.pickups).toHaveLength(ITEM_SPAWNS.length);
    expect(field.pickupsTotal).toBe(ITEM_SPAWNS.length);
    expect(field.errors).toEqual([]);
  });

  it('takes each kind from its marker, not from a position convention', () => {
    const field = buildPickupField();
    for (const spawn of ITEM_SPAWNS) {
      const pickup = pickupAt(field, spawn.x, spawn.z);
      expect(pickup, `no pickup at ${spawn.x},${spawn.z}`).not.toBeNull();
      expect(pickup!.kind).toBe(spawn.kind);
      expect(pickup!.tile).toEqual({ x: spawn.x, z: spawn.z });
      expect(pickup!.consumed).toBe(false);
    }
  });

  it('reports treasureTotal read from the level, not restated', () => {
    const field = buildPickupField();
    const treasure = ITEM_SPAWNS.filter((spawn) => spawn.kind === 'treasure').length;
    expect(field.treasureTotal).toBe(treasure);
    expect(field.treasureFound).toBe(0);
    expect(field.pickupsCollected).toBe(0);
  });

  it('counts a kind declared twice as two pickups, one per marker', () => {
    const field = buildPickupField([
      { x: 1, z: 1, kind: 'health' },
      { x: 2, z: 1, kind: 'health' },
    ]);
    expect(field.pickupsTotal).toBe(2);
    expect(field.pickups.map((p) => p.kind)).toEqual(['health', 'health']);
  });
});

describe('an undeclared kind is a named error, not a drop and not a throw (FR-013, US3-S2)', () => {
  const markers = [
    { x: 4, z: 9, kind: 'health' },
    { x: 17, z: 23, kind: 'rocket-launcher' },
    { x: 6, z: 6, kind: 'treasure' },
  ];

  it('loads without throwing', () => {
    expect(() => buildPickupField(markers)).not.toThrow();
  });

  it('records a named error citing the offending marker coordinates', () => {
    const field = buildPickupField(markers);
    expect(field.errors).toHaveLength(1);
    const error = field.errors[0]!;
    expect(error.name).toBe(UNDECLARED_PICKUP_KIND);
    expect(error.x).toBe(17);
    expect(error.z).toBe(23);
    expect(error.kind).toBe('rocket-launcher');
    // The coordinates are cited, not merely stored beside the message.
    expect(error.message).toContain('17');
    expect(error.message).toContain('23');
    expect(error.message).toContain('rocket-launcher');
  });

  it('instantiates the declared markers around it and counts only those', () => {
    const field = buildPickupField(markers);
    expect(field.pickups.map((p) => p.kind)).toEqual(['health', 'treasure']);
    expect(field.pickupsTotal).toBe(2);
    expect(field.treasureTotal).toBe(1);
  });
});

describe('collection within the declared radius (FR-014, US3-S3)', () => {
  it('declares one radius, and measures it from the pickup tile centre', () => {
    expect(PICKUP_RADIUS_TILES).toBeGreaterThan(0);
    const field = buildPickupField([{ x: 10, z: 10, kind: 'health' }]);
    const pickup = field.pickups[0]!;
    expect(pickupCenter(pickup)).toEqual({ x: 10.5, z: 10.5 });

    const justInside = 10.5 + PICKUP_RADIUS_TILES - 1e-6;
    const justOutside = 10.5 + PICKUP_RADIUS_TILES + 1e-6;
    expect(withinPickupRadius(pickup, justInside, 10.5, PICKUP_RADIUS_TILES)).toBe(true);
    expect(withinPickupRadius(pickup, justOutside, 10.5, PICKUP_RADIUS_TILES)).toBe(false);
    // Radial, not axis-aligned: the diagonal corner of the box is out of reach.
    const diagonal = 10.5 + PICKUP_RADIUS_TILES * 0.8;
    expect(withinPickupRadius(pickup, diagonal, diagonal, PICKUP_RADIUS_TILES)).toBe(false);
  });

  it('collects nothing while the player stands outside the radius', () => {
    const field = buildPickupField([{ x: 10, z: 10, kind: 'health' }]);
    const { apply, seen } = taker();
    expect(collectPickupsAt(field, 20.5, 20.5, apply)).toEqual([]);
    expect(seen).toEqual([]);
    expect(field.pickups[0]!.consumed).toBe(false);
    expect(field.pickupsCollected).toBe(0);
  });

  it('marks consumed, applies exactly once and increments the counter by one', () => {
    const field = buildPickupField([{ x: 10, z: 10, kind: 'health' }]);
    const { apply, seen } = taker();
    const collected = collectPickupsAt(field, ...positionOf(field), apply);

    expect(collected).toHaveLength(1);
    expect(seen).toHaveLength(1);
    expect(field.pickups[0]!.consumed).toBe(true);
    expect(field.pickupsCollected).toBe(1);
    expect(field.errors).toEqual([]);
  });

  it('leaves the pickup on the floor when the effect refuses it', () => {
    const field = buildPickupField([{ x: 3, z: 3, kind: 'health' }]);
    let calls = 0;
    const refuse = (): boolean => {
      calls += 1;
      return false;
    };
    expect(collectPickupsAt(field, 3.5, 3.5, refuse)).toEqual([]);
    expect(calls).toBe(1);
    expect(field.pickups[0]!.consumed).toBe(false);
    expect(field.pickupsCollected).toBe(0);
  });

  it('counts treasure toward treasureFound and nothing else does', () => {
    const field = buildPickupField([
      { x: 1, z: 1, kind: 'treasure' },
      { x: 3, z: 1, kind: 'ammo' },
    ]);
    const { apply } = taker();
    collectPickupsAt(field, 1.5, 1.5, apply);
    expect(field.treasureFound).toBe(1);
    collectPickupsAt(field, 3.5, 1.5, apply);
    expect(field.treasureFound).toBe(1);
    expect(field.pickupsCollected).toBe(2);
  });
});

describe('a consumed pickup does nothing on a second pass (FR-014, US3-S4)', () => {
  it('applies nothing, changes no counter and records no error', () => {
    const field = buildPickupField([{ x: 10, z: 10, kind: 'treasure' }]);
    const { apply, seen } = taker();
    collectPickupsAt(field, ...positionOf(field), apply);
    expect(field.pickupsCollected).toBe(1);
    expect(field.treasureFound).toBe(1);

    for (let pass = 0; pass < 5; pass += 1) {
      expect(collectPickupsAt(field, ...positionOf(field), apply)).toEqual([]);
    }

    expect(seen).toHaveLength(1);
    expect(field.pickupsCollected).toBe(1);
    expect(field.treasureFound).toBe(1);
    expect(field.errors).toEqual([]);
  });

  it('refuses a direct second collection of the same pickup', () => {
    const field = buildPickupField([{ x: 0, z: 0, kind: 'ammo' }]);
    const pickup = field.pickups[0]!;
    const { apply, seen } = taker();
    expect(collectPickup(field, pickup, apply)).toBe(true);
    expect(collectPickup(field, pickup, apply)).toBe(false);
    expect(seen).toHaveLength(1);
    expect(field.pickupsCollected).toBe(1);
  });
});

describe('a scripted run over every marker (US3-S10)', () => {
  /** Walks the player onto each pickup in turn, taking everything offered. */
  function scriptedRun(field: PickupField): void {
    const { apply } = taker();
    for (const pickup of [...field.pickups]) {
      const at = onTile(pickup);
      collectPickupsAt(field, at.x, at.z, apply);
      // Neither counter may ever run ahead of its total, mid-run included.
      expect(field.pickupsCollected).toBeLessThanOrEqual(field.pickupsTotal);
      expect(field.treasureFound).toBeLessThanOrEqual(field.treasureTotal);
    }
  }

  it('ends with pickupsCollected equal to pickupsTotal, neither exceeding the other', () => {
    const field = buildPickupField();
    scriptedRun(field);
    expect(field.pickupsCollected).toBe(field.pickupsTotal);
    expect(field.treasureFound).toBe(field.treasureTotal);
    expect(field.pickups.every((p) => p.consumed)).toBe(true);
  });

  it('a second scripted pass over the same field adds nothing', () => {
    const field = buildPickupField();
    scriptedRun(field);
    scriptedRun(field);
    expect(field.pickupsCollected).toBe(field.pickupsTotal);
    expect(field.treasureFound).toBe(field.treasureTotal);
    expect(field.errors).toEqual([]);
  });

  it('resets to uncollected, which is what US2\'s restart calls', () => {
    const field = buildPickupField();
    scriptedRun(field);
    resetPickupField(field);
    expect(field.pickupsCollected).toBe(0);
    expect(field.treasureFound).toBe(0);
    expect(field.pickups.every((p) => !p.consumed)).toBe(true);
    // The totals are facts about the level, so a restart does not move them.
    expect(field.pickupsTotal).toBe(ITEM_SPAWNS.length);
  });
});

/** The player position that stands on the field's first uncollected pickup. */
function positionOf(field: PickupField): [number, number] {
  const pickup = field.pickups[0]!;
  const at = pickupCenter(pickup);
  return [at.x, at.z];
}
