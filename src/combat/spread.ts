// Shot spread, seeded (FR-005). Pure: no DOM, no three.js (FR-001).
//
// The point of the seed is that a miss becomes a fact rather than an anecdote.
// The spread of shot n is a function of the run's seed and n alone — not of call
// order, not of how many frames have elapsed, not of a shared generator another
// system might advance — so two runs of one script deflect the same twenty shots
// the same twenty ways, and a test can say which.
//
// The generator is 006's, imported rather than restated (Constitution V), and
// derived per shot the same way `world.ts` derives one per guard: one stride
// added to the seed. The angle is the declared maximum times the square root of
// a uniform, which spreads shots evenly over the cone's disc instead of crowding
// them on the axis, and it is bounded by that maximum by construction — there is
// no rejection loop that could return a wider vector on an unlucky draw.

import { createRng } from '../enemy/rng';

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** The run's spread seed. One number, so a whole session's aim repeats. */
export const SPREAD_SEED = 0x53505244;

/** The per-shot stride: the golden-ratio constant `world.ts` uses per guard, so
 *  two shot indices never share a stream. */
export const SPREAD_STREAM_STRIDE = 0x9e3779b9;

/** The forward axis a degenerate input falls back to: three.js's own. */
const FALLBACK_FORWARD: Vec3 = { x: 0, y: 0, z: -1 };

/** How nearly vertical a forward axis may be before the basis picks its other
 *  helper: any threshold below one works, and this one keeps the cross product
 *  well away from zero length. */
const VERTICAL_HELPER_LIMIT = 0.9;

const TWO_PI = Math.PI * 2;

function normalise(v: Vec3): Vec3 {
  const length = Math.hypot(v.x, v.y, v.z);
  if (!(length > 0)) return FALLBACK_FORWARD;
  return { x: v.x / length, y: v.y / length, z: v.z / length };
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

/**
 * The direction shot `shotIndex` actually leaves on, given the camera forward
 * axis and the active weapon's declared maximum spread. Unit length, and never
 * further from `forward` than `maxSpreadRadians`.
 */
export function spreadDirection(
  forward: Vec3,
  maxSpreadRadians: number,
  seed: number,
  shotIndex: number,
): Vec3 {
  const axis = normalise(forward);
  if (!(maxSpreadRadians > 0)) return axis;

  const rng = createRng((seed + Math.imul(shotIndex, SPREAD_STREAM_STRIDE)) | 0);
  const angle = maxSpreadRadians * Math.sqrt(rng.nextFloat());
  const azimuth = rng.nextFloat() * TWO_PI;

  // An orthonormal basis about the forward axis. The helper is swapped when the
  // camera looks near-vertically, where the world up would make a short cross.
  const helper: Vec3 =
    Math.abs(axis.y) < VERTICAL_HELPER_LIMIT ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  const right = normalise(cross(helper, axis));
  const up = cross(axis, right);

  const alongAxis = Math.cos(angle);
  const offAxis = Math.sin(angle);
  const ca = Math.cos(azimuth);
  const sa = Math.sin(azimuth);
  return {
    x: axis.x * alongAxis + (right.x * ca + up.x * sa) * offAxis,
    y: axis.y * alongAxis + (right.y * ca + up.y * sa) * offAxis,
    z: axis.z * alongAxis + (right.z * ca + up.z * sa) * offAxis,
  };
}

/** The first `count` shots of one stream, for a test or a diagnostic dump. */
export function spreadSequence(
  forward: Vec3,
  maxSpreadRadians: number,
  seed: number,
  count: number,
): Vec3[] {
  const vectors: Vec3[] = [];
  for (let index = 0; index < count; index += 1) {
    vectors.push(spreadDirection(forward, maxSpreadRadians, seed, index));
  }
  return vectors;
}

/**
 * The angle in radians between two directions, measured through the cross
 * product rather than through `acos` of the dot alone: at the small angles a
 * spread cone actually produces, `acos` near one loses most of its significant
 * digits and would report a bound violation that is not there.
 */
export function angleFromForward(forward: Vec3, direction: Vec3): number {
  const a = normalise(forward);
  const b = normalise(direction);
  const perpendicular = cross(a, b);
  return Math.atan2(Math.hypot(perpendicular.x, perpendicular.y, perpendicular.z), dot(a, b));
}
