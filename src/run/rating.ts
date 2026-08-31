// [US2] The declared rating band table (FR-005, US2-S4). Data in one place, so a band
// retuned is one number changed here and nowhere else; the alternative — a chain of
// comparisons at the call site — spreads the tuning across the file that draws it and
// makes "the declared bands" a thing you have to read code to find out.
//
// The selection rule is the mean of the axes the level actually offers. An axis with no
// denominator — a level with no secrets, a level with no treasure — arrives as `null`
// from `percentOf` and is *excluded* rather than scored zero, because a run cannot be
// faulted for failing to find secrets that do not exist. A level offering no axis at
// all rates at the floor: the bottom band is the answer to "nothing to measure", and
// there is always an answer, which is why no run is left unrated.

/** One band: what it is called and the mean it requires. */
export interface RatingBand {
  readonly name: string;
  /** The lowest axis mean, 0..100, that selects this band. */
  readonly minAverage: number;
}

/**
 * The table (FR-005), top band first. Every name is spelled from 007's stroke glyph
 * table (US2-S5), and the last entry's threshold is zero so every run has a rating.
 */
export const RATING_BANDS: readonly RatingBand[] = [
  { name: 'LEGEND', minAverage: 100 },
  { name: 'ACE', minAverage: 80 },
  { name: 'VETERAN', minAverage: 55 },
  { name: 'SOLDIER', minAverage: 30 },
  { name: 'ROOKIE', minAverage: 0 },
];

/** The mean of the axes that have a denominator, and zero when none does. */
export function scoredAxisAverage(
  killPercent: number | null,
  secretPercent: number | null,
  treasurePercent: number | null,
): number {
  const scored = [killPercent, secretPercent, treasurePercent].filter(
    (axis): axis is number => axis != null && Number.isFinite(axis),
  );
  if (scored.length === 0) return 0;
  return scored.reduce((sum, axis) => sum + axis, 0) / scored.length;
}

/** The band an axis mean selects. The table is ordered, so this is the first
 *  threshold the mean meets; the last entry's is zero, so there is always one. */
export function ratingBandFor(average: number): RatingBand {
  const bottom = RATING_BANDS[RATING_BANDS.length - 1]!;
  if (!Number.isFinite(average)) return bottom;
  return RATING_BANDS.find((band) => average >= band.minAverage) ?? bottom;
}

/** The rating a run's three percentages select (FR-005, US2-S4). A perfect run on
 *  all three axes averages 100 and selects the top band. */
export function ratingFor(
  killPercent: number | null,
  secretPercent: number | null,
  treasurePercent: number | null,
): string {
  return ratingBandFor(scoredAxisAverage(killPercent, secretPercent, treasurePercent)).name;
}
