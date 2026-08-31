// T024 (FR-006, FR-007, FR-011, US4-S6, Edge Cases): the live guard world — the
// records the running page ticks, and the fixed-step tick that drives them
// through US1's `stepGuard` and resolves their shots through `./attack`. Three
// properties beyond "it runs": the tick is bounded, a guard whose chase path is
// unreachable goes back to `idle` rather than standing in `chase` forever, and
// `viewAngle` exists here at zero for US4 to write.

import { describe, expect, it } from 'vitest';
import { GUARD_TICK_MS, MAX_TICKS_PER_FRAME, createEnemyWorld } from '../../src/enemy/world';
import { MAX_GUARDS, MIN_GUARDS } from '../../src/enemy/spawn';
import { damageAtDistance } from '../../src/enemy/falloff';
import { ENEMY_SPAWNS } from '../../src/level';
import type { Shot } from '../../src/enemy/attack';
import type { Cell, GuardWorld, PathResult, Point } from '../../src/enemy/step';
import type { Navigator, NavReport } from '../../src/enemy/nav';
import { draw, roomDraft } from './enemy-grid';
import { expectPure } from './enemy-pure';

const ROOM = draw(roomDraft(20, 20));
const SIX_MARKERS = [2, 4, 6].flatMap((x) => [2, 6].map((z) => ({ x, z })));
const FAR_CORNER = () => ({ x: 10.5, z: 10.5 });

/** A world over the plain room, with everything but the navigation defaulted. */
const room = (nav?: Navigator, playerPos: () => Point = FAR_CORNER) =>
  createEnemyWorld({ grid: ROOM, markers: SIX_MARKERS, playerPos, nav });

/** A `Navigator` that always sees and answers one fixed path result. */
function stubNav(result: PathResult): Navigator {
  const world: GuardWorld = { hasLineOfSight: () => true, findPath: () => result };
  const report: NavReport = {
    intervalTicks: 0,
    maxNodeExpansions: 0,
    searches: 0,
    throttled: 0,
    staleGoals: 0,
    doorInvalidations: 0,
    nodesExpanded: 0,
    maxNodesExpanded: 0,
    claims: 0,
  };
  return {
    beginTick: () => undefined,
    worldFor: () => world,
    claimedCell: () => null,
    releaseGuard: () => undefined,
    report: () => report,
  };
}

describe('the world built from the shipped level', () => {
  const world = createEnemyWorld();

  it('holds one record per spawn marker, six to ten, all alive (US3-S6)', () => {
    expect(world.records).toHaveLength(ENEMY_SPAWNS.length);
    expect(world.records.length).toBeGreaterThanOrEqual(MIN_GUARDS);
    expect(world.records.length).toBeLessThanOrEqual(MAX_GUARDS);
    expect(world.spawnErrors).toEqual([]);
    expect(world.enemiesAlive()).toBe(world.records.length);
  });

  it('publishes the FR-011 shape from one stable array, viewAngle zeroed for US4', () => {
    const entries = world.enemyDiagnostics();
    expect(entries).toHaveLength(world.records.length);
    expect(world.enemyDiagnostics()).toBe(entries);
    for (const entry of entries) {
      expect(Object.keys(entry).sort()).toEqual(['pathable', 'state', 'viewAngle']);
      expect(entry.state).toBe('idle');
      expect(entry.viewAngle).toBe(0);
      expect(entry.pathable).toBe(true);
    }
  });

  it('lets US4 write a view angle through to the diagnostics entry (US4-S6)', () => {
    world.setViewAngle(world.records[0]!.id, 5);
    expect(world.records[0]!.viewAngle).toBe(5);
    expect(world.enemyDiagnostics()[0]!.viewAngle).toBe(5);
  });
});

describe('the fixed-step tick', () => {
  it('runs the whole number of steps a frame paid for, and no partial one', () => {
    const world = room();
    expect(world.tickWorld(GUARD_TICK_MS - 1).ticks).toBe(0);
    expect(world.tickWorld(1).ticks).toBe(1);
    expect(world.tickWorld(GUARD_TICK_MS * 3 + 5).ticks).toBe(3);
  });

  // The negative goal, stated as a bound: a stalled tab must not be paid back.
  it('caps the catch-up and drops the backlog rather than carrying it (Edge Cases)', () => {
    const world = room();
    expect(world.tickWorld(GUARD_TICK_MS * 1000).ticks).toBe(MAX_TICKS_PER_FRAME);
    expect(world.tickWorld(0).ticks).toBe(0);
  });

  it('ignores a negative or non-finite delta', () => {
    const world = room();
    expect(world.tickWorld(-100).ticks).toBe(0);
    expect(world.tickWorld(Number.NaN).ticks).toBe(0);
    expect(world.tickWorld(GUARD_TICK_MS).ticks).toBe(1);
  });
});

