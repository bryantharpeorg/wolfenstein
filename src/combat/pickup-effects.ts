// What a collected pickup does to the run (FR-015). Pure: no DOM, no three.js, and
// no knowledge of where a pickup sits or whether the player reached it —
// `pickups.ts` decides that and calls in here with a kind.
//
// Every amount is declared once, in `PICKUP_EFFECTS`, and every ceiling is read
// from the table that owns it: `MAX_HEALTH` from US2's vitals, `ammoCapacity` from
// US1's weapon table, the treasure value from US2's score table. Nothing here
// restates a number another module declared, so retuning a weapon retunes what its
// pickups can hold.
//
// The one asymmetry the spec asks for lives in the return value rather than in the
// caller: `applied: false` means "leave it on the floor", which only a health
// pickup collected at maximum health ever answers (FR-014, US3-S6). Ammo and
// treasure are taken whether or not there is room, discarding the surplus.

import { addKey, type KeyInventory, type KeyKind } from '../interaction/keys';
import { addScore, SCORE_TABLE, type ScoreState, type TreasureKind } from './score';
import { MAX_HEALTH, type PlayerVitals } from './vitals';
import { WEAPON_TABLE, type WeaponKind } from './weapons';

/** The declared kinds — the set an item marker's kind string is measured against.
 *  Ordered as 002's `ItemKind` declares them, keys included: 004's keys are entries
 *  on this table, not a mechanism beside it (FR-015, US3-S9). */
export const PICKUP_KINDS = ['health', 'ammo', 'treasure', 'silver-key', 'gold-key'] as const;

export type PickupKind = (typeof PICKUP_KINDS)[number];

const PICKUP_KIND_SET: ReadonlySet<string> = new Set<string>(PICKUP_KINDS);

/** Whether a marker's kind string is one this spec declares (US3-S2). */
export function isPickupKind(kind: string): kind is PickupKind {
  return PICKUP_KIND_SET.has(kind);
}

/** One kind's whole effect. A discriminated union rather than four optional
 *  fields, so a kind cannot half-declare itself. */
export type PickupEffect =
  | { readonly effect: 'health'; readonly amount: number }
  | { readonly effect: 'ammo'; readonly amount: number; readonly weapons: readonly WeaponKind[] }
  | { readonly effect: 'treasure'; readonly treasure: TreasureKind }
  | { readonly effect: 'key'; readonly key: KeyKind };

/** The one declaration of what each kind is worth (FR-015). The ammo pickup names
 *  the weapon kinds it feeds rather than "all of them", so a later spec's weapon
 *  does not silently start dropping from crates it was never in. */
export const PICKUP_EFFECTS = {
  health: { effect: 'health', amount: 25 },
  ammo: { effect: 'ammo', amount: 20, weapons: ['pistol', 'smg', 'chaingun'] },
  treasure: { effect: 'treasure', treasure: 'treasure' },
  'silver-key': { effect: 'key', key: 'silver' },
  'gold-key': { effect: 'key', key: 'gold' },
} as const satisfies Readonly<Record<PickupKind, PickupEffect>>;

/** Everything a pickup may write to, passed in rather than reached for: the run's
 *  vitals, the live magazine, the score and 004's key inventory. */
export interface PickupTargets {
  readonly vitals: PlayerVitals;
  readonly ammo: Record<WeaponKind, number>;
  readonly score: ScoreState;
  readonly keys: KeyInventory;
}

/** What one application spent. `applied: false` is the only refusal, and the only
 *  thing that leaves a pickup on the floor. */
export interface PickupEffectResult {
  readonly applied: boolean;
  /** Health actually granted, after the clamp — not the declared amount. */
  readonly health: number;
  /** Rounds actually added, per weapon kind the pickup declared. */
  readonly ammo: Readonly<Partial<Record<WeaponKind, number>>>;
  /** Health and rounds the ceilings refused, discarded rather than overflowed. */
  readonly discarded: number;
  readonly points: number;
  readonly key: KeyKind | null;
}

const NOTHING: PickupEffectResult = {
  applied: false, health: 0, ammo: {}, discarded: 0, points: 0, key: null,
};

/** Clamped to `MAX_HEALTH` and refused at it (FR-015, US3-S5, US3-S6). */
function applyHealth(amount: number, vitals: PlayerVitals): PickupEffectResult {
  const room = MAX_HEALTH - vitals.health;
  // Not "nearly full" but "full": a player one point short takes the pickup and
  // wastes the rest, which is the trade the spec asks for.
  if (room <= 0) return NOTHING;

  const granted = Math.min(amount, room);
  vitals.health += granted;
  return { ...NOTHING, applied: true, health: granted, discarded: amount - granted };
}

/** Clamped per weapon to that weapon's declared capacity, surplus discarded
 *  (FR-015, US3-S7). Consumed either way — only health survives a full player. */
function applyAmmo(
  amount: number,
  weapons: readonly WeaponKind[],
  ammo: Record<WeaponKind, number>,
): PickupEffectResult {
  const added: Partial<Record<WeaponKind, number>> = {};
  let discarded = 0;

  for (const kind of weapons) {
    const room = Math.max(0, WEAPON_TABLE[kind].ammoCapacity - ammo[kind]);
    const granted = Math.min(amount, room);
    ammo[kind] += granted;
    added[kind] = granted;
    discarded += amount - granted;
  }

  return { ...NOTHING, applied: true, ammo: added, discarded };
}

/** The score table's value, added through US2's accumulator so the monotonic rule
 *  stays that module's (FR-015, US3-S8). */
function applyTreasure(kind: TreasureKind, score: ScoreState): PickupEffectResult {
  const points = SCORE_TABLE.treasure[kind];
  addScore(score, points);
  return { ...NOTHING, applied: true, points };
}

/** 004's inventory, through 004's `addKey` (FR-015, US3-S9). */
function applyKey(kind: KeyKind, keys: KeyInventory): PickupEffectResult {
  addKey(keys, kind);
  return { ...NOTHING, applied: true, key: kind };
}

/** Applies one collected pickup's declared effect. Called exactly once per
 *  collection by `pickups.ts`, which consumes nothing this refuses. */
export function applyPickupEffect(kind: PickupKind, targets: PickupTargets): PickupEffectResult {
  const effect: PickupEffect = PICKUP_EFFECTS[kind];
  switch (effect.effect) {
    case 'health':
      return applyHealth(effect.amount, targets.vitals);
    case 'ammo':
      return applyAmmo(effect.amount, effect.weapons, targets.ammo);
    case 'treasure':
      return applyTreasure(effect.treasure, targets.score);
    case 'key':
      return applyKey(effect.key, targets.keys);
  }
}
