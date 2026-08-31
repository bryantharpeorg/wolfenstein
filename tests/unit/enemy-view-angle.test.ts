// T028 (US4): the bearing-to-sprite-index arithmetic. Index 0 is due north, the
// eight evenly spaced bearings around the circle pick eight distinct indices,
// and the module stays DOM-free and three.js-free (FR-010, US4-S3).

import { describe, it, expect } from 'vitest';
import {
  VIEW_ANGLE_COUNT,
  VIEW_ANGLE_STEP_RADIANS,
  bearingFromDelta,
  viewAngleIndex,
  viewAngleIndexFromPositions,
  wrapAngle,
} from '../../src/enemy/view-angle';
import { expectPure } from './enemy-pure';

const DEG = Math.PI / 180;

describe('view-angle purity', () => {
  it('imports neither three.js nor a DOM API', () => {
    expectPure('view-angle.ts');
  });
});

describe('wrapAngle', () => {
  it('maps every angle into [0, 2*PI)', () => {
    for (const angle of [0, -0.0001, Math.PI * 2, -7 * Math.PI, 19.5]) {
      const wrapped = wrapAngle(angle);
      expect(wrapped).toBeGreaterThanOrEqual(0);
      expect(wrapped).toBeLessThan(Math.PI * 2);
    }
  });

  it('leaves an angle already in range untouched', () => {
    expect(wrapAngle(1.25)).toBeCloseTo(1.25, 12);
  });
});

describe('viewAngleIndex', () => {
  it('declares eight angles a full turn apart', () => {
    expect(VIEW_ANGLE_COUNT).toBe(8);
    expect(VIEW_ANGLE_STEP_RADIANS * VIEW_ANGLE_COUNT).toBeCloseTo(Math.PI * 2, 12);
  });

  // US4-S3, first half: due north relative to the guard is index 0.
  it('selects index 0 for a viewer due north of a guard facing north', () => {
    expect(viewAngleIndex(0, 0)).toBe(0);
  });

  it('selects index 0 for any guard yaw when the viewer bearing matches it', () => {
    for (const yaw of [0, 0.7, -2.2, Math.PI, 5.9]) {
      expect(viewAngleIndex(yaw, yaw)).toBe(0);
    }
  });

  // US4-S3, second half: eight evenly spaced bearings, eight distinct indices.
  it('visits every index exactly once around the circle', () => {
    const indices = [];
    for (let step = 0; step < VIEW_ANGLE_COUNT; step += 1) {
      indices.push(viewAngleIndex(0, step * VIEW_ANGLE_STEP_RADIANS));
    }
    expect(indices).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(new Set(indices).size).toBe(VIEW_ANGLE_COUNT);
  });

  it('visits every index exactly once around a circle offset from the axes', () => {
    const indices = new Set<number>();
    for (let step = 0; step < VIEW_ANGLE_COUNT; step += 1) {
      indices.add(viewAngleIndex(1.1, 1.1 + step * VIEW_ANGLE_STEP_RADIANS));
    }
    expect(indices.size).toBe(VIEW_ANGLE_COUNT);
  });

  it('rotates the index with the guard, not with the world', () => {
    // The viewer stands still due north; the guard turns a full eighth each time,
    // so the sprite the viewer sees walks backwards around the sheet.
    const seen = [];
    for (let step = 0; step < VIEW_ANGLE_COUNT; step += 1) {
      seen.push(viewAngleIndex(step * VIEW_ANGLE_STEP_RADIANS, 0));
    }
    expect(seen).toEqual([0, 7, 6, 5, 4, 3, 2, 1]);
  });

  it('returns an integer in 0..7 for arbitrary bearings', () => {
    for (let degrees = -720; degrees <= 720; degrees += 7) {
      const index = viewAngleIndex(0.37, degrees * DEG);
      expect(Number.isInteger(index)).toBe(true);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(VIEW_ANGLE_COUNT);
    }
  });

  it('rounds to the nearest angle, so each index owns a 45-degree band', () => {
    expect(viewAngleIndex(0, 22 * DEG)).toBe(0);
    expect(viewAngleIndex(0, 23 * DEG)).toBe(1);
    expect(viewAngleIndex(0, -22 * DEG)).toBe(0);
    expect(viewAngleIndex(0, -23 * DEG)).toBe(7);
  });
});

describe('bearingFromDelta', () => {
  // The repository's yaw convention: 0 looks down -Z, and positive yaw turns left
  // (src/player/look.ts). Due north is -Z.
  it('reports 0 for a step due north', () => {
    expect(bearingFromDelta(0, -1)).toBeCloseTo(0, 12);
  });

  it('reports a quarter turn for a step due west, matching the yaw convention', () => {
    expect(wrapAngle(bearingFromDelta(-1, 0))).toBeCloseTo(Math.PI / 2, 12);
  });

  it('reports a half turn for a step due south', () => {
    expect(wrapAngle(bearingFromDelta(0, 1))).toBeCloseTo(Math.PI, 12);
  });

  it('is the inverse of the yaw-to-direction convention', () => {
    for (const yaw of [0, 0.5, 1.9, -2.6, 3.0]) {
      const dx = -Math.sin(yaw);
      const dz = -Math.cos(yaw);
      expect(wrapAngle(bearingFromDelta(dx, dz))).toBeCloseTo(wrapAngle(yaw), 12);
    }
  });
});

describe('viewAngleIndexFromPositions', () => {
  const guard = { x: 32, z: 32, facing: 0 };

  it('selects index 0 for a viewer standing due north of a north-facing guard', () => {
    expect(viewAngleIndexFromPositions(guard, { x: 32, z: 20 })).toBe(0);
  });

  // US4-S4 in miniature: eight orbit positions, eight distinct readings, and no
  // consecutive repeat.
  it('yields eight distinct indices around an orbit of eight steps', () => {
    const readings = [];
    for (let step = 0; step < VIEW_ANGLE_COUNT; step += 1) {
      const bearing = step * VIEW_ANGLE_STEP_RADIANS;
      readings.push(
        viewAngleIndexFromPositions(guard, {
          x: guard.x - Math.sin(bearing) * 6,
          z: guard.z - Math.cos(bearing) * 6,
        }),
      );
    }
    expect(new Set(readings).size).toBe(VIEW_ANGLE_COUNT);
    for (let i = 1; i < readings.length; i += 1) {
      expect(readings[i]).not.toBe(readings[i - 1]);
    }
  });

  it('falls back to the guard-facing frame when the viewer stands on the guard', () => {
    expect(viewAngleIndexFromPositions(guard, { x: 32, z: 32 })).toBe(0);
  });
});
