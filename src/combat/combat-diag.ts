// The `window.__diag.combat` shape (FR-018), attached to 001's Diagnostics by
// module augmentation rather than by editing `src/diag/diag.ts`. Pure.
//
// US1 declares the whole field set here, zeroed, including fields it never
// writes: `src/diag/diag.ts` is the file 002-006 each extended, and four more
// stories extending it would put four diffs on adjacent lines.

import type { Diagnostics } from '../diag/diag';
import { DEFAULT_WEAPON } from './weapons';
import type { WeaponKind } from './weapons';

export type AmmoCounts = Record<WeaponKind, number>;

/** Every field FR-018 lists, tagged with the story that writes it. */
export interface CombatDiagnostics {
  weapon: WeaponKind; // US1: the active weapon
  ammo: AmmoCounts; // US1: rounds per weapon kind
  health: number; // US2
  score: number; // US2
  shotsFired: number; // US1: shots that left the barrel, refusals excluded
  hits: number; // US1: shots that resolved as `guard`
  kills: number; // US1
  pickupsCollected: number; // US3
  pickupsTotal: number; // US3: what the level declares
  treasureFound: number; // US3
  treasureTotal: number; // US3: what the level declares
  dead: boolean; // US2: whether the run is over
  deaths: number; // US2: survives a restart
  restarts: number; // US2: survives a restart
  muzzleFlash: number; // US4: intensity, zero at rest
  hudReady: boolean; // US4: every displayed value has a defined source
}

/** One list for the smoke harness to check the published object against. */
export const COMBAT_DIAGNOSTIC_FIELDS = [
  'weapon', 'ammo', 'health', 'score', 'shotsFired', 'hits', 'kills', 'pickupsCollected',
  'pickupsTotal', 'treasureFound', 'treasureTotal', 'dead', 'deaths', 'restarts', 'muzzleFlash',
  'hudReady',
] as const satisfies readonly (keyof CombatDiagnostics)[];

declare module '../diag/diag' {
  interface Diagnostics {
    combat?: CombatDiagnostics;
  }
}

export function createCombatDiagnostics(): CombatDiagnostics {
  return {
    weapon: DEFAULT_WEAPON,
    ammo: { pistol: 0, smg: 0, chaingun: 0 },
    health: 0, score: 0, shotsFired: 0, hits: 0, kills: 0,
    pickupsCollected: 0, pickupsTotal: 0, treasureFound: 0, treasureTotal: 0,
    dead: false, deaths: 0, restarts: 0, muzzleFlash: 0, hudReady: false,
  };
}

/** Idempotent, so four systems may each ensure it without resetting the rest. */
export function ensureCombatDiag(diag: Diagnostics): CombatDiagnostics {
  diag.combat ??= createCombatDiagnostics();
  return diag.combat;
}

/** By copy, never by reference: not a second handle on the run state. */
export function publishAmmo(combat: CombatDiagnostics, ammo: Readonly<AmmoCounts>): void {
  combat.ammo = { pistol: ammo.pistol, smg: ammo.smg, chaingun: ammo.chaingun };
}
