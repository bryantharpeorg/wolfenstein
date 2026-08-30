import { describe, it, expect } from 'vitest';
import {
  LEVEL_GRID,
  GRID_SIZE,
  PLAYER_SPAWN,
  ENEMY_SPAWNS,
  ITEM_SPAWNS,
  DOOR_LOCKS,
  WALL_MATERIALS,
  DEFAULT_WALL_MATERIAL,
  TILE_SIZE,
  FLOOR_Y,
  CEILING_Y,
} from '../../src/level';

const CELL_ALPHABET = new Set([
  '0',
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  'D',
  'S',
  'E',
]);

function isWallType(cell: string): boolean {
  return cell >= '1' && cell <= '9';
}

describe('level data', () => {
  it('is a 64x64 grid of single-character cells from the declared alphabet', () => {
    expect(LEVEL_GRID).toHaveLength(GRID_SIZE);
    for (const row of LEVEL_GRID) {
      expect(row).toHaveLength(GRID_SIZE);
      for (const cell of row) {
        expect(CELL_ALPHABET.has(cell)).toBe(true);
      }
    }
  });

  it('declares at least 4 wall type IDs, 4 doors, 2 secrets and exactly 1 exit', () => {
    const wallIds = new Set<string>();
    let doors = 0;
    let secrets = 0;
    let exits = 0;
    for (const row of LEVEL_GRID) {
      for (const cell of row) {
        if (isWallType(cell)) wallIds.add(cell);
        else if (cell === 'D') doors += 1;
        else if (cell === 'S') secrets += 1;
        else if (cell === 'E') exits += 1;
      }
    }
    expect(wallIds.size).toBeGreaterThanOrEqual(4);
    expect(doors).toBeGreaterThanOrEqual(4);
    expect(secrets).toBeGreaterThanOrEqual(2);
    expect(exits).toBe(1);
  });

  it('has a non-empty outer border', () => {
    const size = GRID_SIZE;
    for (let x = 0; x < size; x += 1) {
      expect(LEVEL_GRID[0]![x]).not.toBe('0');
      expect(LEVEL_GRID[size - 1]![x]).not.toBe('0');
    }
    for (let z = 0; z < size; z += 1) {
      expect(LEVEL_GRID[z]![0]).not.toBe('0');
      expect(LEVEL_GRID[z]![size - 1]).not.toBe('0');
    }
  });

  it('names a player spawn on an empty tile with a finite yaw', () => {
    expect(Number.isFinite(PLAYER_SPAWN.yaw)).toBe(true);
    expect(LEVEL_GRID[PLAYER_SPAWN.z]![PLAYER_SPAWN.x]).toBe('0');
  });

  it('declares 6-10 enemy spawns on empty tiles, mutually at least 3 tiles apart', () => {
    expect(ENEMY_SPAWNS.length).toBeGreaterThanOrEqual(6);
    expect(ENEMY_SPAWNS.length).toBeLessThanOrEqual(10);
    for (const enemy of ENEMY_SPAWNS) {
      expect(LEVEL_GRID[enemy.z]![enemy.x]).toBe('0');
    }
    for (let i = 0; i < ENEMY_SPAWNS.length; i += 1) {
      for (let j = i + 1; j < ENEMY_SPAWNS.length; j += 1) {
        const a = ENEMY_SPAWNS[i]!;
        const b = ENEMY_SPAWNS[j]!;
        const distance = Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
        expect(distance).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('declares at least 12 item spawns with the required key and treasure mix', () => {
    expect(ITEM_SPAWNS.length).toBeGreaterThanOrEqual(12);
    const kinds = new Set(['health', 'ammo', 'treasure', 'silver-key', 'gold-key']);
    const counts: Record<string, number> = {};
    for (const item of ITEM_SPAWNS) {
      expect(kinds.has(item.kind)).toBe(true);
      expect(LEVEL_GRID[item.z]![item.x]).toBe('0');
      counts[item.kind] = (counts[item.kind] ?? 0) + 1;
    }
    expect(counts['silver-key']).toBe(1);
    expect(counts['gold-key']).toBe(1);
    expect(counts['treasure']).toBeGreaterThanOrEqual(3);
  });

  it('has a lock entry for every door, including one silver and one gold', () => {
    const doorKeys: string[] = [];
    for (let z = 0; z < GRID_SIZE; z += 1) {
      for (let x = 0; x < GRID_SIZE; x += 1) {
        if (LEVEL_GRID[z]![x] === 'D') doorKeys.push(`${x},${z}`);
      }
    }
    const lockKinds = new Set(['none', 'silver', 'gold']);
    const seen: string[] = [];
    for (const key of doorKeys) {
      const lock = DOOR_LOCKS[key];
      expect(lock).toBeDefined();
      expect(lockKinds.has(lock!)).toBe(true);
      seen.push(lock!);
    }
    expect(seen).toContain('silver');
    expect(seen).toContain('gold');
  });

  it('declares a material entry for every wall type ID plus a default', () => {
    const wallIds = new Set<string>();
    for (const row of LEVEL_GRID) {
      for (const cell of row) {
        if (isWallType(cell)) wallIds.add(cell);
      }
    }
    for (const id of wallIds) {
      expect(WALL_MATERIALS[id]).toBeDefined();
    }
    expect(DEFAULT_WALL_MATERIAL).toBeDefined();
  });

  it('fixes the tile scale constants every later spec reads', () => {
    expect(TILE_SIZE).toBe(1);
    expect(FLOOR_Y).toBe(0);
    expect(CEILING_Y).toBe(2);
  });
});
