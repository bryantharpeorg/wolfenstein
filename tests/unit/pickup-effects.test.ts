// T024 (FR-015; US3-S5..S8, Edge Cases): what each declared kind actually does to
// the run — health clamped to US2's maximum and refused outright at full health,
// ammo clamped to each weapon's capacity in US1's table with the surplus
// discarded, treasure always taken at its score-table value. Written before
// `src/combat/pickup-effects.ts` exists, per Article III.
//
// No amount and no capacity is restated here: every expectation is computed from
// the table that declares it, so retuning a weapon cannot silently pass a stale
// assertion.

import { describe, expect, it } from 'vitest';
import {
  PICKUP_EFFECTS,
  PICKUP_KINDS,
  applyPickupEffect,
  isPickupKind,
  type PickupTargets,
} from '../../src/combat/pickup-effects';
import { createInventory } from '../../src/interaction/keys';
import { SCORE_TABLE, createScore } from '../../src/combat/score';
import { MAX_HEALTH, applyDamage, createVitals } from '../../src/combat/vitals';
import { WEAPON_KINDS, WEAPON_TABLE, startingAmmo, type WeaponKind } from '../../src/combat/weapons';

function targets(): PickupTargets {
  return {
    vitals: createVitals(),
    ammo: startingAmmo(),
    score: createScore(),
    keys: createInventory(),
  };
}

const healthEffect = PICKUP_EFFECTS.health;
const ammoEffect = PICKUP_EFFECTS.ammo;

describe('the declared kinds (FR-013, FR-015)', () => {
  it('declares an effect for every kind and recognises nothing else', () => {
    expect([...PICKUP_KINDS].sort()).toEqual(Object.keys(PICKUP_EFFECTS).sort());
    for (const kind of PICKUP_KINDS) expect(isPickupKind(kind)).toBe(true);
    expect(isPickupKind('rocket-launcher')).toBe(false);
    expect(isPickupKind('')).toBe(false);
  });

  it('names the two key kinds 004 owns among them, not beside them', () => {
    expect(PICKUP_EFFECTS['silver-key']).toEqual({ effect: 'key', key: 'silver' });
    expect(PICKUP_EFFECTS['gold-key']).toEqual({ effect: 'key', key: 'gold' });
  });
});

describe('health raises health, clamped to the maximum (FR-015, US3-S5)', () => {
  it('adds the declared amount when there is room for all of it', () => {
    const state = targets();
    expect(healthEffect.effect).toBe('health');
    const amount = healthEffect.effect === 'health' ? healthEffect.amount : 0;
    expect(amount).toBeGreaterThan(0);

    applyDamage(state.vitals, MAX_HEALTH - 1);
    const result = applyPickupEffect('health', state);

    expect(result.applied).toBe(true);
    expect(result.health).toBe(amount);
    expect(state.vitals.health).toBe(1 + amount);
    expect(state.vitals.health).toBeLessThanOrEqual(MAX_HEALTH);
  });

  it('clamps at the maximum and never exceeds it, discarding the surplus', () => {
    const state = targets();
    const amount = healthEffect.effect === 'health' ? healthEffect.amount : 0;
    // One point short: all but one point of the pickup is surplus.
    applyDamage(state.vitals, 1);
    const result = applyPickupEffect('health', state);

    expect(result.applied).toBe(true);
    expect(result.health).toBe(1);
    expect(result.discarded).toBe(amount - 1);
    expect(state.vitals.health).toBe(MAX_HEALTH);
  });

  it('never carries health past the maximum however many are collected', () => {
    const state = targets();
    applyDamage(state.vitals, MAX_HEALTH - 1);
    for (let i = 0; i < 10; i += 1) {
      applyPickupEffect('health', state);
      expect(state.vitals.health).toBeLessThanOrEqual(MAX_HEALTH);
    }
    expect(state.vitals.health).toBe(MAX_HEALTH);
  });
});

describe('a full player does not destroy supplies (FR-014, US3-S6)', () => {
  it('refuses the pickup at exactly maximum health, applying nothing', () => {
    const state = targets();
    expect(state.vitals.health).toBe(MAX_HEALTH);

    const result = applyPickupEffect('health', state);

    // `applied: false` is what leaves it on the floor: the collection path in
    // `pickups.ts` consumes nothing an effect refused.
    expect(result.applied).toBe(false);
    expect(result.health).toBe(0);
    expect(state.vitals.health).toBe(MAX_HEALTH);
  });

  it('takes it again as soon as the player has lost a single point', () => {
    const state = targets();
    expect(applyPickupEffect('health', state).applied).toBe(false);
    applyDamage(state.vitals, 1);
    expect(applyPickupEffect('health', state).applied).toBe(true);
    expect(state.vitals.health).toBe(MAX_HEALTH);
  });
});

