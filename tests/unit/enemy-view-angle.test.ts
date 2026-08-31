// T028 (FR-010, US4-S3): the bearing arithmetic that picks a sprite column.
//
// The whole of US4's "it never spins like a flat card" claim reduces to this
// function being a *bijection* from eight evenly spaced viewer bearings onto
// `0..7`. That is asserted directly here rather than inferred from pixels, and
// index 0 is pinned to due north so the sheet's first column is the guard's
// front and not an arbitrary corner.

import { describe, it, expect } from 'vitest';
import {
  VIEW_ANGLE_COUNT,
  VIEW_ANGLE_STEP_RADIANS,
  bearingBetween,
  normalizeAngle,
  viewAngleIndex,
} from '../../src/enemy/view-angle';
import { expectPure } from './enemy-pure';

/** The eight evenly spaced bearings the spec orbits through. */
const ORBIT = Array.from({ length: VIEW_ANGLE_COUNT }, (_, k) => k * VIEW_ANGLE_STEP_RADIANS);

describe('view-angle constants', () => {
  it('declares eight columns, one per 45 degrees', () => {
    expect(VIEW_ANGLE_COUNT).toBe(8);
    expect(VIEW_ANGLE_STEP_RADIANS).toBeCloseTo(Math.PI / 4, 12);
  });

  it('is pure: no DOM and no three.js (FR-001)', () => {
    expectPure('view-angle.ts');
  });
});

describe('normalizeAngle', () => {
  it('maps every angle into [0, 2*PI)', () => {
    for (const radians of [0, -0.001, -Math.PI, -7 * Math.PI, 2 * Math.PI, 9.5, -12.25]) {
      const normalized = normalizeAngle(radians);
      expect(normalized).toBeGreaterThanOrEqual(0);
      expect(normalized).toBeLessThan(2 * Math.PI);
      // Same direction, just named in range.
      expect(Math.cos(normalized)).toBeCloseTo(Math.cos(radians), 10);
      expect(Math.sin(normalized)).toBeCloseTo(Math.sin(radians), 10);
    }
  });
});

describe('bearingBetween', () => {
  // Bearing 0 is due north (-Z, the yaw a guard with facing 0 looks along) and
  // grows clockwise through east, matching the yaw convention `guard.ts` fixes.
  it('reads due north as zero and turns clockwise through east', () => {
    const guard = { x: 5, z: 5 };
    expect(bearingBetween(guard, { x: 5, z: 3 })).toBeCloseTo(0, 12);
    expect(bearingBetween(guard, { x: 7, z: 5 })).toBeCloseTo(Math.PI / 2, 12);
    expect(bearingBetween(guard, { x: 5, z: 7 })).toBeCloseTo(Math.PI, 12);
    expect(bearingBetween(guard, { x: 3, z: 5 })).toBeCloseTo((3 * Math.PI) / 2, 12);
  });

  it('is independent of distance', () => {
    const near = bearingBetween({ x: 0, z: 0 }, { x: 1, z: -1 });
    const far = bearingBetween({ x: 0, z: 0 }, { x: 40, z: -40 });
    expect(near).toBeCloseTo(far, 12);
  });

  it('answers zero for a coincident point rather than NaN', () => {
    expect(bearingBetween({ x: 2, z: 2 }, { x: 2, z: 2 })).toBe(0);
  });
});

describe('viewAngleIndex', () => {
  it('chooses index 0 for a viewer due north of a north-facing guard (US4-S3)', () => {
    expect(viewAngleIndex(0, 0)).toBe(0);
  });

  it('chooses index 0 anywhere inside the first column, either side of north', () => {
    const halfColumn = VIEW_ANGLE_STEP_RADIANS / 2;
    expect(viewAngleIndex(0, halfColumn * 0.99)).toBe(0);
    expect(viewAngleIndex(0, -halfColumn * 0.99)).toBe(0);
    // And leaves it at the boundary, in both directions.
    expect(viewAngleIndex(0, halfColumn * 1.01)).toBe(1);
    expect(viewAngleIndex(0, -halfColumn * 1.01)).toBe(7);
  });

  it('sends eight evenly spaced bearings to eight distinct indices (FR-010)', () => {
    const indices = ORBIT.map((bearing) => viewAngleIndex(0, bearing));
    expect(indices).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(new Set(indices).size).toBe(VIEW_ANGLE_COUNT);
  });

  it('keeps the orbit distinct for a guard facing any direction', () => {
    for (const guardYaw of [0, 0.3, 1, -2.2, Math.PI, 5.9, -7.7]) {
      const indices = ORBIT.map((bearing) => viewAngleIndex(guardYaw, guardYaw + bearing));
      expect(new Set(indices).size, `guardYaw=${guardYaw}`).toBe(VIEW_ANGLE_COUNT);
      // Consecutive orbit steps never repeat, which is US4-S4's second clause.
      for (let i = 1; i < indices.length; i += 1) expect(indices[i]).not.toBe(indices[i - 1]);
    }
  });

  it('turns with the guard: a guard rotating under a fixed viewer changes column', () => {
    const bearing = 0;
    const indices = ORBIT.map((yaw) => viewAngleIndex(yaw, bearing));
    expect(new Set(indices).size).toBe(VIEW_ANGLE_COUNT);
  });

  it('always answers an integer in 0..7, for any input at all', () => {
    for (const yaw of [-100, -1.5, 0, 0.7, 33]) {
      for (const bearing of [-100, -3, 0, 2.5, 1000]) {
        const index = viewAngleIndex(yaw, bearing);
        expect(Number.isInteger(index)).toBe(true);
        expect(index).toBeGreaterThanOrEqual(0);
        expect(index).toBeLessThan(VIEW_ANGLE_COUNT);
      }
    }
  });

  it('is stable under whole turns added to either argument', () => {
    for (let k = 0; k < VIEW_ANGLE_COUNT; k += 1) {
      const bearing = k * VIEW_ANGLE_STEP_RADIANS + 0.11;
      expect(viewAngleIndex(0.4, bearing)).toBe(viewAngleIndex(0.4 + 4 * Math.PI, bearing));
      expect(viewAngleIndex(0.4, bearing)).toBe(viewAngleIndex(0.4, bearing - 6 * Math.PI));
    }
  });
});
