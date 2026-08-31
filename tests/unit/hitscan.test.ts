import { describe, it, expect } from 'vitest';
import {
  GUARD_HIT_RADIUS,
  NO_GUARD,
  outOfAmmoResult,
  traceShot,
  type HitscanGuard,
  type ShotOutcome,
  type TraceOptions,
} from '../../src/combat/hitscan';

// FR-006 and US1-S6..S8 plus SC-008 and the ray Edge Cases. Every distance below
// is hand-computed from the fixture rather than read back off the implementation.
//
// The fixture: a 9-wide corridor on row 1, walls all round. Cells x=1..7 are open
// on that row, so a ray fired east from (1.5, 1.5) meets the wall at x=8.
const CORRIDOR: string[] = [
  '111111111',
  '100000001',
  '111111111',
];

const EAST = { x: 1, z: 0 };
const ORIGIN = { x: 1.5, z: 1.5 };
const CLOSED = new Set<string>();
const DAMAGE = 11;
const FAR = 100;

function shoot(overrides: Partial<TraceOptions> = {}) {
  const options: TraceOptions = {
    grid: CORRIDOR,
    doorStates: CLOSED,
    guards: [],
    origin: ORIGIN,
    direction: EAST,
    maxRange: FAR,
    damage: DAMAGE,
    ...overrides,
  };
  return traceShot(options);
}

/** Where a ray fired east from ORIGIN first touches a guard standing at `x`. */
function entryDistance(x: number): number {
  return x - ORIGIN.x - GUARD_HIT_RADIUS;
}

describe('a guard on a clear line (FR-006, US1-S6)', () => {
  it('names the guard, which guard, the distance and the declared damage', () => {
    const guards: HitscanGuard[] = [{ x: 5.5, z: 1.5 }];
    const result = shoot({ guards });
    expect(result.outcome).toBe('guard');
    expect(result.guardIndex).toBe(0);
    expect(result.distance).toBeCloseTo(entryDistance(5.5), 10);
    expect(result.damage).toBe(DAMAGE);
  });

  it('identifies the guard by its index in the list it was given', () => {
    const guards: HitscanGuard[] = [
      { x: 3.5, z: 5.5 },
      { x: 6.5, z: 1.5 },
      { x: 2.5, z: 7.5 },
    ];
    const result = shoot({ guards });
    expect(result.guardIndex).toBe(1);
    expect(result.distance).toBeCloseTo(entryDistance(6.5), 10);
  });

  it('takes only the nearer of two guards on one ray — no penetration (Edge Cases)', () => {
    const guards: HitscanGuard[] = [{ x: 6.5, z: 1.5 }, { x: 3.5, z: 1.5 }];
    const result = shoot({ guards });
    expect(result.outcome).toBe('guard');
    expect(result.guardIndex).toBe(1);
    expect(result.distance).toBeCloseTo(entryDistance(3.5), 10);
  });

  it('reports a guard standing in front of a wall as guard, never wall (Edge Cases)', () => {
    // The wall is at x=8, distance 6.5; the guard is nearer, so the body absorbs it.
    const result = shoot({ guards: [{ x: 7.5, z: 1.5 }] });
    expect(result.outcome).toBe('guard');
    expect(result.distance).toBeLessThan(8 - ORIGIN.x);
  });

  it('misses a guard standing further off the ray than the declared hit radius', () => {
    const justOff = 1.5 + GUARD_HIT_RADIUS * 2;
    expect(shoot({ guards: [{ x: 5.5, z: justOff }] }).outcome).toBe('wall');
    // ... and grazes one just inside it.
    const justOn = 1.5 + GUARD_HIT_RADIUS / 2;
    expect(shoot({ guards: [{ x: 5.5, z: justOn }] }).outcome).toBe('guard');
  });

  it('ignores a guard behind the camera and one already dead', () => {
    expect(shoot({ guards: [{ x: 0.5, z: 1.5 }] }).outcome).toBe('wall');
    expect(shoot({ guards: [{ x: 5.5, z: 1.5, alive: false }] }).outcome).toBe('wall');
  });
});

