// T032 (FR-017; US4-S6, US4-S7): the muzzle flash. The load-bearing distinction is
// what starts it. A *resolved shot* does — `igniteFlash` is the only way in, and the
// fire key never reaches this module at all, so a held trigger that resolves nothing
// (out of ammo, mid-switch, dead) leaves the intensity at zero by construction
// rather than by a branch that could be got wrong.
//
// "Exactly zero" is asserted as exactly zero, not as nearly zero: the state carries
// elapsed seconds and a lit flag rather than a decrementing remainder, so float dust
// accumulated over a hundred frames cannot leave a flash faintly alight forever.

import { describe, expect, it } from 'vitest';
import {
  MUZZLE_FLASH_DECAY_SECONDS,
  VIEWMODEL_FIRE_MOTION,
  createFlashState,
  fireMotion,
  flashIntensity,
  igniteFlash,
  resetFlash,
  stepFlash,
} from '../../src/hud/flash';

/** One frame at a declared rate, so a test reads in seconds like the system does. */
const FRAME = 1 / 60;

describe('the declared decay', () => {
  it('declares a positive, finite duration', () => {
    expect(MUZZLE_FLASH_DECAY_SECONDS).toBeGreaterThan(0);
    expect(Number.isFinite(MUZZLE_FLASH_DECAY_SECONDS)).toBe(true);
  });

  it('starts dark', () => {
    const state = createFlashState();
    expect(flashIntensity(state)).toBe(0);
  });
});

describe('a resolved shot lights the flash', () => {
  it('is above zero on the frame the shot resolves', () => {
    const state = createFlashState();
    igniteFlash(state);
    expect(flashIntensity(state)).toBeGreaterThan(0);
    // The system steps the clock, then ignites what this frame resolved, so the
    // firing frame reads full intensity.
    expect(flashIntensity(state)).toBe(1);
  });

  it('is still above zero part-way through the declared decay', () => {
    const state = createFlashState();
    igniteFlash(state);
    stepFlash(state, MUZZLE_FLASH_DECAY_SECONDS / 2);
    expect(flashIntensity(state)).toBeGreaterThan(0);
    expect(flashIntensity(state)).toBeLessThan(1);
  });

  it('falls monotonically while it decays', () => {
    const state = createFlashState();
    igniteFlash(state);
    let previous = flashIntensity(state);
    for (let frame = 0; frame < 20; frame += 1) {
      stepFlash(state, FRAME);
      const now = flashIntensity(state);
      expect(now).toBeLessThanOrEqual(previous);
      previous = now;
    }
  });

  it('reaches exactly zero within the declared decay', () => {
    const state = createFlashState();
    igniteFlash(state);
    expect(stepFlash(state, MUZZLE_FLASH_DECAY_SECONDS)).toBe(0);
    expect(flashIntensity(state)).toBe(0);
  });

  it('reaches exactly zero however finely the decay is stepped', () => {
    for (const delta of [FRAME, 0.001, MUZZLE_FLASH_DECAY_SECONDS / 7, 1 / 1000]) {
      const state = createFlashState();
      igniteFlash(state);
      let elapsed = 0;
      while (elapsed < MUZZLE_FLASH_DECAY_SECONDS) {
        stepFlash(state, delta);
        elapsed += delta;
      }
      // Not `toBeCloseTo`: US4-S7 says exactly zero, and float dust accumulated
      // over the step count above is exactly what would break that.
      expect(flashIntensity(state), `delta ${delta}`).toBe(0);
    }
  });

  it('stays out once it has decayed, however long the frame loop runs', () => {
    const state = createFlashState();
    igniteFlash(state);
    stepFlash(state, MUZZLE_FLASH_DECAY_SECONDS);
    for (let frame = 0; frame < 500; frame += 1) {
      expect(stepFlash(state, FRAME)).toBe(0);
    }
  });

  it('relights from full on a second shot', () => {
    const state = createFlashState();
    igniteFlash(state);
    stepFlash(state, MUZZLE_FLASH_DECAY_SECONDS * 0.9);
    const dim = flashIntensity(state);
    igniteFlash(state);
    expect(flashIntensity(state)).toBe(1);
    expect(flashIntensity(state)).toBeGreaterThan(dim);
  });

  it('is unmoved by a nonsense delta', () => {
    const state = createFlashState();
    igniteFlash(state);
    for (const delta of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
      stepFlash(state, delta);
      expect(flashIntensity(state)).toBe(1);
    }
  });
});

describe('the flash follows shots, not the fire key', () => {
  it('stays at exactly zero for a trigger that resolves nothing', () => {
    // A held fire key is not an argument this module takes: the only way to light
    // it is a resolved shot, so "held for 600 frames, no shot" is 600 steps.
    const state = createFlashState();
    for (let frame = 0; frame < 600; frame += 1) {
      expect(stepFlash(state, FRAME)).toBe(0);
      expect(flashIntensity(state)).toBe(0);
    }
  });

  it('goes dark again when a run is reset mid-flash', () => {
    const state = createFlashState();
    igniteFlash(state);
    resetFlash(state);
    expect(flashIntensity(state)).toBe(0);
    expect(stepFlash(state, FRAME)).toBe(0);
  });
});

describe('the view-model fire motion rides the same clock', () => {
  it('declares a motion that is a real displacement', () => {
    expect(VIEWMODEL_FIRE_MOTION.kickBack).toBeGreaterThan(0);
    expect(VIEWMODEL_FIRE_MOTION.drop).toBeGreaterThan(0);
    expect(VIEWMODEL_FIRE_MOTION.pitch).toBeGreaterThan(0);
  });

  it('sits at exact rest when the flash is out', () => {
    expect(fireMotion(0)).toEqual({ back: 0, drop: 0, pitch: 0 });
  });

  it('displaces the model while the flash is lit', () => {
    const moved = fireMotion(1);
    expect(moved.back).toBeGreaterThan(0);
    expect(moved.drop).toBeGreaterThan(0);
    expect(moved.pitch).toBeGreaterThan(0);
    expect(moved.back).toBeLessThanOrEqual(VIEWMODEL_FIRE_MOTION.kickBack);
  });

  it('returns to rest within the flash decay, because it is the flash clock', () => {
    const state = createFlashState();
    igniteFlash(state);
    expect(fireMotion(flashIntensity(state)).back).toBeGreaterThan(0);
    stepFlash(state, MUZZLE_FLASH_DECAY_SECONDS);
    expect(fireMotion(flashIntensity(state))).toEqual({ back: 0, drop: 0, pitch: 0 });
  });

  it('is at rest for a nonsense intensity rather than somewhere unpredictable', () => {
    for (const intensity of [Number.NaN, -1, Number.NEGATIVE_INFINITY]) {
      expect(fireMotion(intensity)).toEqual({ back: 0, drop: 0, pitch: 0 });
    }
    // Above one is clamped rather than extrapolated.
    expect(fireMotion(4)).toEqual(fireMotion(1));
  });
});
