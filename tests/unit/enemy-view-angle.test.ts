// T028 (FR-010, US4-S3): the bearing arithmetic that picks a sprite column.
//
// US4's "it never spins like a flat card" reduces to this function being a
// bijection from eight evenly spaced viewer bearings onto `0..7` — asserted
// directly rather than inferred from pixels, with index 0 pinned to due north.

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
  it('maps every angle into [0, 2*PI) without changing the direction', () => {
    for (const radians of [0, -0.001, -Math.PI, -7 * Math.PI, 2 * Math.PI, 9.5, -12.25]) {
      const normalized = normalizeAngle(radians);
      expect(normalized).toBeGreaterThanOrEqual(0);
      expect(normalized).toBeLessThan(2 * Math.PI);
      expect(Math.cos(normalized)).toBeCloseTo(Math.cos(radians), 10);
      expect(Math.sin(normalized)).toBeCloseTo(Math.sin(radians), 10);
    }
  });
});

describe('bearingBetween', () => {
  // Bearing 0 is due north and `b` names `(-sin b, -cos b)`: the convention
  // `step.ts`'s `yawToward` and `camera.rotation.y` already use, so a bearing
  // and a facing can be subtracted from one another at all.
  it('agrees with the yaw convention: north is zero, and yaw turns toward west', () => {
    const guard = { x: 5, z: 5 };
    expect(bearingBetween(guard, { x: 5, z: 3 })).toBeCloseTo(0, 12);
    expect(bearingBetween(guard, { x: 3, z: 5 })).toBeCloseTo(Math.PI / 2, 12);
    expect(bearingBetween(guard, { x: 5, z: 7 })).toBeCloseTo(Math.PI, 12);
    expect(bearingBetween(guard, { x: 7, z: 5 })).toBeCloseTo((3 * Math.PI) / 2, 12);
  });

  // The property the convention exists for: a guard that has turned to face a
  // point sees that point at relative bearing 0, and so shows its front column.
  it('puts a guard that faces a point at column 0 from that point', () => {
    const guard = { x: 12, z: 20 };
    for (const camera of [{ x: 12, z: 14 }, { x: 17, z: 20 }, { x: 8, z: 25 }, { x: 12.5, z: 20.5 }]) {
      // `yawToward` in `step.ts` is `atan2(-dx, -dz)`: the same function.
      const facing = Math.atan2(-(camera.x - guard.x), -(camera.z - guard.z));
      expect(viewAngleIndex(facing, bearingBetween(guard, camera))).toBe(0);
    }
  });

  it('is independent of distance, and answers zero for a coincident point', () => {
    expect(bearingBetween({ x: 0, z: 0 }, { x: 1, z: -1 })).toBeCloseTo(
      bearingBetween({ x: 0, z: 0 }, { x: 40, z: -40 }),
      12,
    );
    expect(bearingBetween({ x: 2, z: 2 }, { x: 2, z: 2 })).toBe(0);
  });
});

describe('viewAngleIndex', () => {
  it('chooses index 0 for a viewer due north of a north-facing guard (US4-S3)', () => {
    expect(viewAngleIndex(0, 0)).toBe(0);
  });

  it('holds index 0 across the whole first column, and leaves it at the edges', () => {
    const halfColumn = VIEW_ANGLE_STEP_RADIANS / 2;
    expect(viewAngleIndex(0, halfColumn * 0.99)).toBe(0);
    expect(viewAngleIndex(0, -halfColumn * 0.99)).toBe(0);
    expect(viewAngleIndex(0, halfColumn * 1.01)).toBe(1);
    expect(viewAngleIndex(0, -halfColumn * 1.01)).toBe(7);
  });

  it('sends eight evenly spaced bearings to eight distinct indices (FR-010)', () => {
    const indices = ORBIT.map((bearing) => viewAngleIndex(0, bearing));
    expect(indices).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(new Set(indices).size).toBe(VIEW_ANGLE_COUNT);
  });

  it('stays distinct and non-repeating however guard and viewer are turned', () => {
    // A guard rotating under a fixed viewer changes column just as an orbiting
    // viewer does: the index is the *relative* bearing either way.
    expect(new Set(ORBIT.map((yaw) => viewAngleIndex(yaw, 0))).size).toBe(VIEW_ANGLE_COUNT);
    for (const guardYaw of [0, 0.3, 1, -2.2, Math.PI, 5.9, -7.7]) {
      const indices = ORBIT.map((bearing) => viewAngleIndex(guardYaw, guardYaw + bearing));
      expect(new Set(indices).size, `guardYaw=${guardYaw}`).toBe(VIEW_ANGLE_COUNT);
      // Consecutive orbit steps never repeat, which is US4-S4's second clause.
      for (let i = 1; i < indices.length; i += 1) expect(indices[i]).not.toBe(indices[i - 1]);
    }
  });

  it('answers an integer in 0..7 for any input, stable under whole turns', () => {
    for (const yaw of [-100, -1.5, 0, 0.7, 33]) {
      for (const bearing of [-100, -3, 0, 2.5, 1000]) {
        const index = viewAngleIndex(yaw, bearing);
        expect(Number.isInteger(index)).toBe(true);
        expect(index).toBeGreaterThanOrEqual(0);
        expect(index).toBeLessThan(VIEW_ANGLE_COUNT);
      }
    }
    for (let k = 0; k < VIEW_ANGLE_COUNT; k += 1) {
      const bearing = k * VIEW_ANGLE_STEP_RADIANS + 0.11;
      expect(viewAngleIndex(0.4, bearing)).toBe(viewAngleIndex(0.4 + 4 * Math.PI, bearing));
      expect(viewAngleIndex(0.4, bearing)).toBe(viewAngleIndex(0.4, bearing - 6 * Math.PI));
    }
  });
});
