// The `window.__diag.combat` shape (FR-018), attached to 001's Diagnostics by
// module augmentation rather than by editing `src/diag/diag.ts`. Pure: no DOM,
// no three.js.
//
// The whole field set is declared here, zeroed, by US1 — including the fields
// US1 never writes. That is deliberate and it is structural: `src/diag/diag.ts`
// is the file 002 through 006 each extended, and four more stories extending it
// would put four diffs on adjacent lines of one file. Declaring the complete
// shape once means US2, US3 and US4 write into fields that already exist and
// none of them reopens this contract.

import type { Diagnostics } from '../diag/diag';
import { DEFAULT_WEAPON } from './weapons';
import type { WeaponKind } from './weapons';

/** Rounds held per weapon kind. */
export type AmmoCounts = Record<WeaponKind, number>;

export interface CombatDiagnostics {
  /** The active weapon (US1). */
  weapon: WeaponKind;
  /** Rounds per weapon kind (US1). */
  ammo: AmmoCounts;
  /** Player health (US2). */
  health: number;
  /** Run score (US2). */
  score: number;
  /** Shots that left the barrel, refusals excluded (US1). */
  shotsFired: number;
  /** Shots that resolved as `guard` (US1). */
  hits: number;
  /** Guards this run has killed (US1). */
  kills: number;
  /** Pickups collected (US3). */
  pickupsCollected: number;
  /** Pickups the level declares (US3). */
  pickupsTotal: number;
  /** Treasure collected (US3). */
  treasureFound: number;
  /** Treasure the level declares (US3). */
  treasureTotal: number;
  /** Whether the run is over (US2). */
  dead: boolean;
  /** Deaths this session — survives a restart (US2). */
  deaths: number;
  /** Completed restarts this session — survives a restart (US2). */
  restarts: number;
  /** Muzzle-flash intensity, zero at rest (US4). */
  muzzleFlash: number;
  /** Whether every value the HUD displays has a defined source (US4). */
  hudReady: boolean;
}

/** The declared field set, so a story that adds a field adds it here too and the
 *  smoke harness has one list to check the published object against (FR-018). */
export const COMBAT_DIAGNOSTIC_FIELDS = [
  'weapon',
  'ammo',
  'health',
  'score',
  'shotsFired',
  'hits',
  'kills',
  'pickupsCollected',
  'pickupsTotal',
  'treasureFound',
  'treasureTotal',
  'dead',
  'deaths',
  'restarts',
  'muzzleFlash',
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
    health: 0,
    score: 0,
    shotsFired: 0,
    hits: 0,
    kills: 0,
    pickupsCollected: 0,
    pickupsTotal: 0,
    treasureFound: 0,
    treasureTotal: 0,
    dead: false,
    deaths: 0,
    restarts: 0,
    muzzleFlash: 0,
    hudReady: false,
  };
}

/** Zero-initialised and idempotent, so four systems can each ensure it without
 *  resetting one another's writes. */
export function ensureCombatDiag(diag: Diagnostics): CombatDiagnostics {
  diag.combat ??= createCombatDiagnostics();
  return diag.combat;
}

/** Copies the live magazine into the published object. By copy, never by
 *  reference: the diagnostics object must not become a second handle on the
 *  state a restart resets. */
export function publishAmmo(combat: CombatDiagnostics, ammo: Readonly<AmmoCounts>): void {
  combat.ammo = { pistol: ammo.pistol, smg: ammo.smg, chaingun: ammo.chaingun };
}
