// Validator for the level grid. Pure: no three.js, no DOM (FR-004). It refuses
// a malformed map before any geometry is built from it, returning named errors
// with coordinates rather than throwing (FR-005).

import {
  LEVEL_GRID,
  GRID_SIZE,
  PLAYER_SPAWN,
  ENEMY_SPAWNS,
  ITEM_SPAWNS,
  DOOR_LOCKS,
  WALL_MATERIALS,
  type PlayerSpawn,
  type TileCoord,
  type ItemSpawn,
  type LockKind,
  type WallMaterial,
} from './level';
import { extraLevelErrors, type ExtraErrorCategory } from './interaction/level-rules';

// The categories this file declares, plus whatever the discovered rules declare
// for themselves (`src/interaction/level-rules.ts`). A later story adds a rule
// as a new file rather than by widening this union.
export type ErrorCategory =
  | 'dimensions'
  | 'exit'
  | 'spawn'
  | 'lock'
  | 'material'
  | 'reachability'
  | 'door-placement'
  | ExtraErrorCategory;

export interface LevelError {
  category: ErrorCategory;
  message: string;
  x?: number;
  z?: number;
}

export interface LevelCounts {
  floorTiles: number;
  wallTilesByType: Record<string, number>;
  doorTiles: number;
  secretTiles: number;
  exitTiles: number;
}

export interface ValidationReport {
  valid: boolean;
  errors: LevelError[];
  counts: LevelCounts;
}

export interface ValidateLevelOptions {
  playerSpawn?: PlayerSpawn;
  enemySpawns?: TileCoord[];
  itemSpawns?: ItemSpawn[];
  doorLocks?: Record<string, LockKind>;
  wallMaterials?: Record<string, WallMaterial>;
}

function cellAt(grid: string[], x: number, z: number): string {
  const row = grid[z];
  if (row === undefined) return ' ';
  return row[x] ?? ' ';
}

function isWall(cell: string): boolean {
  return cell >= '1' && cell <= '9';
}

function isWalkable(cell: string): boolean {
  return cell === '0' || cell === 'D' || cell === 'S' || cell === 'E';
}

function coord(x: number, z: number): string {
  return `(${x},${z})`;
}

function computeCounts(grid: string[]): LevelCounts {
  const counts: LevelCounts = {
    floorTiles: 0,
    wallTilesByType: {},
    doorTiles: 0,
    secretTiles: 0,
    exitTiles: 0,
  };
  for (const row of grid) {
    for (const cell of row) {
      if (cell === '0') counts.floorTiles += 1;
      else if (isWall(cell)) counts.wallTilesByType[cell] = (counts.wallTilesByType[cell] ?? 0) + 1;
      else if (cell === 'D') counts.doorTiles += 1;
      else if (cell === 'S') counts.secretTiles += 1;
      else if (cell === 'E') counts.exitTiles += 1;
    }
  }
  return counts;
}

function findCells(
  grid: string[],
  predicate: (cell: string) => boolean,
): Array<{ x: number; z: number }> {
  const found: Array<{ x: number; z: number }> = [];
  for (let z = 0; z < grid.length; z += 1) {
    const rowLength = grid[z]?.length ?? 0;
    for (let x = 0; x < rowLength; x += 1) {
      if (predicate(cellAt(grid, x, z))) found.push({ x, z });
    }
  }
  return found;
}

function hasSolidBorder(grid: string[]): boolean {
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;
  for (let x = 0; x < cols; x += 1) {
    if (cellAt(grid, x, 0) === '0') return false;
    if (cellAt(grid, x, rows - 1) === '0') return false;
  }
  for (let z = 0; z < rows; z += 1) {
    if (cellAt(grid, 0, z) === '0') return false;
    if (cellAt(grid, cols - 1, z) === '0') return false;
  }
  return true;
}

function hasOppositeSolidWalls(grid: string[], x: number, z: number): boolean {
  const north = isWall(cellAt(grid, x, z - 1));
  const south = isWall(cellAt(grid, x, z + 1));
  const east = isWall(cellAt(grid, x + 1, z));
  const west = isWall(cellAt(grid, x - 1, z));
  const solidCount = [north, south, east, west].filter(Boolean).length;
  if (solidCount !== 2) return false;
  return (north && south && !east && !west) || (!north && !south && east && west);
}

function isReachable(
  grid: string[],
  startX: number,
  startZ: number,
  targetX: number,
  targetZ: number,
): boolean {
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;
  const visited = new Set<number>();
  const queue: Array<[number, number]> = [[startX, startZ]];
  visited.add(startZ * cols + startX);
  while (queue.length > 0) {
    const [x, z] = queue.shift()!;
    if (x === targetX && z === targetZ) return true;
    const neighbors: Array<[number, number]> = [
      [x + 1, z],
      [x - 1, z],
      [x, z + 1],
      [x, z - 1],
    ];
    for (const [nx, nz] of neighbors) {
      if (nx < 0 || nx >= cols || nz < 0 || nz >= rows) continue;
      const key = nz * cols + nx;
      if (visited.has(key)) continue;
      if (!isWalkable(cellAt(grid, nx, nz))) continue;
      visited.add(key);
      queue.push([nx, nz]);
    }
  }
  return false;
}

