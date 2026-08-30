import { describe, it, expect } from 'vitest';
import { validateLevel, type ValidateLevelOptions } from '../../src/level-validate';
import { LEVEL_GRID, GRID_SIZE, ITEM_SPAWNS, DOOR_LOCKS } from '../../src/level';
import { keyPlacementRule } from '../../src/interaction/rules/key-placement';
import { collectLevelRules, extraLevelErrors } from '../../src/interaction/level-rules';

// A 64x64 fixture: one wall column at x=32 pierced by a single door at (32,32),
// so everything east of the column is behind that door. The exit sits east too,
// which keeps 002's reachability green — the flood crosses door tiles, so it is
// the key that can be stranded, not the exit, and that is FR-011's whole point.
const WALL_X = 32;
const DOOR_Z = 32;
const SPAWN = { x: 5, z: 5, yaw: 0 };

function splitGrid(): string[] {
  const grid: string[] = [];
  for (let z = 0; z < GRID_SIZE; z += 1) {
    let row = '';
    for (let x = 0; x < GRID_SIZE; x += 1) {
      if (x === 0 || x === GRID_SIZE - 1 || z === 0 || z === GRID_SIZE - 1) row += '1';
      else if (x === WALL_X) row += z === DOOR_Z ? 'D' : '1';
      else row += '0';
    }
    grid.push(row);
  }
  const exitRow = grid[60]!;
  grid[60] = exitRow.slice(0, 50) + 'E' + exitRow.slice(51);
  return grid;
}

const keyPlacementErrors = (options: ValidateLevelOptions = {}) =>
  validateLevel(splitGrid(), {
    playerSpawn: SPAWN,
    enemySpawns: [],
    itemSpawns: [{ x: 50, z: 20, kind: 'gold-key' }],
    doorLocks: { [`${WALL_X},${DOOR_Z}`]: 'gold' },
    ...options,
  }).errors.filter((e) => e.category === 'key-placement');

describe('key-placement rule (FR-011, US2-S6)', () => {
  it('reports a named error when the key is behind the door it opens', () => {
    const errors = keyPlacementErrors();

    expect(errors).toHaveLength(1);
    expect(errors[0]?.x).toBe(WALL_X);
    expect(errors[0]?.z).toBe(DOOR_Z);
    expect(errors[0]?.category).toBe('key-placement');
    expect(errors[0]?.message).toContain('key-placement');
    expect(errors[0]?.message).toContain('gold');
  });

  it('reports the error when the locked kind has no pickup anywhere', () => {
    const errors = keyPlacementErrors({ itemSpawns: [{ x: 10, z: 20, kind: 'silver-key' }] });

    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toContain('gold');
  });

  it('reports nothing once the key is on the spawn side, or the door is unlocked', () => {
    expect(keyPlacementErrors({ itemSpawns: [{ x: 10, z: 20, kind: 'gold-key' }] })).toEqual([]);
    expect(keyPlacementErrors({ doorLocks: { [`${WALL_X},${DOOR_Z}`]: 'none' } })).toEqual([]);
  });

  it('leaves an otherwise valid fixture valid when the key is placed correctly', () => {
    const report = validateLevel(splitGrid(), {
      playerSpawn: SPAWN,
      enemySpawns: [],
      itemSpawns: [{ x: 10, z: 20, kind: 'gold-key' }],
      doorLocks: { [`${WALL_X},${DOOR_Z}`]: 'gold' },
    });

    expect(report.valid).toBe(true);
  });

  it('reports no key-placement error for the shipped layout, door by door', () => {
    const report = validateLevel();
    expect(report.errors.filter((e) => e.category === 'key-placement')).toEqual([]);
    expect(report.valid).toBe(true);

    const locked = Object.values(DOOR_LOCKS).filter((lock) => lock !== 'none');
    expect(locked.length).toBeGreaterThanOrEqual(2);
    expect(
      keyPlacementRule({
        grid: LEVEL_GRID,
        playerSpawn: { x: 10, z: 10, yaw: 0 },
        itemSpawns: ITEM_SPAWNS,
        doorLocks: DOOR_LOCKS,
      }),
    ).toEqual([]);
  });

  it('reaches the validator through the rules glob, not through an index edit', () => {
    expect(collectLevelRules()).toContain(keyPlacementRule);
    expect(
      extraLevelErrors({
        grid: splitGrid(),
        playerSpawn: SPAWN,
        itemSpawns: [{ x: 50, z: 20, kind: 'gold-key' }],
        doorLocks: { [`${WALL_X},${DOOR_Z}`]: 'gold' },
      }).some((e) => e.category === 'key-placement'),
    ).toBe(true);
  });
});
