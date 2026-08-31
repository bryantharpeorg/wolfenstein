// The `window.__diag.enemies` contract (FR-011), attached to the Diagnostics
// object 001 owns.
//
// It is added by TypeScript module augmentation rather than by editing
// `src/diag/diag.ts`, which is the idiom 003 and 004 already established here
// (`src/player/diag-player.ts`, `src/interaction/interaction-diag.ts`). That is
// what "extended additively without redefining any existing field" means as a
// mechanism rather than as an intention: no field 001, 002, 003, 004 or 005 owns
// is touched, and the shared file is not opened at all.
//
// Pure: no DOM, no three.js. The renderer fills these fields; nothing here
// knows what a renderer is.

import type { Diagnostics } from '../diag/diag';
import type { GuardState } from './states';

/** One guard as the diagnostics surface reports it. FR-011 fixes the three
 *  fields; a producer may carry more, and the smoke gate reads only these. */
export interface EnemyDiagnostic {
  /** The guard's state, from `./states.ts`. */
  state: GuardState;
  /** The sprite column `0..7` the viewer sees, written each frame by the
   *  billboard system (FR-010, US4-S4). */
  viewAngle: number;
  /** False once a path request for this guard came back unreachable. */
  pathable: boolean;
}

/** What the billboard renderer costs, so US4-S7 and US4-S8 are read as numbers
 *  rather than inferred from a frame time. */
export interface EnemyBillboardDiagnostic {
  /** Sprite sheets built — one per guard *type*, never one per guard. */
  sheets: number;
  /** Textures uploaded from those sheets. */
  textures: number;
  /** Billboards drawn this frame; a guard off-screen is not among them. */
  drawn: number;
  /** Billboards that exist at all, drawn or not. */
  total: number;
}

declare module '../diag/diag' {
  interface Diagnostics {
    enemies?: EnemyDiagnostic[];
    enemiesAlive?: number;
    enemyBillboards?: EnemyBillboardDiagnostic;
  }
}

/**
 * Attaches the enemy fields with their zero values and returns the diagnostics
 * object. Idempotent: a second call leaves whatever a producer has already
 * published in place, so two enemy systems cannot clear each other's records.
 */
export function ensureEnemyDiag(diag: Diagnostics): Diagnostics {
  if (diag.enemies == null) diag.enemies = [];
  if (diag.enemiesAlive == null) diag.enemiesAlive = 0;
  if (diag.enemyBillboards == null) {
    diag.enemyBillboards = { sheets: 0, textures: 0, drawn: 0, total: 0 };
  }
  return diag;
}

/** Guards that are not dead — the integer `__diag.enemiesAlive` carries. A guard
 *  whose death animation has finished still has a record and still contributes
 *  zero here, which is US4-S6. */
export function countAlive(enemies: readonly EnemyDiagnostic[]): number {
  let alive = 0;
  for (const enemy of enemies) {
    if (enemy.state !== 'death') alive += 1;
  }
  return alive;
}
