// T032 (FR-017; US4-S6, US4-S7): the muzzle flash. The load-bearing distinction is what
// starts it: a *resolved shot*, never the fire key, so a held trigger that resolves nothing
// leaves the intensity at zero by construction. "Exactly zero" is asserted as exactly zero.

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';
import { MUZZLE_FLASH_DECAY_SECONDS, VIEWMODEL_FIRE_MOTION, createFlashState, fireMotion,
  flashIntensity, igniteFlash, resetFlash, stepFlash } from '../../src/hud/flash';

const FRAME = 1 / 60;
const lit = () => {
  const state = createFlashState();
  igniteFlash(state);
  return state;
};

describe('a resolved shot lights the flash, and only a resolved shot', () => {
  it('is at full intensity on the frame the shot resolves, from a dark start', () => {
    expect(MUZZLE_FLASH_DECAY_SECONDS).toBeGreaterThan(0);
    expect(flashIntensity(createFlashState())).toBe(0);
    expect(flashIntensity(lit())).toBe(1);
    const state = lit();
    stepFlash(state, MUZZLE_FLASH_DECAY_SECONDS / 2);
    expect(flashIntensity(state)).toBeGreaterThan(0);
    expect(flashIntensity(state)).toBeLessThan(1);
  });

  it('reaches exactly zero within the decay however finely stepped, and stays out', () => {
    expect(stepFlash(lit(), MUZZLE_FLASH_DECAY_SECONDS)).toBe(0);
    for (const delta of [FRAME, 0.001, MUZZLE_FLASH_DECAY_SECONDS / 7]) {
      const state = lit();
      let previous = 1;
      for (let elapsed = 0; elapsed < MUZZLE_FLASH_DECAY_SECONDS; elapsed += delta) {
        const now = stepFlash(state, delta);
        expect(now).toBeLessThanOrEqual(previous);
        previous = now;
      }
      // Not `toBeCloseTo`: US4-S7 says exactly zero, and the float dust accumulated
      // over the step count above is exactly what would break that.
      expect(flashIntensity(state), `delta ${delta}`).toBe(0);
      // And the view-model's fire motion, which rides this same clock, is at exact rest
      // rather than near it -- displaced while lit, zero when the flash is out (US4-S6).
      expect(fireMotion(1).back).toBeGreaterThan(0);
      expect(fireMotion(1).back).toBeLessThanOrEqual(VIEWMODEL_FIRE_MOTION.kickBack);
      expect(fireMotion(flashIntensity(state))).toEqual({ back: 0, drop: 0, pitch: 0 });
      expect(fireMotion(4)).toEqual(fireMotion(1));
      for (let frame = 0; frame < 60; frame += 1) expect(stepFlash(state, FRAME)).toBe(0);
    }
  });

  it('stays at exactly zero for a trigger that resolves nothing (US4-S7)', () => {
    const state = createFlashState();
    for (let frame = 0; frame < 600; frame += 1) {
      expect(stepFlash(state, FRAME)).toBe(0);
      expect(flashIntensity(state)).toBe(0);
    }
    igniteFlash(state);
    stepFlash(state, MUZZLE_FLASH_DECAY_SECONDS * 0.9);
    igniteFlash(state);
    expect(flashIntensity(state)).toBe(1);
    for (const delta of [Number.NaN, Number.POSITIVE_INFINITY, -1]) stepFlash(state, delta);
    expect(flashIntensity(state)).toBe(1);
    resetFlash(state);
    expect(stepFlash(state, FRAME)).toBe(0);
  });
});

// FR-017's last clause and US4-S8: "the view-model MUST NOT be the origin of any ray". A
// structural claim, so it is asserted structurally rather than by firing a shot and hoping the
// number that came back would have been different. Two halves: nothing under `src/hud/` can
// reach the shot path, and the shot path reaches the camera in exactly one place.

const SRC = fileURLToPath(new URL('../../src/', import.meta.url));

const tsFilesUnder = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? tsFilesUnder(join(dir, entry.name))
      : entry.name.endsWith('.ts') ? [join(dir, entry.name)] : []);

describe('the view-model is never the origin of a ray (FR-017, US4-S8)', () => {
  it('keeps the shot path out of the presentation modules, and the trace in the combat system', () => {
    const files = tsFilesUnder(SRC).map((path) => ({ path: relative(SRC, path), text: readFileSync(path, 'utf8') }));
    const seen = files.filter((f) => f.path.startsWith('hud/') || f.path.startsWith('systems/hud/'));
    expect(seen.map((f) => f.path)).toContain('hud/viewmodel.ts');
    expect(seen.map((f) => f.path)).toContain('systems/hud/register.ts');
    for (const { path, text } of seen) {
      expect(/from\s+['"][^'"]*\/(hitscan|spread|fire-control)['"]/.test(text), path).toBe(false);
      expect(/getWorldDirection|getWorldPosition/.test(text), path).toBe(false);
    }
    expect(files.filter((f) => /\btraceShot\s*\(/.test(f.text)).map((f) => f.path).sort())
      .toEqual(['combat/hitscan.ts', 'systems/combat/register.ts']);
    const combatSystem = files.find((f) => f.path === 'systems/combat/register.ts')!.text;
    expect(combatSystem).toMatch(/camera\.getWorldPosition/);
    expect(combatSystem).toMatch(/camera\.getWorldDirection/);
    expect(/from\s+['"][^'"]*\/(viewmodel|compose|flash|portrait|glyphs)['"]/.test(combatSystem)).toBe(false);
  });
});
