import { describe, it, expect } from 'vitest';
import { validateLevel } from '../../src/level-validate';
import { LEVEL_GRID, GRID_SIZE, ITEM_SPAWNS, DOOR_LOCKS } from '../../src/level';
import { keyPlacementRule } from '../../src/interaction/rules/key-placement';
import { collectLevelRules, extraLevelErrors } from '../../src/interaction/level-rules';

// A 64x64 fixture: one wall column at x=32 pierced by a single door at (32,32).
// Everything east of the column is behind that door, so a key placed there is
// behind the lock it opens - the unwinnable map FR-011 exists to refuse.
const WALL_X = 32;
const DOOR_Z = 32;

function makeSplitGrid(): string[] {
  const grid: string[] = [];
  for (let z = 0; z < GRID_SIZE; z += 1) {
    let row = '';
    for (let x = 0; x < GRID_SIZE; x += 1) {
      const border = x === 0 || x === GRID_SIZE - 1 || z === 0 || z === GRID_SIZE - 1;
      if (border) row += '1';
      else if (x === WALL_X) row += z === DOOR_Z ? 'D' : '1';
      else row += '0';
    }
    grid.push(row);
  }
  // The exit sits east of the door, so reachability still passes: the flood
  // crosses door tiles, and it is the key that is stranded, not the exit.
  const exitRow = grid[60]!;
  grid[60] = exitRow.slice(0, 50) + 'E' + exitRow.slice(51);
  return grid;
}

const SPLIT_SPAWN = { x: 5, z: 5, yaw: 0 };

function splitReport(keyX: number, keyZ: number) {
  return validateLevel(makeSplitGrid(), {
    playerSpawn: SPLIT_SPAWN,
    enemySpawns: [],
    itemSpawns: [{ x: keyX, z: keyZ, kind: 'gold-key' }],
    doorLocks: { [`${WALL_X},${DOOR_Z}`]: 'gold' },
  });
}

describe('key-placement rule (FR-011, US2-S6)', () => {
  it('reports a named key-placement error when the key is behind its own door', () => {
    const report = splitReport(50, 20);

    const errors = report.errors.filter((e) => e.category === 'key-placement');
    expect(errors).toHaveLength(1);
    expect(report.valid).toBe(false);
    expect(errors[0]?.x).toBe(WALL_X);
    expect(errors[0]?.z).toBe(DOOR_Z);
    expect(errors[0]?.message).toContain('key-placement');
    expect(errors[0]?.message).toContain('gold');
  });

  it('reports no key-placement error once the same key is on the spawn side', () => {
    const report = splitReport(10, 20);

    expect(report.errors.filter((e) => e.category === 'key-placement')).toEqual([]);
    expect(report.valid).toBe(true);
  });

  it('reports the error when a locked door has no pickup of its kind anywhere', () => {
    const report = validateLevel(makeSplitGrid(), {
      playerSpawn: SPLIT_SPAWN,
      enemySpawns: [],
      itemSpawns: [{ x: 10, z: 20, kind: 'silver-key' }],
      doorLocks: { [`${WALL_X},${DOOR_Z}`]: 'gold' },
    });

    const errors = report.errors.filter((e) => e.category === 'key-placement');
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toContain('gold');
  });

  it('reports nothing for an unlocked door, whatever the keys do', () => {
    const report = validateLevel(makeSplitGrid(), {
      playerSpawn: SPLIT_SPAWN,
      enemySpawns: [],
      itemSpawns: [{ x: 50, z: 20, kind: 'gold-key' }],
      doorLocks: { [`${WALL_X},${DOOR_Z}`]: 'none' },
    });

    expect(report.errors.filter((e) => e.category === 'key-placement')).toEqual([]);
  });

  it('reports no key-placement error for the shipped layout', () => {
    const report = validateLevel();

    expect(report.errors.filter((e) => e.category === 'key-placement')).toEqual([]);
    expect(report.valid).toBe(true);
  });

  it('holds for every locked door of the shipped layout, door by door', () => {
    const lockedDoors = Object.entries(DOOR_LOCKS).filter(([, lock]) => lock !== 'none');
    expect(lockedDoors.length).toBeGreaterThanOrEqual(2);

    const errors = keyPlacementRule({
      grid: LEVEL_GRID,
      playerSpawn: { x: 10, z: 10, yaw: 0 },
      itemSpawns: ITEM_SPAWNS,
      doorLocks: DOOR_LOCKS,
    });

    expect(errors).toEqual([]);
  });

  it('is discovered by the rules glob rather than by an index edit', () => {
    const rules = collectLevelRules();
    expect(rules).toContain(keyPlacementRule);
  });

  it('folds its errors in through the collector the validator calls', () => {
    const errors = extraLevelErrors({
      grid: makeSplitGrid(),
      playerSpawn: SPLIT_SPAWN,
      itemSpawns: [{ x: 50, z: 20, kind: 'gold-key' }],
      doorLocks: { [`${WALL_X},${DOOR_Z}`]: 'gold' },
    });

    expect(errors.some((e) => e.category === 'key-placement')).toBe(true);
  });
});