describe('ammo is clamped to each weapon capacity, surplus discarded (FR-015, US3-S7)', () => {
  const declared: readonly WeaponKind[] = ammoEffect.effect === 'ammo' ? ammoEffect.weapons : [];
  const amount = ammoEffect.effect === 'ammo' ? ammoEffect.amount : 0;

  it('declares which weapon kinds it feeds, and they are real weapons', () => {
    expect(declared.length).toBeGreaterThan(0);
    for (const kind of declared) expect(WEAPON_KINDS).toContain(kind);
    expect(amount).toBeGreaterThan(0);
  });

  it('adds the declared amount to each weapon kind the pickup declares', () => {
    const state = targets();
    const before = { ...state.ammo };
    const result = applyPickupEffect('ammo', state);

    expect(result.applied).toBe(true);
    for (const kind of declared) {
      expect(state.ammo[kind]).toBe(before[kind] + amount);
      expect(result.ammo[kind]).toBe(amount);
    }
    // A weapon the pickup does not declare is untouched.
    for (const kind of WEAPON_KINDS) {
      if (declared.includes(kind)) continue;
      expect(state.ammo[kind]).toBe(before[kind]);
    }
  });

  it('clamps at capacity and discards the surplus rather than overflowing', () => {
    const state = targets();
    for (const kind of WEAPON_KINDS) state.ammo[kind] = WEAPON_TABLE[kind].ammoCapacity;

    const result = applyPickupEffect('ammo', state);

    for (const kind of declared) {
      expect(state.ammo[kind]).toBe(WEAPON_TABLE[kind].ammoCapacity);
      expect(result.ammo[kind]).toBe(0);
    }
    expect(result.discarded).toBe(amount * declared.length);
    // Consumed all the same: only health survives a wasted collection (US3-S6).
    expect(result.applied).toBe(true);
  });

  it('takes only the room that is left when one round short of capacity', () => {
    const state = targets();
    for (const kind of WEAPON_KINDS) state.ammo[kind] = WEAPON_TABLE[kind].ammoCapacity - 1;

    const result = applyPickupEffect('ammo', state);

    for (const kind of declared) {
      expect(state.ammo[kind]).toBe(WEAPON_TABLE[kind].ammoCapacity);
      expect(result.ammo[kind]).toBe(1);
    }
    expect(result.discarded).toBe((amount - 1) * declared.length);
  });

  it('keeps no counter above capacity however many are collected', () => {
    const state = targets();
    for (let i = 0; i < 200; i += 1) applyPickupEffect('ammo', state);
    for (const kind of WEAPON_KINDS) {
      expect(state.ammo[kind]).toBeLessThanOrEqual(WEAPON_TABLE[kind].ammoCapacity);
    }
  });
});

describe('treasure is always taken, at the score table value (FR-015, US3-S8)', () => {
  it('adds the score-table value and reports it', () => {
    const state = targets();
    const result = applyPickupEffect('treasure', state);

    expect(result.applied).toBe(true);
    expect(result.points).toBe(SCORE_TABLE.treasure.treasure);
    expect(state.score.points).toBe(SCORE_TABLE.treasure.treasure);
  });

  it('is consumed at full health, full ammo and any score — nothing exempts it', () => {
    const state = targets();
    for (const kind of WEAPON_KINDS) state.ammo[kind] = WEAPON_TABLE[kind].ammoCapacity;
    expect(state.vitals.health).toBe(MAX_HEALTH);

    expect(applyPickupEffect('treasure', state).applied).toBe(true);
    expect(applyPickupEffect('treasure', state).applied).toBe(true);
    expect(state.score.points).toBe(SCORE_TABLE.treasure.treasure * 2);
  });

  it('changes nothing but the score', () => {
    const state = targets();
    const ammo = { ...state.ammo };
    applyPickupEffect('treasure', state);
    expect(state.vitals.health).toBe(MAX_HEALTH);
    expect(state.ammo).toEqual(ammo);
    expect(state.keys).toEqual(createInventory());
  });
});

describe('004\'s keys are an effect on this path, not a second mechanism (FR-015, US3-S9)', () => {
  it('adds exactly one key of the marker\'s kind to 004\'s inventory', () => {
    const state = targets();

    const silver = applyPickupEffect('silver-key', state);
    expect(silver.applied).toBe(true);
    expect(silver.key).toBe('silver');
    expect(state.keys).toEqual({ silver: 1, gold: 0 });

    const gold = applyPickupEffect('gold-key', state);
    expect(gold.key).toBe('gold');
    expect(state.keys).toEqual({ silver: 1, gold: 1 });
  });

  it('spends no health, ammo or score on a key', () => {
    const state = targets();
    const ammo = { ...state.ammo };
    applyPickupEffect('gold-key', state);
    expect(state.vitals.health).toBe(MAX_HEALTH);
    expect(state.ammo).toEqual(ammo);
    expect(state.score.points).toBe(0);
  });
});

describe('every kind reports the same shape (FR-015)', () => {
  it('answers for each declared kind without throwing, and reports what it spent', () => {
    for (const kind of PICKUP_KINDS) {
      const state = targets();
      applyDamage(state.vitals, 1); // so health is takeable too
      const result = applyPickupEffect(kind, state);
      expect(result.applied).toBe(true);
      expect(result.health).toBeGreaterThanOrEqual(0);
      expect(result.points).toBeGreaterThanOrEqual(0);
      expect(result.discarded).toBeGreaterThanOrEqual(0);
    }
  });
});
