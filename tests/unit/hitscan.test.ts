import { describe, it, expect } from 'vitest';
import {
  GUARD_HIT_RADIUS, NO_GUARD, outOfAmmoResult, traceShot, type HitscanGuard, type ShotOutcome,
  type ShotResult, type TraceOptions,
} from '../../src/combat/hitscan';

// FR-006, US1-S6..S8, SC-008, Edge Cases. Every distance is hand-computed from
// the fixture, not read off the implementation: a corridor open at x=1..7, so a
// ray east from (1.5, 1.5) meets the wall face at x=8, 6.5 cells out.
const CORRIDOR = ['111111111', '100000001', '111111111'];
const DOORED = ['111111111', '10000D001', '111111111'];
const WALLED = ['111111111', '100010001', '111111111'];
const ORIGIN = { x: 1.5, z: 1.5 };
const DAMAGE = 11;

const shoot = (overrides: Partial<TraceOptions> = {}): ShotResult =>
  traceShot({
    grid: CORRIDOR,
    doorStates: new Set<string>(),
    guards: [],
    origin: ORIGIN,
    direction: { x: 1, z: 0 },
    maxRange: 100,
    damage: DAMAGE,
    ...overrides,
  });

/** A guard on the corridor row unless placed off it. */
const g = (x: number, z = 1.5, alive?: boolean): HitscanGuard => ({ x, z, alive });

/** Where a ray east from ORIGIN first touches a guard standing at `x`. */
const entry = (x: number) => x - ORIGIN.x - GUARD_HIT_RADIUS;

/** name, trace overrides, outcome, damage, distance, guardIndex. */
type Case = [string, Partial<TraceOptions>, ShotOutcome, number, number?, number?];

const NEAR_MISS = 1.5 + GUARD_HIT_RADIUS * 2;
const GRAZE = 1.5 + GUARD_HIT_RADIUS / 2;

const CASES: Case[] = [
  // A guard on a clear line (US1-S6): named, identified, measured, damaged.
  ['a guard on a clear line', { guards: [g(5.5)] }, 'guard', DAMAGE, entry(5.5), 0],
  ['the guard at its index in the list', { guards: [g(3.5, 5.5), g(6.5), g(2.5, 7.5)] }, 'guard', DAMAGE, entry(6.5), 1],
  ['only the nearer of two guards on one ray', { guards: [g(6.5), g(3.5)] }, 'guard', DAMAGE, entry(3.5), 1],
  ['a guard in front of a wall, never the wall', { guards: [g(7.5)] }, 'guard', DAMAGE, entry(7.5), 0],
  ['a graze just inside the hit radius', { guards: [g(5.5, GRAZE)] }, 'guard', DAMAGE],
  ['a miss just outside it', { guards: [g(5.5, NEAR_MISS)] }, 'wall', 0],
  ['no hit on a guard behind the camera', { guards: [g(0.5)] }, 'wall', 0],
  ['no hit on a guard already dead', { guards: [g(5.5, 1.5, false)] }, 'wall', 0],

  // A wall or a closed door terminates the ray (US1-S7): zero damage, no guard.
  ['a wall at the hand-computed distance', {}, 'wall', 0, 6.5, NO_GUARD],
  ['a wall, zero damage to the guard behind it', { grid: WALLED, guards: [g(6.5)] }, 'wall', 0, 2.5, NO_GUARD],
  ['a closed door as a wall', { grid: DOORED, guards: [g(7.5)] }, 'wall', 0, 3.5, NO_GUARD],
  ['the same door opened as air', { grid: DOORED, guards: [g(7.5)], doorStates: new Set(['5,1']) }, 'guard', DAMAGE, entry(7.5), 0],
  // A pinwheel: the open diagonal at (2,2) is reachable only through a corner
  // walls flank on both sides, exactly as 006's sight walk refuses it.
  ['no pass through a corner both cells flank', { grid: ['1111', '1011', '1101', '1111'], guards: [g(2.5, 2.5)], direction: { x: 1, z: 1 } }, 'wall', 0, undefined, NO_GUARD],

  // Nothing within range (US1-S8): `none`, never an empty outcome.
  ['none, with the range flown, when nothing is in reach', { maxRange: 2 }, 'none', 0, 2, NO_GUARD],
  ['none for a guard beyond the declared maximum range', { guards: [g(5.5)], maxRange: 2 }, 'none', 0, 2],
  // The grid edge blocks 1.5 cells north, so a range of 1 reaches nothing.
  ['none when the range runs out before any blocker', { grid: ['00000', '00000', '00000'], origin: { x: 2.5, z: 1.5 }, direction: { x: 0, z: -1 }, maxRange: 1 }, 'none', 0, 1],

  // The ray's own arithmetic.
  ['a direction normalised, so range is in cells', { direction: { x: 4, z: 0 } }, 'wall', 0, 6.5],
  ['none, not NaN, for a zero direction', { direction: { x: 0, z: 0 } }, 'none', 0, 0],
  // The ray leaves the room through the corner at (4,4): 2.5 cells on each axis.
  ['a diagonal measured in cells, not steps', { grid: ['11111', '10001', '10001', '10001', '11111'], direction: { x: 1, z: 1 } }, 'wall', 0, Math.hypot(2.5, 2.5)],
];

describe('one ray, one outcome (FR-006, US1-S6, US1-S7, US1-S8)', () => {
  it.each(CASES)('resolves %s', (_name, shot, outcome, damage, distance, guardIndex) => {
    const result = shoot(shot);
    expect(result.outcome).toBe(outcome);
    expect(result.damage).toBe(damage);
    if (distance !== undefined) expect(result.distance).toBeCloseTo(distance, 10);
    if (guardIndex !== undefined) expect(result.guardIndex).toBe(guardIndex);
  });

  it('lets a body in front of a wall absorb the shot the wall would have stopped', () => {
    expect(shoot({ guards: [g(7.5)] }).distance).toBeLessThan(6.5);
  });
});

describe('the result shape is total (FR-006, SC-008)', () => {
  const everyOutcome = [shoot({ guards: [g(4.5)] }), shoot(), shoot({ maxRange: 2 }), outOfAmmoResult()];

  it('always returns all four fields, never undefined', () => {
    for (const result of everyOutcome) {
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
    const produced = new Set<ShotOutcome>(everyOutcome.map((r) => r.outcome));
    expect([...produced].sort()).toEqual(['guard', 'none', 'out-of-ammo', 'wall']);
  });
});
