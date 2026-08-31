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
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';
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

// FR-017's last clause and US4-S8: "the view-model MUST NOT be the origin of any
// ray". That is a structural claim, so it is asserted structurally rather than by
// firing a shot and hoping the number that comes back would have been different.
// Two halves: nothing under `src/hud/` can reach the shot path, and the shot path
// reaches the camera in exactly one place.

const SRC = fileURLToPath(new URL('../../src/', import.meta.url));

function tsFilesUnder(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...tsFilesUnder(path));
    else if (entry.name.endsWith('.ts')) found.push(path);
  }
  return found;
}

const presentation = (): { path: string; text: string }[] =>
  tsFilesUnder(SRC)
    .filter((path) => {
      const where = relative(SRC, path);
      return where.startsWith('hud/') || where.startsWith('systems/hud/');
    })
    .map((path) => ({ path: relative(SRC, path), text: readFileSync(path, 'utf8') }));

describe('the view-model is never the origin of a ray (FR-017, US4-S8)', () => {
  it('finds the presentation modules to check, so the scan is not vacuous', () => {
    const files = presentation().map((file) => file.path);
    expect(files).toContain('hud/viewmodel.ts');
    expect(files).toContain('systems/hud/register.ts');
  });

  it('reaches nothing that traces, aims or gates a shot', () => {
    const forbidden = /from\s+['"][^'"]*\/(hitscan|spread|fire-control)['"]/;
    for (const file of presentation()) {
      expect(forbidden.test(file.text), `${file.path} imports part of the shot path`).toBe(false);
    }
  });

  it('never asks the camera which way it is pointing', () => {
    // The HUD parents its quad and the view-model to the camera, which is a
    // scene-graph fact. Reading the camera's *direction* is the thing a ray
    // origin would do, and nothing here does it.
    for (const file of presentation()) {
      expect(
        /getWorldDirection|getWorldPosition/.test(file.text),
        `${file.path} reads the camera's world pose`,
      ).toBe(false);
    }
  });

  it('leaves the trace in the combat system, from the camera, and nowhere else', () => {
    const callers = tsFilesUnder(SRC)
      .filter((path) => /\btraceShot\s*\(/.test(readFileSync(path, 'utf8')))
      .map((path) => relative(SRC, path))
      .sort();
    expect(callers).toEqual(['combat/hitscan.ts', 'systems/combat/register.ts']);

    const combatSystem = readFileSync(join(SRC, 'systems/combat/register.ts'), 'utf8');
    expect(combatSystem).toMatch(/camera\.getWorldPosition/);
    expect(combatSystem).toMatch(/camera\.getWorldDirection/);
    // And it does not reach the view-model to find out where to shoot from.
    expect(/from\s+['"][^'"]*\/(viewmodel|compose|flash|portrait|glyphs)['"]/.test(combatSystem)).toBe(
      false,
    );
  });
});
