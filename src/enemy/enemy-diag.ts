// What the renderer costs, added to 001's Diagnostics by module augmentation — 003's
// and 004's idiom — so FR-011's "extended additively" holds by construction and
// `src/diag/diag.ts` is not opened a second time. US3 already declares `enemies`,
// `enemiesAlive` and `enemySpawnErrors` there; this story adds only its own field.
//
// It exists so US4-S7 and US4-S8 are read as numbers rather than inferred from a
// frame time: `sheets` counts guard *types*, `drawn` excludes a guard the frustum
// rejected.

import type { Diagnostics } from '../diag/diag';

export interface EnemyBillboardDiagnostic {
  sheets: number;
  textures: number;
  drawn: number;
  total: number;
}

declare module '../diag/diag' {
  interface Diagnostics {
    enemyBillboards?: EnemyBillboardDiagnostic;
  }
}

export function ensureEnemyDiag(diag: Diagnostics): Diagnostics {
  if (diag.enemyBillboards == null) {
    diag.enemyBillboards = { sheets: 0, textures: 0, drawn: 0, total: 0 };
  }
  return diag;
}
