import { describe, it, expect } from 'vitest';
import { validateLevel } from '../../src/level-validate';
import { LEVEL_GRID, GRID_SIZE, PLAYER_SPAWN, ITEM_SPAWNS, DOOR_LOCKS } from '../../src/level';
import {
  collectLevelRules,
  discoveredRuleModules,
  extraLevelErrors,
} from '../../src/interaction/level-rules';
import { secretPlacementRule } from '../../src/interaction/rules/secret-placement';

const SPAWN = { x: 5, z: 5, yaw: 0 };

const put = (grid: string[], x: number, z: number, cell: string): void => {
  const row = grid[z]!;
  grid[z] = row.slice(0, x) + cell + row.slice(x + 1);
};

// A 64x64 fixture: an open room with a one-tile-thick wall band holding a secret at
// (10,32), solid on its two x neighbours. The exit keeps 002's own rules quiet, so
// only this rule's errors remain, and the one variable a case changes is the path.
function room(mutate: (grid: string[]) => void): string[] {
  const edge = (n: number) => n === 0 || n === GRID_SIZE - 1;
  const grid = Array.from({ length: GRID_SIZE }, (_unused, z) =>
    Array.from({ length: GRID_SIZE }, (_cell, x) => (edge(x) || edge(z) ? '1' : '0')).join(''),
  );
  for (const [x, z, cell] of [[50, 50, 'E'], [9, 32, '1'], [11, 32, '1'], [10, 32, 'S']] as const) {
    put(grid, x, z, cell);
  }
  mutate(grid);
  return grid;
}

const placementErrors = (grid: string[]) =>
  validateLevel(grid, {
    playerSpawn: SPAWN,
    enemySpawns: [],
    itemSpawns: [],
    doorLocks: {},
  }).errors.filter((error) => error.category === 'secret-placement');

describe('secret-placement rule (FR-014, US3-S6)', () => {
  it('reports nothing for a secret with two clear tiles on both sides', () => {
    expect(placementErrors(room(() => {}))).toEqual([]);
  });

  it('flags a secret whose 2-tile path is blocked at the first tile', () => {
    const errors = placementErrors(room((grid) => put(grid, 10, 33, '1')));
    expect(errors).toHaveLength(1);
    expect(errors[0]!.category).toBe('secret-placement');
    expect(errors[0]).toMatchObject({ x: 10, z: 32 });
    expect(errors[0]!.message).toContain('secret-placement');
    expect(errors[0]!.message).toContain('(10,32)');
  });

  it('flags a secret whose 2-tile path is blocked at the second tile', () => {
    const errors = placementErrors(room((grid) => put(grid, 10, 34, '1')));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ x: 10, z: 32 });
  });

  it('flags a secret whose path holds another secret', () => {
    const errors = placementErrors(
      room((grid) => {
        put(grid, 9, 34, '1');
        put(grid, 11, 34, '1');
        put(grid, 10, 34, 'S');
      }),
    );
    // Each secret stands two tiles from the other, so both paths are obstructed.
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors.some((error) => error.x === 10 && error.z === 32)).toBe(true);
  });

  it('flags a secret nobody can push, because both sides are walled in', () => {
    const errors = placementErrors(
      room((grid) => {
        put(grid, 10, 31, '1');
        put(grid, 10, 33, '1');
      }),
    );
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors[0]!.message).toContain('secret-placement');
  });

  it('reports no secret-placement error for the shipped layout', () => {
    const report = validateLevel(LEVEL_GRID, {
      playerSpawn: PLAYER_SPAWN,
      enemySpawns: [],
      itemSpawns: ITEM_SPAWNS,
      doorLocks: DOOR_LOCKS,
    });
    expect(report.errors.filter((error) => error.category === 'secret-placement')).toEqual([]);
    expect(report.valid).toBe(true);
  });
});

describe('the rule reaches validateLevel through the glob, not through an index', () => {
  it('is discovered by the collector US2 created, beside the rules it already had', () => {
    expect(discoveredRuleModules).toContain('./rules/secret-placement.ts');
    expect(discoveredRuleModules).toContain('./rules/key-placement.ts');
    expect(collectLevelRules()).toContain(secretPlacementRule);
    expect(collectLevelRules().length).toBeGreaterThanOrEqual(2);
  });

  it('contributes its errors through extraLevelErrors', () => {
    const grid = room((g) => put(g, 10, 33, '1'));
    const errors = extraLevelErrors({
      grid,
      playerSpawn: SPAWN,
      itemSpawns: [],
      doorLocks: {},
    }).filter((error) => error.category === 'secret-placement');
    expect(errors).toHaveLength(1);
  });
});
