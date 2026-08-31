// T031 (FR-016; US4-S4, US4-S5): the face portrait. Each threshold is crossed downward by
// the smallest step that matters, so "changes at exactly that threshold" is a claim about
// the boundary rather than about a value comfortably inside a band.

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { DEATH_PORTRAIT_INDEX, HEALTH_BANDS, PORTRAIT_COUNT, bandForHealth,
  portraitIndexForHealth, portraitShapes } from '../../src/hud/portrait';
import { MAX_HEALTH, MIN_HEALTH } from '../../src/combat/vitals';

const HUD_DIR = fileURLToPath(new URL('../../src/hud/', import.meta.url));
const ceilingOf = (index: number): number =>
  index === 0 ? MAX_HEALTH : HEALTH_BANDS[index - 1]!.minHealth - 0.001;

describe('the declared health bands', () => {
  it('changes the portrait at exactly each threshold as health crosses it downward', () => {
    expect(HEALTH_BANDS.length).toBeGreaterThanOrEqual(2);
    expect(DEATH_PORTRAIT_INDEX).toBe(HEALTH_BANDS.length);
    expect(PORTRAIT_COUNT).toBe(HEALTH_BANDS.length + 1);
    expect(HEALTH_BANDS[0]!.minHealth).toBeLessThanOrEqual(MAX_HEALTH);
    expect(HEALTH_BANDS.at(-1)!.minHealth).toBeGreaterThan(MIN_HEALTH);
    HEALTH_BANDS.forEach((band, index) => {
      expect(band.index).toBe(index);
      expect(portraitIndexForHealth(band.minHealth)).toBe(index);
      expect(bandForHealth(band.minHealth)).toBe(band);
      expect(portraitIndexForHealth(band.minHealth - 0.001)).toBe(index + 1);
      expect(portraitIndexForHealth((band.minHealth + ceilingOf(index)) / 2)).toBe(index);
      expect(portraitIndexForHealth(ceilingOf(index))).toBe(index);
    });
  });

  it('shows the top portrait at full health and the death portrait at zero', () => {
    for (const health of [MAX_HEALTH, MAX_HEALTH + 50, Number.POSITIVE_INFINITY]) {
      expect(portraitIndexForHealth(health)).toBe(0);
    }
    for (const health of [MIN_HEALTH, -10, Number.NaN, Number.NEGATIVE_INFINITY]) {
      expect(portraitIndexForHealth(health)).toBe(DEATH_PORTRAIT_INDEX);
    }
    expect(bandForHealth(MIN_HEALTH)).toBeNull();
  });
});

describe('the portraits are drawn by code (US4-S5)', () => {
  it('gives every band, and death, its own recipe of shapes in the unit square', () => {
    const rendered = new Set<string>();
    for (let index = 0; index < PORTRAIT_COUNT; index += 1) {
      const shapes = portraitShapes(index);
      expect(shapes.length, `portrait ${index} draws nothing`).toBeGreaterThan(0);
      rendered.add(JSON.stringify(shapes));
      for (const shape of shapes) {
        expect(shape.color).toMatch(/^#[0-9a-f]{6}$/i);
        for (const value of shape.points.flat()) expect(value >= 0 && value <= 1).toBe(true);
        expect(shape.points.length).toBeGreaterThanOrEqual(shape.kind === 'polygon' ? 3 : 2);
      }
    }
    expect(rendered.size).toBe(PORTRAIT_COUNT);
    for (const index of [-1, PORTRAIT_COUNT, 1.5]) expect(portraitShapes(index)).toEqual([]);
  });

  it('yields the same portrait for the same band on every call', () => {
    for (let index = 0; index < HEALTH_BANDS.length; index += 1) {
      expect(portraitShapes(index)).toEqual(portraitShapes(index));
      expect(portraitShapes(portraitIndexForHealth(HEALTH_BANDS[index]!.minHealth)))
        .toEqual(portraitShapes(portraitIndexForHealth(ceilingOf(index))));
    }
  });

  it('loads no image file to draw a face', () => {
    const banned = /(new\s+Image\b|HTMLImageElement|createImageBitmap|\bfetch\s*\(|data:image\/|\.src\s*=)/;
    for (const entry of readdirSync(HUD_DIR).filter((name) => name.endsWith('.ts'))) {
      expect(banned.test(readFileSync(join(HUD_DIR, entry), 'utf8')), `${entry} loads an image`).toBe(false);
    }
  });
});
