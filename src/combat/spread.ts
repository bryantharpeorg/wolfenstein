// Shot spread, seeded (FR-005). Pure: no DOM, no three.js (FR-001).
//
// The spread of shot n is a function of the seed and n alone — not of call order
// or elapsed frames — so a miss is a fact rather than an anecdote. The generator
// is 006's (Constitution V), and the angle is the declared maximum times the root
// of a uniform: even over the cone's disc, bounded by construction.

import { createRng } from '../enemy/rng';

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** The run's spread seed, so a whole session's aim repeats. */
export const SPREAD_SEED = 0x53505244;

/** The per-shot stride: `world.ts`'s constant, so no two shots share a stream. */
export const SPREAD_STREAM_STRIDE = 0x9e3779b9;

/** What a degenerate input falls back to: three.js's forward. */
const FALLBACK_FORWARD: Vec3 = { x: 0, y: 0, z: -1 };

/** How near vertical forward may be before the basis swaps helper. */
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

/** The direction shot `shotIndex` leaves on. Unit length, and never further
 *  from `forward` than the weapon's declared `maxSpreadRadians`. */
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

  // An orthonormal basis about the forward axis, the helper swapped when the
  // camera looks near-vertically and world up would make a short cross.
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

/** The first `count` shots of one stream. */
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

/** The angle between two directions, through the cross product rather than `acos`
 *  of the dot, which near one loses the digits a spread-cone angle needs. */
export function angleFromForward(forward: Vec3, direction: Vec3): number {
  const a = normalise(forward);
  const b = normalise(direction);
  const perpendicular = cross(a, b);
  return Math.atan2(Math.hypot(perpendicular.x, perpendicular.y, perpendicular.z), dot(a, b));
}
