import { describe, it, expect } from 'vitest';
import { validateLevel } from '../../src/level-validate';
import { buildLevelGeometry, LevelBuildError } from '../../src/geometry/build';
import { LEVEL_GRID, GRID_SIZE, PLAYER_SPAWN, ENEMY_SPAWNS, ITEM_SPAWNS } from '../../src/level';

function cloneGrid(): string[] {
  return LEVEL_GRID.map((row) => row);
}

function setCell(grid: string[], x: number, z: number, cell: string): void {
  const row = grid[z]!;
  grid[z] = row.slice(0, x) + cell + row.slice(x + 1);
}

function findExit(grid: string[]): { x: number; z: number } | null {
  for (let z = 0; z < grid.length; z += 1) {
    for (let x = 0; x < grid[z]!.length; x += 1) {
      if (grid[z]![x] === 'E') return { x, z };
    }
  }
  return null;
}

function makeBorderedGrid(size: number): string[] {
  const grid: string[] = [];
  for (let z = 0; z < size; z += 1) {
    let row = '';
    for (let x = 0; x < size; x += 1) {
      row += x === 0 || x === size - 1 || z === 0 || z === size - 1 ? '1' : '0';
    }
    grid.push(row);
  }
  return grid;
}

describe('validateLevel', () => {
  it('accepts the shipped layout with no errors and reports counts', () => {
    const report = validateLevel();
    expect(report.valid).toBe(true);
    expect(report.errors).toEqual([]);
    expect(report.counts.floorTiles).toBeGreaterThan(0);
    expect(report.counts.doorTiles).toBeGreaterThanOrEqual(4);
    expect(report.counts.secretTiles).toBeGreaterThanOrEqual(2);
    expect(report.counts.exitTiles).toBe(1);
    const wallIds = Object.keys(report.counts.wallTilesByType);
    expect(wallIds.length).toBeGreaterThanOrEqual(4);
    for (const id of wallIds) {
      expect(report.counts.wallTilesByType[id]).toBeGreaterThan(0);
    }
  });

  it('reports an exit error for a grid with zero E cells', () => {
    const grid = cloneGrid();
    const exit = findExit(grid);
    expect(exit).not.toBeNull();
    setCell(grid, exit!.x, exit!.z, '0');
    const report = validateLevel(grid);
    expect(report.errors.some((e) => e.category === 'exit')).toBe(true);
  });

  it('reports an exit error citing both coordinates for two E cells', () => {
    const grid = cloneGrid();
    const exit = findExit(grid);
    expect(exit).not.toBeNull();
    setCell(grid, exit!.x, exit!.z, '0');
    setCell(grid, 5, 5, 'E');
    setCell(grid, 50, 50, 'E');
    const report = validateLevel(grid);
    const exitErrors = report.errors.filter((e) => e.category === 'exit');
    expect(exitErrors.length).toBeGreaterThan(0);
    const message = exitErrors.map((e) => e.message).join(' ');
    expect(message).toContain('(5,5)');
    expect(message).toContain('(50,50)');
  });

  it('reports a dimensions error for a non-square grid', () => {
    const grid = cloneGrid();
    grid[0] = grid[0]!.slice(0, -1);
    const report = validateLevel(grid);
    expect(report.errors.some((e) => e.category === 'dimensions')).toBe(true);
  });

  it('reports a dimensions error for a square grid that is not 64x64', () => {
    const grid = makeBorderedGrid(32);
    setCell(grid, 16, 16, 'E');
    const report = validateLevel(grid);
    expect(report.errors.some((e) => e.category === 'dimensions')).toBe(true);
  });

  it('reports a dimensions error for the degenerate all-empty grid', () => {
    const grid: string[] = [];
    for (let z = 0; z < GRID_SIZE; z += 1) {
      grid.push('0'.repeat(GRID_SIZE));
    }
    const report = validateLevel(grid);
    expect(report.errors.some((e) => e.category === 'dimensions')).toBe(true);
  });

  it('reports a door-placement error for a D with four empty neighbours', () => {
    const grid = cloneGrid();
    setCell(grid, 30, 30, 'D');
    const report = validateLevel(grid);
    expect(report.errors.some((e) => e.category === 'door-placement')).toBe(true);
  });

  it('reports a spawn error for a spawn on a non-empty tile', () => {
    const grid = cloneGrid();
    setCell(grid, PLAYER_SPAWN.x, PLAYER_SPAWN.z, '1');
    const report = validateLevel(grid);
    expect(report.errors.some((e) => e.category === 'spawn')).toBe(true);
  });

  it('reports a spawn error for an enemy or item spawn on a non-empty tile', () => {
    const grid = cloneGrid();
    const enemy = ENEMY_SPAWNS[0]!;
    const item = ITEM_SPAWNS[0]!;
    setCell(grid, enemy.x, enemy.z, '1');
    setCell(grid, item.x, item.z, '1');
    const report = validateLevel(grid);
    const spawnErrors = report.errors.filter((e) => e.category === 'spawn');
    expect(spawnErrors.length).toBeGreaterThanOrEqual(2);
    const messages = spawnErrors.map((e) => e.message).join(' ');
    expect(messages).toContain(`(${enemy.x},${enemy.z})`);
    expect(messages).toContain(`(${item.x},${item.z})`);
  });

  it('reports a lock error for a door with no lock-table entry', () => {
    const grid = cloneGrid();
    // (21,31) is an open doorway in the brick wall; turning it into a door
    // keeps valid wall-adjacency but has no entry in the shipped lock table.
    setCell(grid, 21, 31, 'D');
    const report = validateLevel(grid);
    expect(report.errors.some((e) => e.category === 'lock')).toBe(true);
  });

  it('reports a material error for a wall type ID with no material entry', () => {
    const grid = cloneGrid();
    setCell(grid, 30, 30, '9');
    const report = validateLevel(grid);
    expect(report.errors.some((e) => e.category === 'material')).toBe(true);
  });

  it('reports a reachability error when the spawn cannot reach the exit', () => {
    const grid = makeBorderedGrid(GRID_SIZE);
    setCell(grid, PLAYER_SPAWN.x - 1, PLAYER_SPAWN.z, '1');
    setCell(grid, PLAYER_SPAWN.x + 1, PLAYER_SPAWN.z, '1');
    setCell(grid, PLAYER_SPAWN.x, PLAYER_SPAWN.z - 1, '1');
    setCell(grid, PLAYER_SPAWN.x, PLAYER_SPAWN.z + 1, '1');
    setCell(grid, 55, 55, 'E');
    const report = validateLevel(grid);
    expect(report.errors.some((e) => e.category === 'reachability')).toBe(true);
  });

  it('builds geometry without throwing for the valid shipped layout', () => {
    expect(() => buildLevelGeometry()).not.toThrow();
  });

  it('throws from geometry building for a grid with zero E cells', () => {
    const grid = cloneGrid();
    const exit = findExit(grid);
    expect(exit).not.toBeNull();
    setCell(grid, exit!.x, exit!.z, '0');
    expect(() => buildLevelGeometry(grid)).toThrow(LevelBuildError);
    try {
      buildLevelGeometry(grid);
    } catch (error) {
      expect(error).toBeInstanceOf(LevelBuildError);
      const report = (error as LevelBuildError).report;
      expect(report.errors.some((e) => e.category === 'exit')).toBe(true);
    }
  });
});
