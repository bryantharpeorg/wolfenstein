// The enemies smoke check (T027, FR-006, FR-011, SC-004): six to ten guards are
// alive in the built page, the count matches the level's own marker table, and no
// spawn marker landed on a wall.
//
// The marker count is re-read out of `src/level.ts` here rather than taken from
// the page, so this check proves the page agrees with the level file instead of
// agreeing with itself — the same trick `tools/smoke.mjs` uses for the tile
// counts.
//
// `enemySpawnErrors` is why this file exists at all. A marker on a wall cell is a
// *named* fault with coordinates, not a thrown exception, so it would never reach
// `__diag.errors`; failing the gate on it here is what gives FR-006's requirement
// teeth without borrowing 001's array.

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

  // FR-006: at least six guards, at most ten, and every one of them alive at spawn.
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

  // FR-011's per-guard shape, asserted field by field so US4 finds it already there.
  diag.enemies.forEach((entry, index) => {
    if (typeof entry?.state !== 'string') {
      errors.push(`__diag.enemies[${index}].state is not a string: ${JSON.stringify(entry?.state)}`);
    }
    if (!Number.isFinite(entry?.viewAngle)) {
      errors.push(`__diag.enemies[${index}].viewAngle is not a number: ${JSON.stringify(entry?.viewAngle)}`);
    }
    if (typeof entry?.pathable !== 'boolean') {
      errors.push(`__diag.enemies[${index}].pathable is not a boolean: ${JSON.stringify(entry?.pathable)}`);
    }
  });

  return errors;
}
