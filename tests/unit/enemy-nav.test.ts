// The adapter between the level and the `GuardWorld` port US1 declared: one
// search per guard per declared interval, a stale path dropped rather than
// followed, a closing door forcing a fresh path, and a claimed cell each
// (FR-003, FR-004, Edge Cases).

import { describe, it, expect } from 'vitest';
import { CLAIM_SEARCH_RADIUS, createNavigator } from '../../src/enemy/nav';
import { MAX_NODE_EXPANSIONS } from '../../src/enemy/pathing';
import { PATH_REQUEST_INTERVAL_TICKS } from '../../src/enemy/states';
import { createGuard, isUnreachable, stepGuard, tileKey } from '../../src/enemy/step';
import type { Cell, Guard, PathResult } from '../../src/enemy/step';
import { createRng } from '../../src/enemy/rng';
import { GRID_SIZE, LEVEL_GRID } from '../../src/level';
import { isTileBlocking } from '../../src/player/tiles';
import { draw, put, roomDraft, solidDraft } from './enemy-grid';
import { expectPure } from './enemy-pure';

const cell = (x: number, z: number): Cell => ({ x, z });
const NO_DOORS = () => new Set<string>();

/** A room split at x=32, with the only gap a door at (32, 10). */
const SPLIT_ROOM = draw(
  (() => {
    const draft = roomDraft(GRID_SIZE, GRID_SIZE);
    for (let z = 1; z < GRID_SIZE - 1; z += 1) put(draft, 32, z, '1');
    return put(draft, 32, 10, 'D');
  })(),
);

/** A one-wide corridor along z=5, from x=1 to x=20, in an otherwise solid grid. */
const CORRIDOR = draw(
  (() => {
    const draft = solidDraft(GRID_SIZE, GRID_SIZE);
    for (let x = 1; x <= 20; x += 1) put(draft, x, 5, '0');
    return draft;
  })(),
);

const OPEN_ROOM = draw(roomDraft(GRID_SIZE, GRID_SIZE));

function cellsOf(result: PathResult): readonly Cell[] {
  if (isUnreachable(result)) throw new Error('expected a path, got unreachable');
  return result.cells;
}

describe('the throttle on path requests (FR-004, Edge Cases)', () => {
  it('issues at most one search per guard per declared interval, and reports both', () => {
    const nav = createNavigator({ grid: OPEN_ROOM, doorStates: NO_DOORS });
    const world = nav.worldFor('alpha');
    const goal = cell(20, 20);
    expect(nav.report().intervalTicks).toBe(PATH_REQUEST_INTERVAL_TICKS);
    expect(nav.report().maxNodeExpansions).toBe(MAX_NODE_EXPANSIONS);
    expect(nav.report().searches).toBe(0);

    nav.beginTick(0);
    const first = world.findPath(cell(2, 2), goal);
    for (let tick = 1; tick < PATH_REQUEST_INTERVAL_TICKS; tick += 1) {
      nav.beginTick(tick);
      expect(world.findPath(cell(2, 2), goal)).toBe(first);
    }
    expect(nav.report().searches).toBe(1);
    expect(nav.report().throttled).toBe(PATH_REQUEST_INTERVAL_TICKS - 1);

    nav.beginTick(PATH_REQUEST_INTERVAL_TICKS);
    world.findPath(cell(2, 2), goal);
    expect(nav.report().searches).toBe(2);
  });

  it('throttles each guard on its own clock', () => {
    const nav = createNavigator({ grid: OPEN_ROOM, doorStates: NO_DOORS });
    nav.beginTick(0);
    nav.worldFor('alpha').findPath(cell(2, 2), cell(20, 20));
    nav.beginTick(3);
    nav.worldFor('beta').findPath(cell(4, 2), cell(20, 20));
    nav.beginTick(4);
    nav.worldFor('alpha').findPath(cell(2, 2), cell(20, 20));
    nav.worldFor('beta').findPath(cell(4, 2), cell(20, 20));
    expect(nav.report().searches).toBe(2);
    expect(nav.report().throttled).toBe(2);
  });

  it('never lets a single search exceed the declared expansion cap', () => {
    const nav = createNavigator({ grid: LEVEL_GRID, doorStates: NO_DOORS });
    nav.beginTick(0);
    const result = nav.worldFor('alpha').findPath(cell(5, 5), cell(58, 58));
    expect(result.nodesExpanded).toBeLessThanOrEqual(MAX_NODE_EXPANSIONS);
    expect(nav.report().maxNodesExpanded).toBe(result.nodesExpanded);
  });
});

