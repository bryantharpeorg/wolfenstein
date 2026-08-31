// The `window.__diag.enemies` contract (FR-011), attached to 001's Diagnostics by
// module augmentation rather than by editing `src/diag/diag.ts` — 003's and 004's
// idiom. That makes "extended additively without redefining any existing field" a
// mechanism rather than an intention: the shared file is not opened at all.

import type { Diagnostics } from '../diag/diag';
import type { GuardState } from './states';

/** FR-011 fixes these three fields; a producer may carry more, and the smoke gate
 *  reads only these. */
export interface EnemyDiagnostic {
  state: GuardState;
  viewAngle: number;
  pathable: boolean;
}

/** What the renderer costs, so US4-S7 and US4-S8 are read as numbers rather than
 *  inferred from a frame time: `sheets` counts guard *types*, `drawn` excludes a
 *  guard that is off-screen. */
export interface EnemyBillboardDiagnostic {
  sheets: number;
  textures: number;
  drawn: number;
  total: number;
}

declare module '../diag/diag' {
  interface Diagnostics {
    enemies?: EnemyDiagnostic[];
    enemiesAlive?: number;
    enemyBillboards?: EnemyBillboardDiagnostic;
  }
}

export function ensureEnemyDiag(diag: Diagnostics): Diagnostics {
  if (diag.enemies == null) diag.enemies = [];
  if (diag.enemiesAlive == null) diag.enemiesAlive = 0;
  if (diag.enemyBillboards == null) diag.enemyBillboards = { sheets: 0, textures: 0, drawn: 0, total: 0 };
  return diag;
}

/** A guard whose death animation has finished still has a record and still
 *  contributes zero here, which is US4-S6. */
export function countAlive(enemies: readonly EnemyDiagnostic[]): number {
  let alive = 0;
  for (const enemy of enemies) if (enemy.state !== 'death') alive += 1;
  return alive;
}
