// The distance-to-damage falloff curve: the one place in the codebase that says
// how much a guard's bullet takes off (FR-008). Pure: no DOM, no three.js
// (FR-001).
//
// The point of the module is negative. No call site may write a damage number:
// `attack.ts` measures a distance and asks `damageAtDistance` for the rest, so
// retuning the guards' lethality is an edit to the table below and to nothing
// else. `tests/unit/enemy-attack.test.ts` asserts that literally, by reading the
// source of the call site back and refusing any of these numbers in it.
//
// Between two breakpoints the curve is linear; outside the declared range it is
// clamped, so `damageAtDistance` is total and never returns NaN, a negative or a
// zero. A shot beyond `FALLOFF_MAX_RANGE_CELLS` still stings for
// `FALLOFF_MIN_DAMAGE` rather than falling off a cliff — and in play it cannot
// arise anyway, since a guard only fires inside `ATTACK_RANGE_CELLS`, which the
// curve's declared range contains.

/** One breakpoint of the curve: at this range, exactly this much damage. */
export interface FalloffPoint {
  /** Distance from muzzle to target, in grid cells. */
  readonly distanceCells: number;
  /** Damage dealt at exactly that distance, in health points. */
  readonly damage: number;
}

/**
 * The declared curve (FR-008). Ordered by increasing distance, strictly
 * decreasing in damage, everywhere positive — `enemy-falloff.test.ts` holds all
 * three, so a retune that breaks the shape fails the gate rather than the game.
 *
 * The values are tuned against `GUARD_MAX_HEALTH` (100) and the player's: point
 * blank is a quarter of a health bar, the edge of a guard's attack range is a
 * tenth, and the long tail exists so the curve is defined past where guards can
 * actually shoot.
 */
export const DAMAGE_FALLOFF_CURVE: readonly FalloffPoint[] = [
  { distanceCells: 1, damage: 24 },
  { distanceCells: 3, damage: 18 },
  { distanceCells: 6, damage: 10 },
  { distanceCells: 10, damage: 5 },
  { distanceCells: 16, damage: 2 },
];

const NEAR = DAMAGE_FALLOFF_CURVE[0]!;
const FAR = DAMAGE_FALLOFF_CURVE[DAMAGE_FALLOFF_CURVE.length - 1]!;

/** The near breakpoint: at or inside it, damage is `FALLOFF_MAX_DAMAGE`. */
export const FALLOFF_MIN_RANGE_CELLS = NEAR.distanceCells;
/** The far breakpoint: at or beyond it, damage is `FALLOFF_MIN_DAMAGE`. */
export const FALLOFF_MAX_RANGE_CELLS = FAR.distanceCells;
/** Damage at the near breakpoint — derived from the table, never re-declared. */
export const FALLOFF_MAX_DAMAGE = NEAR.damage;
/** Damage at the far breakpoint — likewise derived. */
export const FALLOFF_MIN_DAMAGE = FAR.damage;

/**
 * The damage a shot travelling `distanceCells` deals, read off the curve above.
 * Total: clamped at both ends, and a non-finite distance is answered at the far
 * end rather than with NaN, so a degenerate measurement can never mint damage.
 */
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
  // Unreachable: the clamps above cover everything outside the table's span.
  return FALLOFF_MIN_DAMAGE;
}