export function validateLevel(
  grid: string[] = LEVEL_GRID,
  options: ValidateLevelOptions = {},
): ValidationReport {
  const playerSpawn = options.playerSpawn ?? PLAYER_SPAWN;
  const enemySpawns = options.enemySpawns ?? ENEMY_SPAWNS;
  const itemSpawns = options.itemSpawns ?? ITEM_SPAWNS;
  const doorLocks = options.doorLocks ?? DOOR_LOCKS;
  const wallMaterials = options.wallMaterials ?? WALL_MATERIALS;

  const errors: LevelError[] = [];
  const counts = computeCounts(grid);

  // 1. dimensions: square, 64x64, solid border. A structurally invalid grid is
  // refused here and no further checks run (the degenerate all-empty grid is a
  // dimensional failure, per the Edge Cases).
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;
  const square = rows > 0 && grid.every((row) => row.length === cols) && rows === cols;
  if (!square) {
    errors.push({
      category: 'dimensions',
      message: `dimensions: grid is not square (${rows} rows, ${cols} columns)`,
    });
  } else if (rows !== GRID_SIZE) {
    errors.push({
      category: 'dimensions',
      message: `dimensions: grid must be ${GRID_SIZE}x${GRID_SIZE}, got ${rows}x${rows}`,
    });
  } else if (!hasSolidBorder(grid)) {
    errors.push({
      category: 'dimensions',
      message: 'dimensions: outer border is not solid (every outer tile must be non-empty)',
    });
  }

  if (errors.length > 0) {
    return { valid: false, errors, counts };
  }

  // 2. exit: exactly one E, citing every offending coordinate.
  const exitCells = findCells(grid, (c) => c === 'E');
  if (exitCells.length !== 1) {
    const coords = exitCells.map((c) => coord(c.x, c.z)).join(', ');
    errors.push({
      category: 'exit',
      message: `exit: expected exactly 1 exit, found ${exitCells.length}${
        coords ? ` (at ${coords})` : ''
      }`,
    });
  }

  // 3. spawn placement on empty tiles.
  const playerCell = cellAt(grid, playerSpawn.x, playerSpawn.z);
  if (playerCell !== '0') {
    errors.push({
      category: 'spawn',
      x: playerSpawn.x,
      z: playerSpawn.z,
      message: `spawn: player spawn at ${coord(playerSpawn.x, playerSpawn.z)} is on a non-empty tile '${playerCell}'`,
    });
  }
  for (const enemy of enemySpawns) {
    const cell = cellAt(grid, enemy.x, enemy.z);
    if (cell !== '0') {
      errors.push({
        category: 'spawn',
        x: enemy.x,
        z: enemy.z,
        message: `spawn: enemy spawn at ${coord(enemy.x, enemy.z)} is on a non-empty tile '${cell}'`,
      });
    }
  }
  for (const item of itemSpawns) {
    const cell = cellAt(grid, item.x, item.z);
    if (cell !== '0') {
      errors.push({
        category: 'spawn',
        x: item.x,
        z: item.z,
        message: `spawn: item spawn at ${coord(item.x, item.z)} is on a non-empty tile '${cell}'`,
      });
    }
  }

  // 4. lock-table entry for every D tile.
  for (const door of findCells(grid, (c) => c === 'D')) {
    if (doorLocks[`${door.x},${door.z}`] === undefined) {
      errors.push({
        category: 'lock',
        x: door.x,
        z: door.z,
        message: `lock: door at ${coord(door.x, door.z)} has no lock-table entry`,
      });
    }
  }

  // 5. material entry for every wall type ID present.
  for (const wall of findCells(grid, isWall)) {
    const id = cellAt(grid, wall.x, wall.z);
    if (wallMaterials[id] === undefined) {
      errors.push({
        category: 'material',
        x: wall.x,
        z: wall.z,
        message: `material: wall type '${id}' at ${coord(wall.x, wall.z)} has no material entry`,
      });
    }
  }

  // 6. door-placement: every D and S must have solid tiles on exactly two
  // opposite sides, forming a one-tile-thick wall.
  for (const cell of findCells(grid, (c) => c === 'D' || c === 'S')) {
    if (!hasOppositeSolidWalls(grid, cell.x, cell.z)) {
      const kind = cellAt(grid, cell.x, cell.z) === 'D' ? 'door' : 'secret';
      errors.push({
        category: 'door-placement',
        x: cell.x,
        z: cell.z,
        message: `door-placement: ${kind} at ${coord(cell.x, cell.z)} does not have solid tiles on exactly two opposite sides`,
      });
    }
  }

  // 7. reachability: a 4-neighbour flood from the player spawn across empty,
  // door and secret tiles must reach the exit. Skipped when the exit count is
  // wrong (already reported) or the spawn is not on an empty tile (already
  // reported).
  if (exitCells.length === 1 && playerCell === '0') {
    const exit = exitCells[0]!;
    if (!isReachable(grid, playerSpawn.x, playerSpawn.z, exit.x, exit.z)) {
      errors.push({
        category: 'reachability',
        x: playerSpawn.x,
        z: playerSpawn.z,
        message: `reachability: player spawn at ${coord(playerSpawn.x, playerSpawn.z)} cannot reach the exit at ${coord(exit.x, exit.z)}`,
      });
    }
  }

  // 8. every rule discovered under `src/interaction/rules/` — FR-011's key
  // placement and, later, FR-014's secret placement. One call, no index.
  errors.push(...extraLevelErrors({ grid, playerSpawn, itemSpawns, doorLocks }));

  return { valid: errors.length === 0, errors, counts };
}
