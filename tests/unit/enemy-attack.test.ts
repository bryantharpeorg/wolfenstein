// T019 (FR-007, US3-S3, US3-S4, US3-S5, US3-S8): a guard's shot is a ray test.
// It stops at the first blocking geometry, reports `blocked` with the distance
// it terminated at and zero damage, and otherwise pays out the falloff curve for
// the distance it actually measured. Two assertions are about what the code may
// *not* contain: the blocking verdict must be `los.ts`'s, and the damage must be
// the table's — so the call site's source is read back and refused if a curve
// value appears in it.

import { describe, expect, it } from 'vitest';
import { firstBlockingHit, resolveShot, resolveShots } from '../../src/enemy/attack';
import { DAMAGE_FALLOFF_CURVE, damageAtDistance } from '../../src/enemy/falloff';
import { hasLineOfSight } from '../../src/enemy/los';
import { createGuard, stepGuard } from '../../src/enemy/step';
import type { Guard, GuardWorld, StepContext } from '../../src/enemy/step';
import { createRng } from '../../src/enemy/rng';
import { GUARD_STATES } from '../../src/enemy/states';
import { NO_OPEN_TILES, draw, openTileSet, put, roomDraft } from './enemy-grid';
import { enemySource, expectPure } from './enemy-pure';

/** A guard standing at the centre of cell (x, z), already committed to a shot. */
function firing(id: string, x: number, z: number): Guard {
  return { ...createGuard({ id, x: x + 0.5, z: z + 0.5 }), state: 'attack' };
}

const ROOM = draw(roomDraft(20, 20));

describe('resolveShot with a clear line (US3-S1)', () => {
  it('deals the curve value for the distance it measured, along a row', () => {
    const shot = resolveShot(firing('a', 2, 2), { x: 7.5, z: 2.5 }, ROOM, NO_OPEN_TILES)!;
    expect(shot.outcome).toBe('hit');
    expect(shot.guardId).toBe('a');
    expect(shot.distance).toBeCloseTo(5, 12);
    expect(shot.damage).toBe(damageAtDistance(5));
    expect(shot.damage).toBeGreaterThan(0);
    expect(shot.blockedAt).toBeNull();
  });

  it('measures the diagonal distance, not the cell count', () => {
    const shot = resolveShot(firing('a', 2, 2), { x: 5.5, z: 5.5 }, ROOM, NO_OPEN_TILES)!;
    expect(shot.outcome).toBe('hit');
    expect(shot.distance).toBeCloseTo(Math.hypot(3, 3), 12);
    expect(shot.damage).toBe(damageAtDistance(Math.hypot(3, 3)));
  });
});

describe('resolveShot into cover', () => {
  // US3-S3: a wall cell between attacker and target.
  it('reports blocked, zero damage and the distance the ray terminated at', () => {
    const grid = draw(put(roomDraft(20, 20), 5, 2, '1'));
    const shot = resolveShot(firing('a', 2, 2), { x: 8.5, z: 2.5 }, grid, NO_OPEN_TILES)!;
    expect(shot.outcome).toBe('blocked');
    expect(shot.damage).toBe(0);
    // The ray starts at x=2.5 and stops on entering cell x=5, so 2.5 cells along.
    expect(shot.distance).toBeCloseTo(2.5, 12);
    expect(shot.blockedAt).toEqual({ x: 5, z: 2 });
  });

  // US3-S4: a closed door blocks exactly as a wall does; an open one does not.
  it('reports blocked with zero damage behind a closed door, and lets it through once open', () => {
    const grid = draw(put(roomDraft(20, 20), 5, 2, 'D'));
    const shut = resolveShot(firing('a', 2, 2), { x: 8.5, z: 2.5 }, grid, NO_OPEN_TILES)!;
    expect(shut.outcome).toBe('blocked');
    expect(shut.damage).toBe(0);
    expect(shut.blockedAt).toEqual({ x: 5, z: 2 });

    const open = resolveShot(firing('a', 2, 2), { x: 8.5, z: 2.5 }, grid, openTileSet('5,2'))!;
    expect(open.outcome).toBe('hit');
    expect(open.damage).toBe(damageAtDistance(6));
    expect(open.blockedAt).toBeNull();
  });

  it('never pays out damage on a blocked shot, wherever the cover stands', () => {
    for (let wallX = 3; wallX <= 8; wallX += 1) {
      const grid = draw(put(roomDraft(20, 20), wallX, 2, '1'));
      const shot = resolveShot(firing('a', 2, 2), { x: 9.5, z: 2.5 }, grid, NO_OPEN_TILES)!;
      expect(shot.outcome).toBe('blocked');
      expect(shot.damage).toBe(0);
      expect(shot.distance).toBeCloseTo(wallX - 2.5, 12);
      // The verdict is sight's, and the ray died where sight said it did.
      expect(hasLineOfSight(grid, NO_OPEN_TILES, { x: 2.5, z: 2.5 }, { x: 9.5, z: 2.5 })).toBe(false);
      expect(firstBlockingHit(grid, NO_OPEN_TILES, { x: 2.5, z: 2.5 }, { x: 9.5, z: 2.5 })).toEqual(
        { cell: { x: wallX, z: 2 }, distance: shot.distance },
      );
    }
    expect(firstBlockingHit(ROOM, NO_OPEN_TILES, { x: 2.5, z: 2.5 }, { x: 9.5, z: 2.5 })).toBeNull();
  });
});

