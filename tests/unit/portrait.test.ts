// T031 (FR-016; US4-S4, US4-S5): the face portrait. Two separable claims, and the
// separation is the design: *which* portrait a health reading selects is a pure
// question about the declared bands, and *what* that portrait looks like is a
// deterministic drawing recipe of shapes with no image file behind it. The HUD's
// canvas rasterises the recipe once at load; nothing here needs a canvas to assert
// that the same band always yields the same portrait.
//
// The thresholds are asserted by crossing each one downward by the smallest step
// that matters, so "changes at exactly that threshold" is a claim about the
// boundary rather than about a value comfortably inside a band.

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import {
  DEATH_PORTRAIT_INDEX,
  HEALTH_BANDS,
  PORTRAIT_COUNT,
  bandForHealth,
  portraitIndexForHealth,
  portraitShapes,
} from '../../src/hud/portrait';
import { MAX_HEALTH, MIN_HEALTH } from '../../src/combat/vitals';

const HUD_DIR = fileURLToPath(new URL('../../src/hud/', import.meta.url));

describe('the declared health bands', () => {
  it('declares a descending, gap-free ladder that covers the whole health range', () => {
    expect(HEALTH_BANDS.length).toBeGreaterThanOrEqual(2);
    HEALTH_BANDS.forEach((band, index) => {
      expect(band.index).toBe(index);
      expect(Number.isFinite(band.minHealth)).toBe(true);
      if (index > 0) {
        expect(band.minHealth).toBeLessThan(HEALTH_BANDS[index - 1]!.minHealth);
      }
    });
    // The top band admits a player at the declared maximum, and the bottom band
    // admits a player one point from death, so no living health is unbanded.
    expect(HEALTH_BANDS[0]!.minHealth).toBeLessThanOrEqual(MAX_HEALTH);
    expect(HEALTH_BANDS[HEALTH_BANDS.length - 1]!.minHealth).toBeGreaterThan(MIN_HEALTH);
    expect(HEALTH_BANDS[HEALTH_BANDS.length - 1]!.minHealth).toBeLessThanOrEqual(1);
  });

  it('reports the top portrait at full health and the death portrait at zero', () => {
    expect(portraitIndexForHealth(MAX_HEALTH)).toBe(0);
    expect(portraitIndexForHealth(MAX_HEALTH + 50)).toBe(0);
    expect(portraitIndexForHealth(MIN_HEALTH)).toBe(DEATH_PORTRAIT_INDEX);
    expect(portraitIndexForHealth(-10)).toBe(DEATH_PORTRAIT_INDEX);
    expect(DEATH_PORTRAIT_INDEX).toBe(HEALTH_BANDS.length);
    expect(PORTRAIT_COUNT).toBe(HEALTH_BANDS.length + 1);
    expect(bandForHealth(MIN_HEALTH)).toBeNull();
  });

  it('changes the portrait at exactly each threshold as health crosses it downward', () => {
    const step = 0.001;
    HEALTH_BANDS.forEach((band, index) => {
      // On the threshold the player is still in this band...
      expect(portraitIndexForHealth(band.minHealth)).toBe(index);
      expect(bandForHealth(band.minHealth)).toBe(band);
      // ...and a hair below it they are in the next one, whatever that is.
      const below = portraitIndexForHealth(band.minHealth - step);
      expect(below).toBe(index + 1);
    });
  });

  it('holds one portrait across the whole interior of a band', () => {
    HEALTH_BANDS.forEach((band, index) => {
      const ceiling = index === 0 ? MAX_HEALTH : HEALTH_BANDS[index - 1]!.minHealth - 0.001;
      for (const health of [band.minHealth, (band.minHealth + ceiling) / 2, ceiling]) {
        expect(portraitIndexForHealth(health), `health ${health}`).toBe(index);
      }
    });
  });

  it('reads a nonsense health as death rather than as a band', () => {
    for (const health of [Number.NaN, Number.NEGATIVE_INFINITY]) {
      expect(portraitIndexForHealth(health)).toBe(DEATH_PORTRAIT_INDEX);
    }
    // Positive infinity is not a nonsense *reading* of a living player: it is
    // above every threshold, so it is the healthiest portrait.
    expect(portraitIndexForHealth(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe('the portraits are drawn by code', () => {
  it('gives every band, and death, a recipe of shapes', () => {
    for (let index = 0; index < PORTRAIT_COUNT; index += 1) {
      const shapes = portraitShapes(index);
      expect(shapes.length, `portrait ${index} draws nothing`).toBeGreaterThan(0);
      for (const shape of shapes) {
        expect(shape.color).toMatch(/^#[0-9a-f]{6}$/i);
        for (const [x, y] of shape.points) {
          // The unit square, so the recipe owes nothing to a pixel size.
          expect(x).toBeGreaterThanOrEqual(0);
          expect(x).toBeLessThanOrEqual(1);
          expect(y).toBeGreaterThanOrEqual(0);
          expect(y).toBeLessThanOrEqual(1);
        }
        if (shape.kind === 'polygon') expect(shape.points.length).toBeGreaterThanOrEqual(3);
        else expect(shape.points.length).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('yields the same portrait for the same band on every call', () => {
    for (let index = 0; index < PORTRAIT_COUNT; index += 1) {
      expect(portraitShapes(index)).toEqual(portraitShapes(index));
      // Same band, two different health readings inside it: one portrait.
      if (index < HEALTH_BANDS.length) {
        const band = HEALTH_BANDS[index]!;
        const ceiling = index === 0 ? MAX_HEALTH : HEALTH_BANDS[index - 1]!.minHealth - 0.001;
        expect(portraitShapes(portraitIndexForHealth(band.minHealth))).toEqual(
          portraitShapes(portraitIndexForHealth(ceiling)),
        );
      }
    }
  });

  it('draws a different face for every band', () => {
    const rendered = new Set<string>();
    for (let index = 0; index < PORTRAIT_COUNT; index += 1) {
      rendered.add(JSON.stringify(portraitShapes(index)));
    }
    expect(rendered.size).toBe(PORTRAIT_COUNT);
  });

  it('returns nothing for an index no band declares', () => {
    expect(portraitShapes(-1)).toEqual([]);
    expect(portraitShapes(PORTRAIT_COUNT)).toEqual([]);
    expect(portraitShapes(1.5)).toEqual([]);
  });

  it('loads no image file to draw a face', () => {
    // Constitution II: an `Image`, a `fetch` or a data URL would each be a way to
    // smuggle a bitmap in past `tools/check-no-binaries.mjs`.
    const banned = /(new\s+Image\b|HTMLImageElement|createImageBitmap|\bfetch\s*\(|data:image\/|\.src\s*=)/;
    for (const entry of readdirSync(HUD_DIR).filter((name) => name.endsWith('.ts'))) {
      const text = readFileSync(join(HUD_DIR, entry), 'utf8');
      expect(banned.test(text), `${entry} loads an image`).toBe(false);
    }
  });
});