describe('a path that has gone stale (Edge Cases)', () => {
  it('re-searches inside the throttle window when the goal cell changes, and only then', () => {
    const nav = createNavigator({ grid: OPEN_ROOM, doorStates: NO_DOORS });
    const world = nav.worldFor('alpha');

    nav.beginTick(0);
    world.findPath(cell(2, 2), cell(20, 20));
    // The guard itself moving is not a stale goal; the goal moving is.
    nav.beginTick(1);
    world.findPath(cell(3, 2), cell(20, 20));
    expect(nav.report().staleGoals).toBe(0);
    expect(nav.report().throttled).toBe(1);

    nav.beginTick(2);
    const moved = world.findPath(cell(2, 2), cell(6, 30));
    expect(nav.report().searches).toBe(2);
    expect(nav.report().staleGoals).toBe(1);
    const cells = cellsOf(moved);
    expect(cells[cells.length - 1]).toEqual(cell(6, 30));
  });

  it('re-searches within one tick when a door on the held path closes', () => {
    const open = new Set<string>([tileKey(32, 10)]);
    const nav = createNavigator({ grid: SPLIT_ROOM, doorStates: () => open });
    const world = nav.worldFor('alpha');

    nav.beginTick(0);
    const through = cellsOf(world.findPath(cell(10, 10), cell(50, 10)));
    expect(through.some((step) => step.x === 32 && step.z === 10)).toBe(true);

    // The door shuts on the very next tick, well inside the throttle window.
    open.delete(tileKey(32, 10));
    nav.beginTick(1);
    const after = world.findPath(cell(20, 10), cell(50, 10));
    expect(nav.report().searches).toBe(2);
    expect(nav.report().doorInvalidations).toBe(1);
    expect(isUnreachable(after)).toBe(true);
  });

  it('leaves a path alone when a door it never used closes', () => {
    const open = new Set<string>([tileKey(32, 10), tileKey(32, 20)]);
    const nav = createNavigator({ grid: SPLIT_ROOM, doorStates: () => open });
    const world = nav.worldFor('alpha');
    nav.beginTick(0);
    world.findPath(cell(10, 10), cell(50, 10));
    open.delete(tileKey(32, 20));
    nav.beginTick(1);
    world.findPath(cell(10, 10), cell(50, 10));
    expect(nav.report().doorInvalidations).toBe(0);
    expect(nav.report().throttled).toBe(1);
  });
});

describe('two guards converging on one corridor cell (FR-003, Edge Cases)', () => {
  it('gives each guard a distinct claimed cell, none a wall, none a dead end', () => {
    const nav = createNavigator({ grid: CORRIDOR, doorStates: NO_DOORS });
    const goal = cell(10, 5);

    nav.beginTick(0);
    const alpha = nav.worldFor('alpha').findPath(cell(1, 5), goal);
    const beta = nav.worldFor('beta').findPath(cell(20, 5), goal);
    nav.worldFor('gamma').findPath(cell(2, 5), goal);

    const claims = ['alpha', 'beta', 'gamma'].map((id) => nav.claimedCell(id)!);
    expect(new Set(claims.map((c) => tileKey(c.x, c.z))).size).toBe(3);
    expect(nav.report().claims).toBe(3);
    for (const claim of claims) {
      expect(isTileBlocking(CORRIDOR, claim.x, claim.z, new Set())).toBe(false);
      // Displaced no further from the cell asked for than the declared radius.
      expect(Math.abs(claim.x - 10) + Math.abs(claim.z - 5)).toBeLessThanOrEqual(CLAIM_SEARCH_RADIUS);
    }
    // Neither stops moving: both still hold a path ending on their own claim.
    for (const [result, claim] of [[alpha, claims[0]!], [beta, claims[1]!]] as const) {
      const cells = cellsOf(result);
      expect(cells.length).toBeGreaterThan(1);
      expect(cells[cells.length - 1]).toEqual(claim);
    }
  });

  it('hands a released guard’s cell back to the next claimant', () => {
    const nav = createNavigator({ grid: CORRIDOR, doorStates: NO_DOORS });
    nav.beginTick(0);
    nav.worldFor('alpha').findPath(cell(1, 5), cell(10, 5));
    expect(nav.claimedCell('alpha')).toEqual(cell(10, 5));
    nav.releaseGuard('alpha');
    expect(nav.claimedCell('alpha')).toBeNull();
    nav.worldFor('beta').findPath(cell(20, 5), cell(10, 5));
    expect(nav.claimedCell('beta')).toEqual(cell(10, 5));
  });
});

describe('filling the GuardWorld port (FR-003, FR-005)', () => {
  it('answers sight from the same grid and door state as pathing', () => {
    const open = new Set<string>();
    const world = createNavigator({ grid: SPLIT_ROOM, doorStates: () => open }).worldFor('alpha');
    const a = { x: 10.5, z: 10.5 };
    const b = { x: 50.5, z: 10.5 };
    expect(world.hasLineOfSight(a, b)).toBe(false);
    open.add(tileKey(32, 10));
    expect(world.hasLineOfSight(a, b)).toBe(true);
  });

  it('drives a real guard end to end on the real level grid', () => {
    const nav = createNavigator();
    const rng = createRng(7);
    let guard: Guard = createGuard({ id: 'g0', x: 5.5, z: 5.5 });
    const start = { x: guard.x, z: guard.z };

    for (let tick = 0; tick < 60; tick += 1) {
      nav.beginTick(tick);
      guard = stepGuard(guard, {
        tick,
        rng,
        grid: LEVEL_GRID,
        doorStates: new Set<string>(),
        playerPos: { x: 18.5, z: 18.5 },
        world: nav.worldFor(guard.id),
      });
    }

    // Sight is clear across the north-west room, so the guard commits and closes
    // — but 18 cells is further than 60 ticks of travel, so it is still chasing.
    expect(guard.state).toBe('chase');
    expect(guard.pathable).toBe(true);
    expect(Math.hypot(guard.x - start.x, guard.z - start.z)).toBeGreaterThan(1);
    expect(isTileBlocking(LEVEL_GRID, Math.floor(guard.x), Math.floor(guard.z), new Set())).toBe(false);
    expect(nav.report().searches).toBeGreaterThan(0);
    expect(nav.report().nodesExpanded).toBeLessThanOrEqual(nav.report().searches * MAX_NODE_EXPANSIONS);
  });

  it('is DOM-free and three.js-free', () => {
    expectPure('nav.ts');
  });
});
