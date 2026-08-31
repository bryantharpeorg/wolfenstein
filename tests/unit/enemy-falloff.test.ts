// T018 (FR-008, US3-S1, US3-S2): the damage curve is a *table*, and every damage
// number a shot ever deals is read out of it. These assertions are written
// against the exported breakpoints rather than against literals copied here, so
// retuning the curve retunes the test with it — what is pinned is the shape:
// ordered, strictly decreasing, everywhere positive, and exact at a breakpoint.

import { describe, expect, it } from 'vitest';
import {
  DAMAGE_FALLOFF_CURVE,
  FALLOFF_MAX_DAMAGE,
  FALLOFF_MAX_RANGE_CELLS,
  FALLOFF_MIN_DAMAGE,
  FALLOFF_MIN_RANGE_CELLS,
  damageAtDistance,
} from '../../src/enemy/falloff';
import { ATTACK_RANGE_CELLS } from '../../src/enemy/states';
import { expectPure } from './enemy-pure';

const first = DAMAGE_FALLOFF_CURVE[0]!;
const last = DAMAGE_FALLOFF_CURVE[DAMAGE_FALLOFF_CURVE.length - 1]!;

describe('the declared damage falloff curve', () => {
  it('is a table of at least two breakpoints', () => {
    expect(DAMAGE_FALLOFF_CURVE.length).toBeGreaterThanOrEqual(2);
  });

  it('is ordered by increasing distance and strictly decreasing damage', () => {
    for (let i = 1; i < DAMAGE_FALLOFF_CURVE.length; i += 1) {
      const previous = DAMAGE_FALLOFF_CURVE[i - 1]!;
      const current = DAMAGE_FALLOFF_CURVE[i]!;
      expect(current.distanceCells).toBeGreaterThan(previous.distanceCells);
      expect(current.damage).toBeLessThan(previous.damage);
    }
  });

  it('deals positive damage at every declared breakpoint', () => {
    for (const point of DAMAGE_FALLOFF_CURVE) {
      expect(point.damage).toBeGreaterThan(0);
    }
  });

  it('names its minimum and maximum range from the table, not from a literal', () => {
    expect(FALLOFF_MIN_RANGE_CELLS).toBe(first.distanceCells);
    expect(FALLOFF_MAX_RANGE_CELLS).toBe(last.distanceCells);
    expect(FALLOFF_MAX_DAMAGE).toBe(first.damage);
    expect(FALLOFF_MIN_DAMAGE).toBe(last.damage);
  });
});

describe('damageAtDistance', () => {
  // US3-S1: the number a shot deals is the table's, evaluated — never inlined.
  it('returns exactly the table value at each declared breakpoint', () => {
    for (const point of DAMAGE_FALLOFF_CURVE) {
      expect(damageAtDistance(point.distanceCells)).toBe(point.damage);
    }
  });

  // US3-S2, stated as the spec states it: near beats far, and both are lethal.
  it('deals strictly more at the near breakpoint than at the far one, both above zero', () => {
    const near = damageAtDistance(FALLOFF_MIN_RANGE_CELLS);
    const far = damageAtDistance(FALLOFF_MAX_RANGE_CELLS);
    expect(near).toBeGreaterThan(far);
    expect(far).toBeGreaterThan(0);
  });

  it('interpolates linearly between two breakpoints', () => {
    for (let i = 1; i < DAMAGE_FALLOFF_CURVE.length; i += 1) {
      const previous = DAMAGE_FALLOFF_CURVE[i - 1]!;
      const current = DAMAGE_FALLOFF_CURVE[i]!;
      const midpoint = (previous.distanceCells + current.distanceCells) / 2;
      expect(damageAtDistance(midpoint)).toBeCloseTo((previous.damage + current.damage) / 2, 10);
    }
  });

  it('never increases with distance across a fine sweep of the declared range', () => {
    let previous = Infinity;
    for (let d = 0; d <= FALLOFF_MAX_RANGE_CELLS + 4; d += 0.05) {
      const damage = damageAtDistance(d);
      expect(damage).toBeLessThanOrEqual(previous + 1e-12);
      expect(damage).toBeGreaterThan(0);
      previous = damage;
    }
  });

  it('clamps below the minimum range and beyond the maximum range', () => {
    expect(damageAtDistance(0)).toBe(FALLOFF_MAX_DAMAGE);
    expect(damageAtDistance(-5)).toBe(FALLOFF_MAX_DAMAGE);
    expect(damageAtDistance(FALLOFF_MAX_RANGE_CELLS * 10)).toBe(FALLOFF_MIN_DAMAGE);
  });

  it('answers a non-finite distance with the far end rather than NaN', () => {
    expect(damageAtDistance(Number.NaN)).toBe(FALLOFF_MIN_DAMAGE);
    expect(damageAtDistance(Infinity)).toBe(FALLOFF_MIN_DAMAGE);
  });

  // The curve has to cover the range a guard may actually shoot at, or every
  // real shot would be evaluated on a clamped tail.
  it('covers the range a guard attacks from', () => {
    expect(ATTACK_RANGE_CELLS).toBeGreaterThanOrEqual(FALLOFF_MIN_RANGE_CELLS);
    expect(ATTACK_RANGE_CELLS).toBeLessThanOrEqual(FALLOFF_MAX_RANGE_CELLS);
  });

  it('is pure: no three.js, no DOM (FR-001)', () => {
    expectPure('falloff.ts');
  });
});
