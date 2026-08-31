// FR-014: a push-wall that cannot clear its two tiles is a secret the player can
// never open, and `secretsFound` could then never reach `secretsTotal` — level
// completion would be unreachable by construction. The validator says so by name
// rather than let a headless run discover it as a stuck counter.
//
// A new file in the `rules/` directory US2's glob already discovers, so neither
// the collector nor 002's level module is edited to add it.

import type { LevelError } from '../../level-validate';
import type { LevelRule, LevelRuleContext } from '../level-rules';
import { isSecretPathClear, resolvePushAxis } from '../secret-field';
import { SECRET_TRAVEL_TILES } from '../params';
import type { SecretAxis, SecretDirection } from '../secret';

declare module '../level-rules' {
  interface ExtraRuleCategories {
    'secret-placement': true;
  }
}

const DIRECTIONS: readonly SecretDirection[] = [1, -1];

const step = (x: number, z: number, axis: SecretAxis, direction: SecretDirection, steps: number) =>
  axis === 'x' ? { x: x + steps * direction, z } : { x, z: z + steps * direction };

/** How far a push would carry this wall before the path obstructs it. Mirrors the
 * runtime's own limit using the runtime's own predicate, so the validator and the
 * push agree rather than merely resemble. */
function travelLimit(
  grid: readonly string[],
  x: number,
  z: number,
  axis: SecretAxis,
  direction: SecretDirection,
): number {
  for (let steps = 1; steps <= SECRET_TRAVEL_TILES; steps += 1) {
    const tile = step(x, z, axis, direction, steps);
    if (!isSecretPathClear(grid, tile.x, tile.z)) return steps - 1;
  }
  return SECRET_TRAVEL_TILES;
}

/** A player can only push from a tile they can stand on, so a side walled off is
 * a side no push ever comes from. */
function canPushFrom(
  grid: readonly string[],
  x: number,
  z: number,
  axis: SecretAxis,
  direction: SecretDirection,
): boolean {
  const stand = step(x, z, axis, direction, -1);
  return isSecretPathClear(grid, stand.x, stand.z);
}

export const secretPlacementRule: LevelRule = ({ grid }: LevelRuleContext): LevelError[] => {
  const errors: LevelError[] = [];

  for (let z = 0; z < grid.length; z += 1) {
    const row = grid[z] ?? '';
    for (let x = 0; x < row.length; x += 1) {
      if (row[x] !== 'S') continue;
      const axis = resolvePushAxis(grid, x, z);
      const reachable = DIRECTIONS.filter((direction) => canPushFrom(grid, x, z, axis, direction));

      if (reachable.length === 0) {
        errors.push({
          category: 'secret-placement',
          x,
          z,
          message:
            `secret-placement: secret at (${x},${z}) cannot be pushed from either side of its ` +
            `${axis} axis, so its ${SECRET_TRAVEL_TILES}-tile path can never clear`,
        });
        continue;
      }

      // One error per secret, naming the first approach whose path is short: two
      // errors for one tile would be the same defect reported twice.
      const short = reachable
        .map((direction) => ({ direction, limit: travelLimit(grid, x, z, axis, direction) }))
        .find((candidate) => candidate.limit < SECRET_TRAVEL_TILES);
      if (short == null) continue;

      errors.push({
        category: 'secret-placement',
        x,
        z,
        message:
          `secret-placement: secret at (${x},${z}) pushed along ` +
          `${short.direction > 0 ? '+' : '-'}${axis} halts after ${short.limit} of ` +
          `${SECRET_TRAVEL_TILES} tiles, ${SECRET_TRAVEL_TILES - short.limit} short of clearing`,
      });
    }
  }

  return errors;
};

export const rule = secretPlacementRule;
