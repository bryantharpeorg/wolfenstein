// T028 (US4): index 0 is due north, and eight evenly spaced bearings pick eight
// distinct indices in 0..7 (FR-010, US4-S3).

import { describe, it, expect } from 'vitest';
import {
  VIEW_ANGLE_COUNT as N,
  VIEW_ANGLE_STEP_RADIANS as STEP,
  bearingFromDelta,
  viewAngleIndex,
  viewAngleIndexFromPositions,
  wrapAngle,
} from '../../src/enemy/view-angle';
import { expectPure } from './enemy-pure';

const DEG = Math.PI / 180;

describe('viewAngleIndex', () => {
  it('imports neither three.js nor a DOM API', () => {
    expectPure('view-angle.ts');
  });

  it('declares eight angles a full turn apart, wrapping into [0, 2*PI)', () => {
    expect(N).toBe(8);
    expect(STEP * N).toBeCloseTo(Math.PI * 2, 12);
    for (const angle of [0, -0.0001, Math.PI * 2, -7 * Math.PI, 19.5]) {
      expect(wrapAngle(angle)).toBeGreaterThanOrEqual(0);
      expect(wrapAngle(angle)).toBeLessThan(Math.PI * 2);
    }
    expect(wrapAngle(1.25)).toBeCloseTo(1.25, 12);
  });

  // US4-S3, first half: due north relative to the guard is index 0.
  it('selects index 0 whenever the viewer bearing matches the guard yaw', () => {
    expect(viewAngleIndex(0, 0)).toBe(0);
    for (const yaw of [0.7, -2.2, Math.PI, 5.9]) expect(viewAngleIndex(yaw, yaw)).toBe(0);
  });

  // US4-S3, second half: eight evenly spaced bearings, eight distinct indices.
  it('visits every index exactly once around the circle', () => {
    expect(Array.from({ length: N }, (_, s) => viewAngleIndex(0, s * STEP))).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    const offAxis = new Set(Array.from({ length: N }, (_, s) => viewAngleIndex(1.1, 1.1 + s * STEP)));
    expect(offAxis.size).toBe(N);
  });

  it('rotates the index with the guard, not with the world', () => {
    // The viewer stands still due north while the guard turns an eighth each time,
    // so the sprite it sees walks backwards around the sheet.
    expect(Array.from({ length: N }, (_, s) => viewAngleIndex(s * STEP, 0))).toEqual([0, 7, 6, 5, 4, 3, 2, 1]);
    for (let deg = -720; deg <= 720; deg += 7) {
      const index = viewAngleIndex(0.37, deg * DEG);
      expect(Number.isInteger(index) && index >= 0 && index < N).toBe(true);
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
  // The repository's convention: yaw 0 looks down -Z and positive yaw turns left
  // (src/player/look.ts), so due north is -Z.
  it('follows the repository yaw convention, and inverts it', () => {
    expect(bearingFromDelta(0, -1)).toBeCloseTo(0, 12);
    expect(wrapAngle(bearingFromDelta(-1, 0))).toBeCloseTo(Math.PI / 2, 12);
    expect(wrapAngle(bearingFromDelta(0, 1))).toBeCloseTo(Math.PI, 12);
    for (const yaw of [0, 0.5, 1.9, -2.6, 3.0]) {
      expect(wrapAngle(bearingFromDelta(-Math.sin(yaw), -Math.cos(yaw)))).toBeCloseTo(wrapAngle(yaw), 12);
    }
  });
});

describe('viewAngleIndexFromPositions', () => {
  const guard = { x: 32, z: 32, facing: 0 };

  // US4-S4 in miniature: eight orbit positions, eight distinct readings, and no
  // consecutive repeat.
  it('yields eight distinct indices around an orbit of eight steps, starting north', () => {
    const readings = Array.from({ length: N }, (_, step) =>
      viewAngleIndexFromPositions(guard, {
        x: guard.x - Math.sin(step * STEP) * 6,
        z: guard.z - Math.cos(step * STEP) * 6,
      }),
    );
    expect(readings[0]).toBe(0);
    expect(new Set(readings).size).toBe(N);
    for (let i = 1; i < readings.length; i += 1) expect(readings[i]).not.toBe(readings[i - 1]);
  });

  it('falls back to the guard-facing frame when the viewer stands on the guard', () => {
    expect(viewAngleIndexFromPositions(guard, { x: 32, z: 32 })).toBe(0);
  });
});
