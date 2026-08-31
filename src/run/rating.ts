// [US2] The declared rating band table (FR-005, US2-S4): data in one place, so a band
// retuned is one number changed here. The rule is the mean of the axes the level offers —
// an axis with no denominator arrives as `null` from `percentOf` and is excluded rather
// than scored zero, since a run cannot be faulted for missing secrets that do not exist.

export interface RatingBand {
  readonly name: string;
  /** The lowest axis mean, 0..100, that selects this band. */
  readonly minAverage: number;
}

/** The table (FR-005), top band first. Every name is spelled from 007's stroke table
 *  (US2-S5), and the last threshold is zero so every run has a rating. */
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

/** The first threshold the mean meets, the table being ordered and its floor zero. */
export function ratingBandFor(average: number): RatingBand {
  const bottom = RATING_BANDS[RATING_BANDS.length - 1]!;
  if (!Number.isFinite(average)) return bottom;
  return RATING_BANDS.find((band) => average >= band.minAverage) ?? bottom;
}

/** The rating three percentages select (FR-005, US2-S4): a perfect run averages 100. */
export function ratingFor(
  killPercent: number | null,
  secretPercent: number | null,
  treasurePercent: number | null,
): string {
  return ratingBandFor(scoredAxisAverage(killPercent, secretPercent, treasurePercent)).name;
}
