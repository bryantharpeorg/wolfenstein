import { describe, it, expect } from 'vitest';
import { advanceBob, createBobState } from '../../src/player/bob';
import { WALK_SPEED, BOB_SETTLE_MS, SPEED_EPSILON } from '../../src/player/params';

const FRAME_MS = 1000 / 60;

describe('bob', () => {
  it('120 frames at zero measured speed produce exactly zero offset', () => {
    let state = createBobState();
    for (let i = 0; i < 120; i += 1) {
      state = advanceBob(state, 0, FRAME_MS);
      expect(state.offset).toBe(0);
    }
  });

  it('is exactly zero while speed is below the declared epsilon', () => {
    let state = createBobState();
    for (let i = 0; i < 60; i += 1) {
      state = advanceBob(state, SPEED_EPSILON * 0.5, FRAME_MS);
      expect(state.offset).toBe(0);
    }
  });

  it('120 frames at walk speed oscillate symmetrically about zero with peak-to-peak 0.02-0.08 and 3-5 cycles/sec', () => {
    let state = createBobState();
    let max = 0;
    let min = 0;
    for (let i = 0; i < 120; i += 1) {
      state = advanceBob(state, WALK_SPEED, FRAME_MS);
      if (state.offset > max) max = state.offset;
      if (state.offset < min) min = state.offset;
    }

    const peakToPeak = max - min;
    expect(peakToPeak).toBeGreaterThanOrEqual(0.02);
    expect(peakToPeak).toBeLessThanOrEqual(0.08);
    // Symmetric about zero: the positive peak equals the negative peak.
    expect(max).toBeCloseTo(-min, 6);

    // 120 frames at 60 fps is 2 seconds of travel; 3-5 cycles/sec is 6-10 cycles.
    const cycles = state.phase / (2 * Math.PI);
    expect(cycles).toBeGreaterThanOrEqual(6);
    expect(cycles).toBeLessThanOrEqual(10);
  });

  it('half speed lowers both amplitude and frequency', () => {
    let full = createBobState();
    let fullMax = 0;
    for (let i = 0; i < 60; i += 1) {
      full = advanceBob(full, WALK_SPEED, FRAME_MS);
      if (full.offset > fullMax) fullMax = full.offset;
    }
    const fullCycles = full.phase / (2 * Math.PI);

    let half = createBobState();
    let halfMax = 0;
    for (let i = 0; i < 60; i += 1) {
      half = advanceBob(half, WALK_SPEED / 2, FRAME_MS);
      if (half.offset > halfMax) halfMax = half.offset;
    }
    const halfCycles = half.phase / (2 * Math.PI);

    expect(halfMax).toBeLessThan(fullMax);
    expect(halfCycles).toBeLessThan(fullCycles);
  });

  it('offset returns to within 1e-4 of zero no later than 250ms after motion stops', () => {
    let state = createBobState();
    // Advance at walk speed until the offset is near its peak.
    for (let i = 0; i < 4; i += 1) {
      state = advanceBob(state, WALK_SPEED, FRAME_MS);
    }
    expect(Math.abs(state.offset)).toBeGreaterThan(0.01);

    // Stop: advance at zero speed for the declared settle time.
    const settleFrames = Math.ceil(BOB_SETTLE_MS / FRAME_MS);
    for (let i = 0; i < settleFrames; i += 1) {
      state = advanceBob(state, 0, FRAME_MS);
    }
    expect(Math.abs(state.offset)).toBeLessThan(1e-4);
  });
});
