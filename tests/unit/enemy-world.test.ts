// T024 (FR-006, FR-007, FR-011, US4-S6, Edge Cases): the live guard world — the
// records the running page ticks, and the fixed-step tick that drives them
// through US1's `stepGuard` and resolves their shots through `./attack`.
//
// Three properties beyond "it runs": the tick is bounded, so a long frame can
// never be paid back by an unbounded burst of guard AI; a guard whose chase path
// comes back unreachable is returned to `idle` rather than left standing in
// `chase` forever; and `viewAngle` exists here, initialised to zero, for US4 to
// write without either story opening the other's file.

import { describe, expect, it } from 'vitest';
import {
  GUARD_TICK_MS,
  MAX_TICKS_PER_FRAME,
  createEnemyWorld,
} from '../../src/enemy/world';
import { MAX_GUARDS, MIN_GUARDS } from '../../src/enemy/spawn';
import { damageAtDistance } from '../../src/enemy/falloff';
import { ENEMY_SPAWNS } from '../../src/level';
import type { Shot } from '../../src/enemy/attack';
import type { Cell, GuardWorld, PathResult, Point } from '../../src/enemy/step';
import type { Navigator, NavReport } from '../../src/enemy/nav';
import { draw, roomDraft } from './enemy-grid';
import { expectPure } from './enemy-pure';

const ROOM = draw(roomDraft(20, 20));
const SIX_MARKERS = [
  { x: 2, z: 2 },
  { x: 4, z: 2 },
  { x: 6, z: 2 },
  { x: 2, z: 6 },
  { x: 4, z: 6 },
  { x: 6, z: 6 },
];

/** A `Navigator` that always sees and answers a fixed path result. */
function stubNav(result: PathResult): Navigator {
  const world: GuardWorld = {
    hasLineOfSight: () => true,
    findPath: (_from: Cell, _to: Cell) => result,
  };
  return {
    beginTick: () => undefined,
    worldFor: () => world,
    claimedCell: () => null,
    releaseGuard: () => undefined,
    report: (): NavReport => ({
      intervalTicks: 0,
      maxNodeExpansions: 0,
      searches: 0,
      throttled: 0,
      staleGoals: 0,
      doorInvalidations: 0,
      nodesExpanded: 0,
      maxNodesExpanded: 0,
      claims: 0,
    }),
  };
}

describe('the world built from the shipped level', () => {
  const world = createEnemyWorld();

  it('holds one record per spawn marker, six to ten of them (US3-S6)', () => {
    expect(world.records).toHaveLength(ENEMY_SPAWNS.length);
    expect(world.records.length).toBeGreaterThanOrEqual(MIN_GUARDS);
    expect(world.records.length).toBeLessThanOrEqual(MAX_GUARDS);
    expect(world.spawnErrors).toEqual([]);
  });

  it('counts every record alive at spawn', () => {
    expect(world.enemiesAlive()).toBe(world.records.length);
  });

  it('publishes the FR-011 shape, viewAngle zeroed for US4 to fill', () => {
    const entries = world.enemyDiagnostics();
    expect(entries).toHaveLength(world.records.length);
    for (const entry of entries) {
      expect(Object.keys(entry).sort()).toEqual(['pathable', 'state', 'viewAngle']);
      expect(entry.state).toBe('idle');
      expect(entry.viewAngle).toBe(0);
      expect(entry.pathable).toBe(true);
    }
  });

  it('returns the same diagnostics array each call rather than a fresh one', () => {
    expect(world.enemyDiagnostics()).toBe(world.enemyDiagnostics());
  });

  it('lets US4 write a view angle through to the diagnostics entry', () => {
    const id = world.records[0]!.id;
    world.setViewAngle(id, 5);
    expect(world.records[0]!.viewAngle).toBe(5);
    expect(world.enemyDiagnostics()[0]!.viewAngle).toBe(5);
  });
});

describe('the fixed-step tick', () => {
  it('runs no tick until a whole step of time has accumulated', () => {
    const world = createEnemyWorld({ grid: ROOM, markers: SIX_MARKERS, playerPos: () => ({ x: 10.5, z: 10.5 }) });
    expect(world.tickWorld(GUARD_TICK_MS - 1).ticks).toBe(0);
    expect(world.tickWorld(1).ticks).toBe(1);
  });

  it('runs the whole number of steps a frame paid for', () => {
    const world = createEnemyWorld({ grid: ROOM, markers: SIX_MARKERS, playerPos: () => ({ x: 10.5, z: 10.5 }) });
    expect(world.tickWorld(GUARD_TICK_MS * 3 + 5).ticks).toBe(3);
  });

  // The negative goal, stated as a bound: a stalled tab must not be paid back.
  it('caps the catch-up so a long frame cannot burst (Edge Cases)', () => {
    const world = createEnemyWorld({ grid: ROOM, markers: SIX_MARKERS, playerPos: () => ({ x: 10.5, z: 10.5 }) });
    expect(world.tickWorld(GUARD_TICK_MS * 1000).ticks).toBe(MAX_TICKS_PER_FRAME);
    // And the backlog is dropped, not carried into the next frame.
    expect(world.tickWorld(0).ticks).toBe(0);
  });

  it('ignores a negative or non-finite delta', () => {
    const world = createEnemyWorld({ grid: ROOM, markers: SIX_MARKERS, playerPos: () => ({ x: 10.5, z: 10.5 }) });
    expect(world.tickWorld(-100).ticks).toBe(0);
    expect(world.tickWorld(Number.NaN).ticks).toBe(0);
    expect(world.tickWorld(GUARD_TICK_MS).ticks).toBe(1);
  });
});

