// The one weapon table (FR-002). Pure data: no DOM, no three.js (FR-001).
//
// This module is negative in intent, like 006's falloff curve: no call site may
// write a fire interval, a damage figure, a spread, an ammo cost, a capacity, a
// magazine or a range, because every one of them is declared here and read from
// here. `weapons.test.ts` scans every file that imports this one and fails on a
// line that restates any of these numbers, so the rule is held by the gate
// rather than by intent.
//
// Two orderings are the whole of the weapons' feel and FR-003 makes them strict:
// the chaingun fires faster than the SMG, which fires faster than the pistol; and
// the pistol is tighter than the SMG, which is tighter than the chaingun. The
// damage column runs the other way, so the trade is real rather than a free
// upgrade at the third digit key.

export type WeaponKind = 'pistol' | 'smg' | 'chaingun';

/** One weapon's whole tuning. Every field is declared; none is derived. */
export interface Weapon {
  readonly kind: WeaponKind;
  /** Seconds between shots — the gate FR-004 accumulates elapsed time against. */
  readonly fireIntervalSeconds: number;
  /** What one shot deals to a guard it hits. */
  readonly damage: number;
  /** The widest angle, in radians, a shot may sit from the camera forward axis. */
  readonly maxSpreadRadians: number;
  /** Rounds one shot costs. */
  readonly ammoCost: number;
  /** The ceiling a pickup clamps to (US3's business, declared here). */
  readonly ammoCapacity: number;
  /** What the player holds at spawn and returns to on restart. */
  readonly startingAmmo: number;
  /** How far, in cells, a shot reaches before it resolves as `none`. */
  readonly maxRangeCells: number;
}

export const WEAPON_TABLE: Readonly<Record<WeaponKind, Weapon>> = {
  pistol: {
    kind: 'pistol',
    fireIntervalSeconds: 0.42,
    damage: 26,
    maxSpreadRadians: 0.012,
    ammoCost: 1,
    ammoCapacity: 99,
    startingAmmo: 24,
    maxRangeCells: 34,
  },
  smg: {
    kind: 'smg',
    fireIntervalSeconds: 0.11,
    damage: 17,
    maxSpreadRadians: 0.055,
    ammoCost: 1,
    ammoCapacity: 150,
    startingAmmo: 48,
    maxRangeCells: 28,
  },
  chaingun: {
    kind: 'chaingun',
    fireIntervalSeconds: 0.06,
    damage: 13,
    maxSpreadRadians: 0.115,
    ammoCost: 2,
    ammoCapacity: 200,
    startingAmmo: 96,
    maxRangeCells: 22,
  },
};

/** The declared kinds, in the order the digit keys select them. */
export const WEAPON_KINDS: readonly WeaponKind[] = ['pistol', 'smg', 'chaingun'];

/** What the player holds at spawn, and what a weapon switch returns to. */
export const DEFAULT_WEAPON: WeaponKind = 'pistol';

/** The declared switch delay (FR-008): no shot resolves while it runs. */
export const WEAPON_SWITCH_DELAY_SECONDS = 0.25;

/** The three select keys, as one table so no call site maps a digit itself. */
export const WEAPON_SELECT_KEY_CODES: Readonly<Record<string, WeaponKind>> = {
  Digit1: 'pistol',
  Digit2: 'smg',
  Digit3: 'chaingun',
};

export function weaponFor(kind: WeaponKind): Weapon {
  return WEAPON_TABLE[kind];
}

/** The weapon a key code selects, or null when the key is not a select key. */
export function weaponForKeyCode(code: string): WeaponKind | null {
  return WEAPON_SELECT_KEY_CODES[code] ?? null;
}

/** A fresh magazine per weapon, read off the table. A new record each call, so
 *  two runs never share one — which is what makes the restart in US2 a reset
 *  rather than an aliasing bug. */
export function startingAmmo(): Record<WeaponKind, number> {
  return {
    pistol: WEAPON_TABLE.pistol.startingAmmo,
    smg: WEAPON_TABLE.smg.startingAmmo,
    chaingun: WEAPON_TABLE.chaingun.startingAmmo,
  };
}
