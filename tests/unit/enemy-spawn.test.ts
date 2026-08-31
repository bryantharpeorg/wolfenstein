// T020 (FR-006, US3-S6, US3-S7): guards are instantiated from the level's own
// spawn markers. The live count equals the marker count and lies between 6 and
// 10 inclusive; a marker that lands on a wall cell produces a *named* error
// carrying that marker's coordinates rather than a dropped guard or a throw.

import { describe, expect, it } from 'vitest';
import { MAX_GUARDS, MIN_GUARDS, guardIdFor, spawnGuards } from '../../src/enemy/spawn';
import { ENEMY_SPAWNS, LEVEL_GRID } from '../../src/level';
import { GUARD_MAX_HEALTH, GUARD_SPAWN_STATE } from '../../src/enemy/states';
import { isTileBlocking } from '../../src/player/tiles';
import { NO_OPEN_TILES, draw, put, roomDraft } from './enemy-grid';
import { expectPure } from './enemy-pure';

/** `count` markers on open floor of a plain room, for the count cases. */
const markers = (count: number): { x: number; z: number }[] =>
  Array.from({ length: count }, (_, i) => ({ x: 1 + (i % 16), z: 1 + Math.floor(i / 16) }));

const ROOM = draw(roomDraft(20, 20));

describe('spawning from the shipped level (US3-S6)', () => {
  const result = spawnGuards();

  it('instantiates one guard per marker, six to ten of them, with no fault', () => {
    expect(result.markerCount).toBe(ENEMY_SPAWNS.length);
    expect(result.guards).toHaveLength(ENEMY_SPAWNS.length);
    expect(result.guards.length).toBeGreaterThanOrEqual(MIN_GUARDS);
    expect(result.guards.length).toBeLessThanOrEqual(MAX_GUARDS);
    expect(MIN_GUARDS).toBe(6);
    expect(MAX_GUARDS).toBe(10);
    expect(result.errors).toEqual([]);
  });

  it('stands each guard at the centre of its own marker cell, alive, idle and walkable', () => {
    ENEMY_SPAWNS.forEach((marker, index) => {
      const guard = result.guards[index]!;
      expect(guard.x).toBe(marker.x + 0.5);
      expect(guard.z).toBe(marker.z + 0.5);
      expect(guard.state).toBe(GUARD_SPAWN_STATE);
      expect(guard.health).toBe(GUARD_MAX_HEALTH);
      expect(guard.id).toBe(guardIdFor(index));
      expect(
        isTileBlocking(LEVEL_GRID, marker.x, marker.z, NO_OPEN_TILES),
        `marker ${marker.x},${marker.z} is not walkable`,
      ).toBe(false);
    });
    expect(new Set(result.guards.map((guard) => guard.id)).size).toBe(result.guards.length);
  });

  it('is deterministic: two spawns produce identical guards', () => {
    expect(spawnGuards().guards).toEqual(result.guards);
  });
});

describe('a marker on a wall cell (US3-S7)', () => {
  const placed = [...markers(5), { x: 4, z: 3 }];

  it('names that marker’s coordinates, keeps the guard, and does not throw', () => {
    const grid = draw(put(roomDraft(20, 20), 4, 3, '1'));
    const result = spawnGuards({ grid, markers: placed });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('4, 3');
    expect(result.errors[0]!.toLowerCase()).toContain('wall');
    expect(result.guards).toHaveLength(placed.length);
    expect(result.markerCount).toBe(placed.length);
    expect(() => spawnGuards({ grid, markers: placed })).not.toThrow();
  });

  it('names a closed door under a marker too', () => {
    const doorGrid = draw(put(roomDraft(20, 20), 4, 3, 'D'));
    const errors = spawnGuards({ grid: doorGrid, markers: placed }).errors;
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('4, 3');
  });
});

describe('the declared count bounds (FR-006)', () => {
  it('records an error naming the count outside either bound, and none within', () => {
    for (const count of [MIN_GUARDS - 1, MAX_GUARDS + 1]) {
      const result = spawnGuards({ grid: ROOM, markers: markers(count) });
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain(String(count));
      expect(result.errors[0]).toContain(String(count < MIN_GUARDS ? MIN_GUARDS : MAX_GUARDS));
      expect(result.guards).toHaveLength(count);
    }
    for (const count of [MIN_GUARDS, MAX_GUARDS]) {
      expect(spawnGuards({ grid: ROOM, markers: markers(count) }).errors).toEqual([]);
    }
  });

  it('is pure: no three.js, no DOM (FR-001)', () => {
    expectPure('spawn.ts');
  });
});