describe('guards hunting a visible player', () => {
  const player: Point = { x: 4.5, z: 4.5 };
  const world = createEnemyWorld({ grid: ROOM, markers: SIX_MARKERS, playerPos: () => player });
  const shots: Shot[] = [];
  let multiShotTicks = 0;
  for (let frame = 0; frame < 120; frame += 1) {
    const report = world.tickWorld(GUARD_TICK_MS);
    if (report.shots.length > 1) multiShotTicks += 1;
    shots.push(...report.shots);
  }

  it('leaves idle and eventually fires', () => {
    expect(shots.length).toBeGreaterThan(0);
    expect(world.records.some((record) => record.state !== 'idle')).toBe(true);
  });

  it('computes every shot from its own guard’s distance (US3-S8)', () => {
    for (const shot of shots) {
      expect(shot.damage).toBe(shot.outcome === 'blocked' ? 0 : damageAtDistance(shot.distance));
    }
  });

  it('resolves each of several shots on one tick independently (US3-S8)', () => {
    expect(multiShotTicks).toBeGreaterThan(0);
  });

  it('accumulates the damage those shots dealt to the player', () => {
    const total = shots.reduce((sum, shot) => sum + shot.damage, 0);
    expect(total).toBeGreaterThan(0);
  });

  it('keeps the diagnostics entries in step with the records', () => {
    world.records.forEach((record, index) => {
      const entry = world.enemyDiagnostics()[index]!;
      expect(entry.state).toBe(record.state);
      expect(entry.pathable).toBe(record.pathable);
    });
  });
});

describe('a guard whose chase path is unreachable', () => {
  it('is marked unpathable and returned to idle rather than left hanging', () => {
    const world = createEnemyWorld({
      grid: ROOM,
      markers: SIX_MARKERS,
      playerPos: () => ({ x: 10.5, z: 10.5 }),
      nav: stubNav({ unreachable: true, nodesExpanded: 0 }),
    });
    for (let tick = 0; tick < 80; tick += 1) world.tickWorld(GUARD_TICK_MS);

    expect(world.records.some((record) => !record.pathable)).toBe(true);
    for (const record of world.records) {
      if (record.pathable) continue;
      expect(record.state).not.toBe('chase');
      expect(world.enemyDiagnostics()[world.records.indexOf(record)]!.pathable).toBe(false);
    }
  });

  it('stays pathable when the navigation port answers with a route', () => {
    const world = createEnemyWorld({
      grid: ROOM,
      markers: SIX_MARKERS,
      playerPos: () => ({ x: 10.5, z: 10.5 }),
      nav: stubNav({ cells: [{ x: 9, z: 9 }, { x: 10, z: 10 }], nodesExpanded: 2 }),
    });
    for (let tick = 0; tick < 40; tick += 1) world.tickWorld(GUARD_TICK_MS);
    expect(world.records.every((record) => record.pathable)).toBe(true);
  });
});

describe('damage and death', () => {
  it('kills a guard that takes lethal damage and drops it from the alive count', () => {
    const world = createEnemyWorld({ grid: ROOM, markers: SIX_MARKERS, playerPos: () => ({ x: 18.5, z: 18.5 }) });
    const target = world.records[0]!;
    const before = world.enemiesAlive();

    world.damageGuardById(target.id, 1000);
    world.tickWorld(GUARD_TICK_MS);

    expect(target.state).toBe('death');
    expect(target.health).toBe(0);
    expect(world.enemiesAlive()).toBe(before - 1);
    expect(world.enemyDiagnostics()[0]!.state).toBe('death');
  });

  it('emits no shot from a dead guard', () => {
    const world = createEnemyWorld({ grid: ROOM, markers: SIX_MARKERS, playerPos: () => ({ x: 4.5, z: 4.5 }) });
    for (const record of world.records) world.damageGuardById(record.id, 1000);
    let shots = 0;
    for (let tick = 0; tick < 60; tick += 1) shots += world.tickWorld(GUARD_TICK_MS).shots.length;
    expect(shots).toBe(0);
    expect(world.enemiesAlive()).toBe(0);
  });
});

describe('a level whose markers are faulty', () => {
  it('carries the named spawn errors without throwing (US3-S7)', () => {
    const world = createEnemyWorld({
      grid: ROOM,
      markers: SIX_MARKERS.slice(0, 3),
      playerPos: () => ({ x: 10.5, z: 10.5 }),
    });
    expect(world.spawnErrors.length).toBeGreaterThan(0);
    expect(world.records).toHaveLength(3);
    expect(() => world.tickWorld(GUARD_TICK_MS)).not.toThrow();
  });
});

describe('the world module', () => {
  it('is pure: no three.js, no DOM (FR-001)', () => {
    expectPure('world.ts');
  });
});
