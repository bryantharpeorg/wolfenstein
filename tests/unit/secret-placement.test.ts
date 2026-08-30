import { describe, it, expect } from 'vitest';
import { validateLevel } from '../../src/level-validate';
import { LEVEL_GRID, GRID_SIZE, PLAYER_SPAWN, ITEM_SPAWNS, DOOR_LOCKS } from '../../src/level';
import { collectLevelRules, discoveredRuleModules, extraLevelErrors } from '../../src/interaction/level-rules';
import { secretPlacementRule } from '../../src/interaction/rules/secret-placement';

// A 64x64 fixture: an open room, one horizontal wall band at z=32, and a secret
// in it. The band is thick enough on the south side to obstruct the push when the
// test asks for it, so the only variable is the secret's travel path.
const SPAWN = { x: 5, z: 5, yaw: 0 };

function room(mutate: (grid: string[]) => void): string[] {
  const grid: string[] = [];
  for (let z = 0; z < GRID_SIZE; z += 1) {
    let row = '';
    for (let x = 0; x < GRID_SIZE; x += 1) {
      row += x === 0 || x === GRID_SIZE - 1 || z === 0 || z === GRID_SIZE - 1 ? '1' : '0';
    }
    grid.push(row);
  }
  const put = (x: number, z: number, cell: string): void => {
    const row = grid[z]!;
    grid[z] = row.slice(0, x) + cell + row.slice(x + 1);
  };
  // The exit, so 002's own rules stay quiet and only this rule's errors remain.
  put(50, 50, 'E');
  // The one-tile-thick wall the secret sits in: solid on its two x neighbours.
  put(9, 32, '1');
  put(11, 32, '1');
  put(10, 32, 'S');
  mutate(grid);
  return grid;
}

const put = (grid: string[], x: number, z: number, cell: string): void => {
  const row = grid[z]!;
  grid[z] = row.slice(0, x) + cell + row.slice(x + 1);
};

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
  it('is discovered by the collector US2 created', () => {
    expect(discoveredRuleModules).toContain('./rules/secret-placement.ts');
    expect(collectLevelRules()).toContain(secretPlacementRule);
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

  it('leaves the rules US2 discovered in place beside it', () => {
    expect(discoveredRuleModules).toContain('./rules/key-placement.ts');
    expect(collectLevelRules().length).toBeGreaterThanOrEqual(2);
  });
});