describe('when no shot is emitted at all', () => {
  it('answers null for a guard that is not in attack', () => {
    for (const state of GUARD_STATES) {
      if (state === 'attack') continue;
      const guard: Guard = { ...firing('a', 2, 2), state };
      expect(resolveShot(guard, { x: 7.5, z: 2.5 }, ROOM, NO_OPEN_TILES)).toBeNull();
    }
  });

  // US3-S5: with the player behind cover there is no sight, so the state machine
  // never reaches `attack` and the attack tick emits nothing at all.
  it('emits nothing and never enters attack while sight is absent', () => {
    const blind: GuardWorld = {
      hasLineOfSight: () => false,
      findPath: () => ({ unreachable: true, nodesExpanded: 0 }),
    };
    const context = (tick: number): StepContext => ({
      tick,
      rng: createRng(7),
      grid: ROOM,
      doorStates: NO_OPEN_TILES,
      playerPos: { x: 3.5, z: 2.5 },
      world: blind,
    });

    let guard = createGuard({ id: 'a', x: 2.5, z: 2.5 });
    const states = new Set<string>();
    for (let tick = 0; tick < 200; tick += 1) {
      guard = stepGuard(guard, context(tick));
      states.add(guard.state);
      expect(resolveShot(guard, { x: 3.5, z: 2.5 }, ROOM, NO_OPEN_TILES)).toBeNull();
    }
    expect([...states]).toEqual(['idle']);
    expect(guard.shotsFired).toBe(0);
  });
});

describe('two guards firing on the same tick (US3-S8)', () => {
  it('computes each shot from its own distance', () => {
    const shots = resolveShots(
      [firing('near', 4, 2), firing('far', 12, 2)],
      { x: 6.5, z: 2.5 },
      ROOM,
      NO_OPEN_TILES,
    );
    expect(shots.map((shot) => shot.guardId)).toEqual(['near', 'far']);
    expect(shots[0]!.distance).toBeCloseTo(2, 12);
    expect(shots[1]!.distance).toBeCloseTo(6, 12);
    expect(shots[0]!.damage).toBe(damageAtDistance(2));
    expect(shots[1]!.damage).toBe(damageAtDistance(6));
    expect(shots[0]!.damage).toBeGreaterThan(shots[1]!.damage);
  });

  it('drops the guards that emit nothing rather than reporting a zero shot', () => {
    const idle: Guard = { ...firing('idle', 4, 2), state: 'idle' };
    const shots = resolveShots([idle, firing('firing', 5, 2)], { x: 8.5, z: 2.5 }, ROOM, NO_OPEN_TILES);
    expect(shots.map((shot) => shot.guardId)).toEqual(['firing']);
  });
});

describe('the attack module itself', () => {
  it('carries no damage literal — every number comes from the curve (FR-008)', () => {
    const source = enemySource('attack.ts');
    expect(source).toContain('damageAtDistance');
    for (const point of DAMAGE_FALLOFF_CURVE) {
      expect(
        new RegExp(`(?<![\\w.])${point.damage}(?![\\w.])`).test(source),
        `attack.ts inlines the curve value ${point.damage}`,
      ).toBe(false);
    }
  });

  it('is pure: no three.js, no DOM (FR-001)', () => {
    expectPure('attack.ts');
  });
});