describe('a wall or a closed door terminates the ray (FR-006, US1-S7)', () => {
  it('reports wall at the hand-computed distance with zero damage', () => {
    const result = shoot();
    expect(result.outcome).toBe('wall');
    // The corridor is open through x=7; the wall face is the x=8 boundary.
    expect(result.distance).toBeCloseTo(8 - ORIGIN.x, 10);
    expect(result.damage).toBe(0);
    expect(result.guardIndex).toBe(NO_GUARD);
  });

  it('applies zero damage to a guard standing behind that wall', () => {
    // Guard at x=6.5 in the row below is off the ray; the one that matters is the
    // wall in between: a shot east from a walled-off pocket dies at the wall.
    const boxed: string[] = ['111111111', '100010001', '111111111'];
    const result = traceShot({
      grid: boxed,
      doorStates: CLOSED,
      guards: [{ x: 6.5, z: 1.5 }],
      origin: ORIGIN,
      direction: EAST,
      maxRange: FAR,
      damage: DAMAGE,
    });
    expect(result.outcome).toBe('wall');
    expect(result.distance).toBeCloseTo(4 - ORIGIN.x, 10);
    expect(result.damage).toBe(0);
    expect(result.guardIndex).toBe(NO_GUARD);
  });

  it('treats a closed door as a wall and an open one as air', () => {
    const doored: string[] = ['111111111', '10000D001', '111111111'];
    const guards: HitscanGuard[] = [{ x: 7.5, z: 1.5 }];
    const base = { grid: doored, guards, origin: ORIGIN, direction: EAST, maxRange: FAR, damage: DAMAGE };

    const shut = traceShot({ ...base, doorStates: CLOSED });
    expect(shut.outcome).toBe('wall');
    expect(shut.distance).toBeCloseTo(5 - ORIGIN.x, 10);
    expect(shut.damage).toBe(0);

    const open = traceShot({ ...base, doorStates: new Set(['5,1']) });
    expect(open.outcome).toBe('guard');
    expect(open.damage).toBe(DAMAGE);
  });

  it('does not let the ray pass a corner whose two flanking cells both block', () => {
    // A pinwheel: the open diagonal at (2,2) is reachable only through a corner
    // that walls flank on both sides, exactly as 006's sight walk refuses it.
    const pinwheel: string[] = ['1111', '1011', '1101', '1111'];
    const result = traceShot({
      grid: pinwheel,
      doorStates: CLOSED,
      guards: [{ x: 2.5, z: 2.5 }],
      origin: { x: 1.5, z: 1.5 },
      direction: { x: 1, z: 1 },
      maxRange: FAR,
      damage: DAMAGE,
    });
    expect(result.outcome).toBe('wall');
  });
});

describe('nothing within range (FR-006, US1-S8)', () => {
  it('names none rather than an empty outcome, and reports the range it flew', () => {
    const result = shoot({ maxRange: 2 });
    expect(result.outcome).toBe('none');
    expect(result.distance).toBe(2);
    expect(result.damage).toBe(0);
    expect(result.guardIndex).toBe(NO_GUARD);
  });

  it('does not reach a guard that stands beyond the declared maximum range', () => {
    expect(shoot({ guards: [{ x: 5.5, z: 1.5 }], maxRange: 2 }).outcome).toBe('none');
  });

  it('names none when the range runs out before any blocker', () => {
    const open: string[] = ['00000', '00000', '00000'];
    const result = traceShot({
      grid: open,
      doorStates: CLOSED,
      guards: [],
      origin: { x: 2.5, z: 1.5 },
      direction: { x: 0, z: -1 },
      // The grid's own edge blocks at 1.5 cells, so 1 leaves nothing in reach.
      maxRange: 1,
      damage: DAMAGE,
    });
    expect(result.outcome).toBe('none');
    expect(result.distance).toBe(1);
  });
});

describe('the result shape is total (FR-006, SC-008)', () => {
  it('always returns all four fields, never undefined', () => {
    for (const result of [
      shoot(),
      shoot({ guards: [{ x: 4.5, z: 1.5 }] }),
      shoot({ maxRange: 2 }),
      outOfAmmoResult(),
    ]) {
      expect(result).toBeDefined();
      expect(typeof result.outcome).toBe('string');
      expect(Number.isFinite(result.distance)).toBe(true);
      expect(Number.isFinite(result.damage)).toBe(true);
      expect(Number.isInteger(result.guardIndex)).toBe(true);
      expect(result.damage).toBeGreaterThanOrEqual(0);
      expect(result.distance).toBeGreaterThanOrEqual(0);
    }
  });

  it('produces every declared outcome, so no branch of FR-006 ships unexercised', () => {
    const produced = new Set<ShotOutcome>([
      shoot({ guards: [{ x: 4.5, z: 1.5 }] }).outcome,
      shoot().outcome,
      shoot({ maxRange: 2 }).outcome,
      outOfAmmoResult().outcome,
    ]);
    expect([...produced].sort()).toEqual(['guard', 'none', 'out-of-ammo', 'wall']);
  });

  it('normalises the direction it is handed, so range is measured in cells', () => {
    const doubled = shoot({ direction: { x: 4, z: 0 } });
    expect(doubled.distance).toBeCloseTo(8 - ORIGIN.x, 10);
  });

  it('refuses a zero direction with none rather than a NaN distance', () => {
    const result = shoot({ direction: { x: 0, z: 0 } });
    expect(result.outcome).toBe('none');
    expect(Number.isFinite(result.distance)).toBe(true);
  });

  it('measures a diagonal ray in cells, not in cell steps', () => {
    const room: string[] = ['11111', '10001', '10001', '10001', '11111'];
    const result = traceShot({
      grid: room,
      doorStates: CLOSED,
      guards: [],
      origin: { x: 1.5, z: 1.5 },
      direction: { x: 1, z: 1 },
      maxRange: FAR,
      damage: DAMAGE,
    });
    expect(result.outcome).toBe('wall');
    // The ray leaves the room through the corner at (4,4): 2.5 cells on each axis.
    expect(result.distance).toBeCloseTo(Math.hypot(2.5, 2.5), 10);
  });
});
