// FR-011: a locked door whose key lies behind it is an unwinnable map, and the
// validator should say so by name rather than let a player discover it forty tiles
// in. Pure, and the grid arrives in the context, so a fixture is testable.

import type { LevelError } from '../../level-validate';
import type { LevelRule, LevelRuleContext } from '../level-rules';
import { pickupKind } from '../pickups';
import type { KeyKind } from '../keys';

declare module '../level-rules' {
  interface ExtraRuleCategories {
    'key-placement': true;
  }
}

// The same walkable set 002's reachability uses. A door is crossed by the flood
// because it is a door, not a wall — which is exactly why the door under test has
// to be excluded explicitly.
const isWalkable = (cell: string): boolean =>
  cell === '0' || cell === 'D' || cell === 'S' || cell === 'E';

const cellAt = (grid: readonly string[], x: number, z: number): string => grid[z]?.[x] ?? ' ';

/** 002's 4-neighbour flood from the spawn, with one tile treated as solid. */
function reachableFrom(
  grid: readonly string[],
  startX: number,
  startZ: number,
  blockedX: number,
  blockedZ: number,
): Set<string> {
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;
  const visited = new Set<string>();
  if (!isWalkable(cellAt(grid, startX, startZ))) return visited;

  const queue: Array<[number, number]> = [[startX, startZ]];
  visited.add(`${startX},${startZ}`);
  while (queue.length > 0) {
    const [x, z] = queue.shift()!;
    const neighbours: Array<[number, number]> = [
      [x + 1, z],
      [x - 1, z],
      [x, z + 1],
      [x, z - 1],
    ];
    for (const [nx, nz] of neighbours) {
      if (nx < 0 || nx >= cols || nz < 0 || nz >= rows) continue;
      if (nx === blockedX && nz === blockedZ) continue;
      const key = `${nx},${nz}`;
      if (visited.has(key) || !isWalkable(cellAt(grid, nx, nz))) continue;
      visited.add(key);
      queue.push([nx, nz]);
    }
  }
  return visited;
}

function lockedDoorTiles(
  grid: readonly string[],
  doorLocks: Readonly<Record<string, KeyKind | 'none'>>,
): Array<{ x: number; z: number; lock: KeyKind }> {
  const doors: Array<{ x: number; z: number; lock: KeyKind }> = [];
  for (let z = 0; z < grid.length; z += 1) {
    const row = grid[z] ?? '';
    for (let x = 0; x < row.length; x += 1) {
      if (row[x] !== 'D') continue;
      const lock = doorLocks[`${x},${z}`];
      if (lock === 'silver' || lock === 'gold') doors.push({ x, z, lock });
    }
  }
  return doors;
}

export const keyPlacementRule: LevelRule = (context: LevelRuleContext): LevelError[] => {
  const { grid, playerSpawn, itemSpawns, doorLocks } = context;
  const errors: LevelError[] = [];

  for (const door of lockedDoorTiles(grid, doorLocks)) {
    const reachable = reachableFrom(grid, playerSpawn.x, playerSpawn.z, door.x, door.z);
    const found = itemSpawns.some(
      (spawn) => pickupKind(spawn.kind) === door.lock && reachable.has(`${spawn.x},${spawn.z}`),
    );
    if (found) continue;
    errors.push({
      category: 'key-placement',
      x: door.x,
      z: door.z,
      message:
        `key-placement: door at (${door.x},${door.z}) is locked to '${door.lock}' but no ` +
        `${door.lock} key pickup is reachable from the player spawn at ` +
        `(${playerSpawn.x},${playerSpawn.z}) without passing through it`,
    });
  }

  return errors;
};

export const rule = keyPlacementRule;
