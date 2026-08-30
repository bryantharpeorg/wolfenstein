import { describe, it, expect } from 'vitest';
import { applyLook, clampPitch, wrapYaw } from '../../src/player/look';
import {
  getMovementParams,
  setSensitivityPitch,
  setSensitivityYaw,
  PITCH_LIMIT_RAD,
} from '../../src/player/params';

describe('look', () => {
  it('100 units of horizontal delta yields exactly 100 * sensitivityYaw radians, turning right', () => {
    const { sensitivityYaw, sensitivityPitch } = getMovementParams();
    const result = applyLook(
      { yaw: 0, pitch: 0 },
      { deltaX: 100, deltaY: 0 },
      sensitivityYaw,
      sensitivityPitch,
    );
    expect(result.yaw).toBeCloseTo(-100 * sensitivityYaw, 10);
    expect(result.pitch).toBe(0);
  });

  it('100 units of vertical delta yields exactly 100 * sensitivityPitch radians', () => {
    const { sensitivityYaw, sensitivityPitch } = getMovementParams();
    const result = applyLook(
      { yaw: 0, pitch: 0 },
      { deltaX: 0, deltaY: 100 },
      sensitivityYaw,
      sensitivityPitch,
    );
    expect(result.pitch).toBeCloseTo(-100 * sensitivityPitch, 10);
    expect(result.yaw).toBe(0);
  });

  it('the same total delta split over 1 and over 20 calls agrees to within 1e-6', () => {
    const { sensitivityYaw, sensitivityPitch } = getMovementParams();
    const once = applyLook(
      { yaw: 0, pitch: 0 },
      { deltaX: 100, deltaY: 50 },
      sensitivityYaw,
      sensitivityPitch,
    );
    let state = { yaw: 0, pitch: 0 };
    for (let i = 0; i < 20; i += 1) {
      state = applyLook(state, { deltaX: 5, deltaY: 2.5 }, sensitivityYaw, sensitivityPitch);
    }
    expect(Math.abs(state.yaw - once.yaw)).toBeLessThan(1e-6);
    expect(Math.abs(state.pitch - once.pitch)).toBeLessThan(1e-6);
  });

  it('unbounded upward delta leaves pitch within ±89° and free of NaN', () => {
    const { sensitivityYaw, sensitivityPitch } = getMovementParams();
    let state = { yaw: 0, pitch: 0 };
    for (let i = 0; i < 1000; i += 1) {
      state = applyLook(state, { deltaX: 0, deltaY: -1000 }, sensitivityYaw, sensitivityPitch);
    }
    expect(Number.isNaN(state.pitch)).toBe(false);
    expect(state.pitch).toBeLessThanOrEqual(PITCH_LIMIT_RAD);
    expect(state.pitch).toBeGreaterThanOrEqual(-PITCH_LIMIT_RAD);
  });

  it('unbounded downward delta clamps pitch at the lower limit', () => {
    const { sensitivityYaw, sensitivityPitch } = getMovementParams();
    let state = { yaw: 0, pitch: 0 };
    for (let i = 0; i < 1000; i += 1) {
      state = applyLook(state, { deltaX: 0, deltaY: 1000 }, sensitivityYaw, sensitivityPitch);
    }
    expect(Number.isNaN(state.pitch)).toBe(false);
    expect(state.pitch).toBeCloseTo(-PITCH_LIMIT_RAD, 10);
  });

  it('halving both sensitivities halves the angular change', () => {
    const { sensitivityYaw, sensitivityPitch } = getMovementParams();
    const full = applyLook(
      { yaw: 0, pitch: 0 },
      { deltaX: 100, deltaY: 100 },
      sensitivityYaw,
      sensitivityPitch,
    );
    const half = applyLook(
      { yaw: 0, pitch: 0 },
      { deltaX: 100, deltaY: 100 },
      sensitivityYaw / 2,
      sensitivityPitch / 2,
    );
    expect(half.yaw).toBeCloseTo(full.yaw / 2, 10);
    expect(half.pitch).toBeCloseTo(full.pitch / 2, 10);
  });

  it('setters change the sensitivities at runtime without a reload', () => {
    const originalYaw = getMovementParams().sensitivityYaw;
    const originalPitch = getMovementParams().sensitivityPitch;
    setSensitivityYaw(originalYaw / 2);
    setSensitivityPitch(originalPitch / 2);
    expect(getMovementParams().sensitivityYaw).toBeCloseTo(originalYaw / 2, 10);
    expect(getMovementParams().sensitivityPitch).toBeCloseTo(originalPitch / 2, 10);
    setSensitivityYaw(originalYaw);
    setSensitivityPitch(originalPitch);
  });

  it('wrapYaw wraps angles into [-π, π]', () => {
    expect(wrapYaw(0)).toBe(0);
    expect(wrapYaw(Math.PI * 2)).toBeCloseTo(0, 10);
    expect(wrapYaw(-Math.PI * 2)).toBeCloseTo(0, 10);
    expect(wrapYaw(Math.PI + 0.1)).toBeCloseTo(-Math.PI + 0.1, 10);
    expect(wrapYaw(-Math.PI - 0.1)).toBeCloseTo(Math.PI - 0.1, 10);
  });

  it('clampPitch clamps to ±89° and never returns NaN', () => {
    expect(clampPitch(0)).toBe(0);
    expect(clampPitch(PITCH_LIMIT_RAD)).toBe(PITCH_LIMIT_RAD);
    expect(clampPitch(-PITCH_LIMIT_RAD)).toBe(-PITCH_LIMIT_RAD);
    expect(clampPitch(100)).toBe(PITCH_LIMIT_RAD);
    expect(clampPitch(-100)).toBe(-PITCH_LIMIT_RAD);
    expect(Number.isNaN(clampPitch(Number.NaN))).toBe(false);
    expect(clampPitch(Number.POSITIVE_INFINITY)).toBe(PITCH_LIMIT_RAD);
    expect(clampPitch(Number.NEGATIVE_INFINITY)).toBe(-PITCH_LIMIT_RAD);
  });
});
