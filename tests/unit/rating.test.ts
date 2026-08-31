// T013 (FR-005; US2-S4). Every claim is made against `RATING_BANDS` itself rather than a
// hard-coded expectation, so a band added, retuned or reordered is caught by the table's
// own invariants. The one literal claim is US2-S4's perfect run.

import { describe, expect, it } from 'vitest';
import { RATING_BANDS, ratingBandFor, ratingFor, scoredAxisAverage, type RatingBand } from '../../src/run/rating';

const top = (): RatingBand => RATING_BANDS[0]!;
const bottom = (): RatingBand => RATING_BANDS[RATING_BANDS.length - 1]!;

describe('the declared rating band table (FR-005)', () => {
  it('is ordered from the top band down, names each once, and reaches the floor', () => {
    expect(RATING_BANDS.length).toBeGreaterThan(1);
    for (let index = 1; index < RATING_BANDS.length; index += 1) {
      expect(RATING_BANDS[index]!.minAverage).toBeLessThan(RATING_BANDS[index - 1]!.minAverage);
    }
    expect(new Set(RATING_BANDS.map((band) => band.name)).size).toBe(RATING_BANDS.length);
    expect(bottom().minAverage).toBe(0);
    expect(top().minAverage).toBe(100);
  });

  it('selects the band whose threshold a run meets, and never a lower one', () => {
    for (const band of RATING_BANDS) {
      expect(ratingBandFor(band.minAverage)).toBe(band);
      // A hair under is the band below, which is what makes the threshold a threshold.
      if (band !== bottom()) expect(ratingBandFor(band.minAverage - 0.001)).not.toBe(band);
    }
    for (const average of [0, -1, -100]) expect(ratingBandFor(average)).toBe(bottom());
  });
});

describe('the rating a run selects (US2-S4)', () => {
  it('averages the three axes it was supplied', () => {
    expect(scoredAxisAverage(100, 50, 0)).toBeCloseTo(50, 10);
    expect(scoredAxisAverage(30, 30, 30)).toBeCloseTo(30, 10);
  });

  it('selects the top band on a perfect run, the bottom on a run that took nothing', () => {
    expect(ratingFor(100, 100, 100)).toBe(top().name);
    expect(ratingFor(0, 0, 0)).toBe(bottom().name);
    // One axis short of perfect is one band down, which is what a band is.
    expect(ratingFor(100, 100, 99)).not.toBe(top().name);
  });

  it('selects each band in turn from percentages that average to its threshold', () => {
    for (const band of RATING_BANDS) {
      const axis = band.minAverage;
      expect(ratingFor(axis, axis, axis)).toBe(band.name);
    }
  });

  it('excludes an axis the level does not offer rather than scoring it zero', () => {
    // A level with no secrets cannot be faulted for a run that found none.
    expect(scoredAxisAverage(100, null, 100)).toBeCloseTo(100, 10);
    expect(ratingFor(100, null, 100)).toBe(top().name);
    expect(ratingFor(100, 100, null)).toBe(top().name);
  });

  it('answers the bottom band when the level offers no axis at all', () => {
    expect(scoredAxisAverage(null, null, null)).toBe(0);
    expect(ratingFor(null, null, null)).toBe(bottom().name);
  });

  it('refuses a nonsense percentage rather than rating a run NaN', () => {
    expect(ratingFor(Number.NaN, Number.NaN, Number.NaN)).toBe(bottom().name);
    expect(ratingFor(Number.POSITIVE_INFINITY, 100, 100)).toBe(top().name);
  });
});