describe('guards hunting a visible player', () => {
  const world = room(undefined, () => ({ x: 4.5, z: 4.5 }));
  const shots: Shot[] = [];
  let multiShotTicks = 0;
  for (let frame = 0; frame < 120; frame += 1) {
    const report = world.tickWorld(GUARD_TICK_MS);
    if (report.shots.length > 1) multiShotTicks += 1;
    shots.push(...report.shots);
  }

  it('leaves idle, fires, and resolves several shots on one tick (US3-S8)', () => {
    expect(shots.length).toBeGreaterThan(0);
    expect(world.records.some((record) => record.state !== 'idle')).toBe(true);
    expect(multiShotTicks).toBeGreaterThan(0);
  });

  it('computes every shot from its own guard’s distance (US3-S8)', () => {
    for (const shot of shots) {
      expect(shot.damage).toBe(shot.outcome === 'blocked' ? 0 : damageAtDistance(shot.distance));
    }
    expect(shots.reduce((sum, shot) => sum + shot.damage, 0)).toBeGreaterThan(0);
  });

  it('keeps the diagnostics entries in step with the records', () => {
    world.records.forEach((record, index) => {
      const entry = world.enemyDiagnostics()[index]!;
      expect(entry.state).toBe(record.state);
      expect(entry.pathable).toBe(record.pathable);
    });
  });
});

describe('a guard whose chase path is unreachable (Edge Cases)', () => {
  it('is marked unpathable and returned to idle rather than left hanging', () => {
    const world = room(stubNav({ unreachable: true, nodesExpanded: 0 }));
    for (let tick = 0; tick < 80; tick += 1) world.tickWorld(GUARD_TICK_MS);

    expect(world.records.some((record) => !record.pathable)).toBe(true);
    world.records.forEach((record, index) => {
      if (record.pathable) return;
      expect(record.state).not.toBe('chase');
      expect(world.enemyDiagnostics()[index]!.pathable).toBe(false);
    });
  });

  it('stays pathable when the navigation port answers with a route', () => {
    const world = room(stubNav({ cells: [{ x: 9, z: 9 }, { x: 10, z: 10 }] as Cell[], nodesExpanded: 2 }));
    for (let tick = 0; tick < 40; tick += 1) world.tickWorld(GUARD_TICK_MS);
    expect(world.records.every((record) => record.pathable)).toBe(true);
  });
});

describe('damage, death and a faulty level', () => {
  it('kills a guard that takes lethal damage and drops it from the alive count', () => {
    const world = room(undefined, () => ({ x: 18.5, z: 18.5 }));
    const target = world.records[0]!;
    const before = world.enemiesAlive();

    world.damageGuardById(target.id, 1000);
    world.tickWorld(GUARD_TICK_MS);

    expect(target.state).toBe('death');
    expect(target.health).toBe(0);
    expect(world.enemiesAlive()).toBe(before - 1);
    expect(world.enemyDiagnostics()[0]!.state).toBe('death');
  });

  it('emits no shot from a dead guard (US1-S7)', () => {
    const world = room(undefined, () => ({ x: 4.5, z: 4.5 }));
    for (const record of world.records) world.damageGuardById(record.id, 1000);
    let shots = 0;
    for (let tick = 0; tick < 60; tick += 1) shots += world.tickWorld(GUARD_TICK_MS).shots.length;
    expect(shots).toBe(0);
    expect(world.enemiesAlive()).toBe(0);
  });

  it('carries the named spawn errors without throwing (US3-S7)', () => {
    const world = createEnemyWorld({
      grid: ROOM,
      markers: SIX_MARKERS.slice(0, 3),
      playerPos: FAR_CORNER,
    });
    expect(world.spawnErrors.length).toBeGreaterThan(0);
    expect(world.records).toHaveLength(3);
    expect(() => world.tickWorld(GUARD_TICK_MS)).not.toThrow();
  });

  it('is pure: no three.js, no DOM (FR-001)', () => {
    expectPure('world.ts');
  });
});
