import { describe, it, expect } from 'vitest';
import { LEVEL_GRID, PLAYER_SPAWN } from '../../src/level';
import { findExitTile } from '../../src/run/elevator';
import {
  checkCompletable,
  openableTiles,
  PASSABLE_WHEN_OPENED,
} from '../../src/run/completable';

// T004 (FR-001, US1-S8, SC-001). The level is proved completable here, before a
// human ever plays it: a route from the shipped spawn to the shipped `E` tile
// over 006's pathing, across empty, open-door and opened-secret tiles.

const cellAt = (grid: readonly string[], x: number, z: number): string => grid[z]?.[x] ?? ' ';

describe('the shipped level is completable (US1-S8)', () => {
  it('has a path from the player spawn to the exit', () => {
    const result = checkCompletable();
    expect(result.completable).toBe(true);
    expect(result.path.length).toBeGreaterThan(0);
  });

  it('returns a route that starts at spawn, ends at the exit and never jumps', () => {
    const { path } = checkCompletable();
    const exit = findExitTile(LEVEL_GRID)!;

    expect(path[0]).toEqual({ x: PLAYER_SPAWN.x, z: PLAYER_SPAWN.z });
    expect(path[path.length - 1]).toEqual({ x: exit.x, z: exit.z });

    for (let i = 1; i < path.length; i += 1) {
      const previous = path[i - 1]!;
      const cell = path[i]!;
      expect(Math.abs(cell.x - previous.x) + Math.abs(cell.z - previous.z)).toBe(1);
    }
  });

  it('crosses only empty, door, secret and exit tiles', () => {
    for (const cell of checkCompletable().path) {
      expect(PASSABLE_WHEN_OPENED.includes(cellAt(LEVEL_GRID, cell.x, cell.z))).toBe(true);
    }
  });

  it('treats every door and secret tile of the grid as openable, and nothing else', () => {
    const openable = openableTiles(LEVEL_GRID);
    let doors = 0;
    let secrets = 0;
    for (let z = 0; z < LEVEL_GRID.length; z += 1) {
      for (let x = 0; x < LEVEL_GRID[z]!.length; x += 1) {
        const cell = cellAt(LEVEL_GRID, x, z);
        const key = `${x},${z}`;
        if (cell === 'D') doors += 1;
        if (cell === 'S') secrets += 1;
        expect(openable.has(key)).toBe(cell === 'D' || cell === 'S');
      }
    }
    expect(doors).toBeGreaterThan(0);
    expect(secrets).toBeGreaterThan(0);
    expect(openable.size).toBe(doors + secrets);
  });

  it('reports a walled-off exit as incomplete rather than throwing', () => {
    // The same check over a fixture whose exit is sealed: no route, no path, and
    // a `false` a caller can act on.
    const sealed = [
      '11111111',
      '10000001',
      '11111111',
      '1000E001',
      '11111111',
    ];
    const result = checkCompletable(sealed, { x: 1, z: 1 }, { x: 4, z: 3 });
    expect(result.completable).toBe(false);
    expect(result.path).toEqual([]);
  });

  it('finds a route through a fixture that only a door and a secret open', () => {
    // A corridor with a door at (2,1) and a secret at (4,1): both must be treated
    // as passable for the exit at (5,1) to be reachable at all.
    const gated = ['1111111', '10D0SE1', '1111111'];
    const result = checkCompletable(gated, { x: 1, z: 1 }, { x: 5, z: 1 });
    expect(result.completable).toBe(true);
    expect(result.path.some((cell) => cell.x === 2 && cell.z === 1)).toBe(true);
    expect(result.path.some((cell) => cell.x === 4 && cell.z === 1)).toBe(true);

    // The same corridor with the door tile walled shut has no route.
    const shut = ['1111111', '1010SE1', '1111111'];
    expect(checkCompletable(shut, { x: 1, z: 1 }, { x: 5, z: 1 }).completable).toBe(false);
  });
});
