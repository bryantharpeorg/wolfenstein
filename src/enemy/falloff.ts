// The declared distance-to-damage curve and its evaluator (FR-008). Pure: no
// DOM, no three.js (FR-001).
//
// The module is negative in intent: no call site may write a damage number, so
// `attack.ts` measures a distance and asks here for the rest. Between
// breakpoints the curve is linear and outside them it is clamped, which makes
// `damageAtDistance` total — never NaN, never negative, never zero.

/** One breakpoint: at this range, exactly this much damage. */
export interface FalloffPoint {
  readonly distanceCells: number;
  readonly damage: number;
}

/** The curve (FR-008): ordered by distance, strictly decreasing, all positive.
 *  `enemy-falloff.test.ts` holds that shape, so a bad retune fails the gate. */
export const DAMAGE_FALLOFF_CURVE: readonly FalloffPoint[] = [
  { distanceCells: 1, damage: 24 },
  { distanceCells: 3, damage: 18 },
  { distanceCells: 6, damage: 10 },
  { distanceCells: 10, damage: 5 },
  { distanceCells: 16, damage: 2 },
];

const NEAR = DAMAGE_FALLOFF_CURVE[0]!;
const FAR = DAMAGE_FALLOFF_CURVE[DAMAGE_FALLOFF_CURVE.length - 1]!;

/** The declared breakpoints, derived from the table and never re-declared. */
export const FALLOFF_MIN_RANGE_CELLS = NEAR.distanceCells;
export const FALLOFF_MAX_RANGE_CELLS = FAR.distanceCells;
export const FALLOFF_MAX_DAMAGE = NEAR.damage;
export const FALLOFF_MIN_DAMAGE = FAR.damage;

/** The damage a shot travelling `distanceCells` deals, read off the curve. */
export function damageAtDistance(distanceCells: number): number {
  if (!Number.isFinite(distanceCells)) return FALLOFF_MIN_DAMAGE;
  if (distanceCells <= FALLOFF_MIN_RANGE_CELLS) return FALLOFF_MAX_DAMAGE;
  if (distanceCells >= FALLOFF_MAX_RANGE_CELLS) return FALLOFF_MIN_DAMAGE;

  for (let i = 1; i < DAMAGE_FALLOFF_CURVE.length; i += 1) {
    const lower = DAMAGE_FALLOFF_CURVE[i - 1]!;
    const upper = DAMAGE_FALLOFF_CURVE[i]!;
    if (distanceCells > upper.distanceCells) continue;
    const span = upper.distanceCells - lower.distanceCells;
    const travelled = (distanceCells - lower.distanceCells) / span;
    return lower.damage + (upper.damage - lower.damage) * travelled;
  }
  return FALLOFF_MIN_DAMAGE;
}
