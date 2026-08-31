// The one weapon table (FR-002). Pure data: no DOM, no three.js (FR-001). No
// call site may restate a value from it — `weapons.test.ts` scans every importer
// for a line repeating one — and FR-003's two orderings are strict: chaingun
// faster than SMG faster than pistol, pistol tighter than SMG tighter than
// chaingun, with damage running the other way so the trade is real.

export type WeaponKind = 'pistol' | 'smg' | 'chaingun';

/** One weapon's whole tuning. Every field declared; none derived. */
export interface Weapon {
  readonly kind: WeaponKind;
  readonly fireIntervalSeconds: number; // what FR-004's gate accumulates against
  readonly damage: number; // what one shot deals to a guard it hits
  readonly maxSpreadRadians: number; // widest angle from camera forward
  readonly ammoCost: number; // rounds one shot costs
  readonly ammoCapacity: number; // the ceiling a pickup clamps to (US3)
  readonly startingAmmo: number; // held at spawn, returned to on restart
  readonly maxRangeCells: number; // before a shot resolves as `none`
}

export const WEAPON_TABLE: Readonly<Record<WeaponKind, Weapon>> = {
  pistol:   { kind: 'pistol',   fireIntervalSeconds: 0.42, damage: 26, maxSpreadRadians: 0.012, ammoCost: 1, ammoCapacity: 99,  startingAmmo: 24, maxRangeCells: 34 },
  smg:      { kind: 'smg',      fireIntervalSeconds: 0.11, damage: 17, maxSpreadRadians: 0.055, ammoCost: 1, ammoCapacity: 150, startingAmmo: 48, maxRangeCells: 28 },
  chaingun: { kind: 'chaingun', fireIntervalSeconds: 0.06, damage: 13, maxSpreadRadians: 0.115, ammoCost: 2, ammoCapacity: 200, startingAmmo: 96, maxRangeCells: 22 },
};

/** The kinds, in the order the digit keys select them. */
export const WEAPON_KINDS: readonly WeaponKind[] = ['pistol', 'smg', 'chaingun'];

/** What the player holds at spawn. */
export const DEFAULT_WEAPON: WeaponKind = 'pistol';

/** The declared switch delay (FR-008): no shot resolves while it runs. */
export const WEAPON_SWITCH_DELAY_SECONDS = 0.25;

/** The select keys, so no call site maps a digit itself. */
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

/** A fresh magazine: a new record each call, so two runs never share one. */
export function startingAmmo(): Record<WeaponKind, number> {
  return {
    pistol: WEAPON_TABLE.pistol.startingAmmo,
    smg: WEAPON_TABLE.smg.startingAmmo,
    chaingun: WEAPON_TABLE.chaingun.startingAmmo,
  };
}
