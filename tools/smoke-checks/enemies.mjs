// The enemies smoke check (T027, FR-006, FR-011, SC-004): six to ten guards
// alive in the built page, as many as the level's own marker table declares, and
// no spawn marker on a wall. The marker count is re-read out of `src/level.ts`
// rather than taken from the page, so this proves the page agrees with the level
// file instead of with itself; and `enemySpawnErrors` never reaches
// `__diag.errors`, so failing the gate here is what gives FR-006 teeth.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const name = 'enemies';

/** The declared bounds, mirrored from `src/enemy/spawn.ts` deliberately: the
 *  harness asserts the requirement, not the constant the code happens to hold. */
const MIN_GUARDS = 6;
const MAX_GUARDS = 10;

/** Counts the `{ x, z }` entries of `ENEMY_SPAWNS` in the level source. */
function readMarkerCount(root) {
  const source = readFileSync(resolve(root, 'src/level.ts'), 'utf8');
  const table = source.match(/ENEMY_SPAWNS[^=]*=\s*\[([\s\S]*?)\];/);
  if (table == null) return null;
  const entries = table[1].match(/\{\s*x:\s*-?\d+\s*,\s*z:\s*-?\d+\s*\}/g);
  return entries == null ? 0 : entries.length;
}

export default async function check({ page, root }) {
  const errors = [];

  const diag = await page.evaluate(() => ({
    enemies: window.__diag.enemies,
    enemiesAlive: window.__diag.enemiesAlive,
    enemySpawnErrors: window.__diag.enemySpawnErrors,
  }));

  if (!Array.isArray(diag.enemies)) {
    errors.push(`__diag.enemies is not an array: ${JSON.stringify(diag.enemies)}`);
    return errors;
  }

  // FR-006: six to ten guards, every one of them alive at spawn, and as many as
  // the level file declares markers.
  if (diag.enemies.length < MIN_GUARDS || diag.enemies.length > MAX_GUARDS) {
    errors.push(
      `__diag.enemies.length is ${diag.enemies.length}, outside the required ${MIN_GUARDS}..${MAX_GUARDS}`,
    );
  }
  if (diag.enemiesAlive !== diag.enemies.length) {
    errors.push(
      `__diag.enemiesAlive is ${diag.enemiesAlive} but ${diag.enemies.length} guards were placed`,
    );
  }

  const markerCount = readMarkerCount(root);
  if (markerCount == null) {
    errors.push('could not find ENEMY_SPAWNS in src/level.ts');
  } else if (markerCount !== diag.enemies.length) {
    errors.push(
      `${diag.enemies.length} guards were instantiated from ${markerCount} spawn markers in src/level.ts`,
    );
  }

  // US3-S7: a marker on a wall cell names its own coordinates, and that is what
  // fails the gate — a stack trace would say less.
  if (!Array.isArray(diag.enemySpawnErrors)) {
    errors.push(`__diag.enemySpawnErrors is not an array: ${JSON.stringify(diag.enemySpawnErrors)}`);
  } else if (diag.enemySpawnErrors.length > 0) {
    errors.push(`__diag.enemySpawnErrors is non-empty: ${diag.enemySpawnErrors.join('; ')}`);
  }

  // FR-011's per-guard shape, so US4 finds it already there.
  diag.enemies.forEach((entry, index) => {
    const shape =
      typeof entry?.state === 'string' &&
      Number.isFinite(entry?.viewAngle) &&
      typeof entry?.pathable === 'boolean';
    if (!shape) {
      errors.push(`__diag.enemies[${index}] is not {state, viewAngle, pathable}: ${JSON.stringify(entry)}`);
    }
  });

  return errors;
}
