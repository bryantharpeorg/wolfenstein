// The bearing arithmetic behind a billboard's sprite column (FR-010, US4-S3).
// Pure: no DOM, no three.js (FR-001), so the claim "eight orbit positions yield
// eight distinct columns" is a `npm run test` fact rather than a thing to be
// judged by eye.
//
// One convention, and it is the codebase's own rather than a new one. A bearing
// of 0 is due north — the -Z direction, which is the yaw a guard with
// `facing === 0` looks along (`guard.ts`) — and a bearing `b` names the
// direction `(-sin b, -cos b)`, exactly as `step.ts`'s `yawToward` and the
// camera's `rotation.y` do. Sharing the convention is load-bearing: a bearing
// measured the other way round would put the guard's *back* on the screen at the
// moment it turned to face the player, and every column would be wrong by a
// reflection while still passing a distinctness test.
//
// The sheet's first column is therefore the guard's front: a viewer standing due
// north of a north-facing guard sees it face on, which is US4-S3's index 0.

/** Columns on the sheet, one per 45 degrees of relative bearing (FR-009). */
export const VIEW_ANGLE_COUNT = 8;

/** The angular width of one column. */
export const VIEW_ANGLE_STEP_RADIANS = (Math.PI * 2) / VIEW_ANGLE_COUNT;

const TWO_PI = Math.PI * 2;

/** A position on the level plane, in cell units — the same units guards use. */
export interface Bearing2D {
  readonly x: number;
  readonly z: number;
}

/** The same direction, named in `[0, 2*PI)`. Total: finite input, finite output. */
export function normalizeAngle(radians: number): number {
  const wrapped = radians % TWO_PI;
  return wrapped < 0 ? wrapped + TWO_PI : wrapped;
}

/**
 * The bearing from `from` to `to`, in the yaw convention above: 0 due north,
 * turning toward west. Two coincident points answer 0 rather than a NaN, so a
 * camera standing exactly on a guard still picks a column instead of blanking
 * the sprite.
 */
export function bearingBetween(from: Bearing2D, to: Bearing2D): number {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  if (dx === 0 && dz === 0) return 0;
  // The inverse of `(-sin b, -cos b)`, which is what makes a bearing directly
  // comparable with a guard's `facing` and with `camera.rotation.y`.
  return normalizeAngle(Math.atan2(-dx, -dz));
}

/**
 * The sheet column for a guard facing `guardYaw` seen from `cameraBearing` — the
 * bearing *of the camera as seen from the guard*, so the difference is what the
 * viewer's eye actually sees: 0 the guard's front, 4 its back (FR-010, US4-S3).
 *
 * Rounding, not flooring, is what puts index 0 astride due north rather than
 * starting at it: a viewer anywhere within half a column of the guard's front
 * sees the front sprite.
 */
export function viewAngleIndex(guardYaw: number, cameraBearing: number): number {
  const relative = normalizeAngle(cameraBearing - guardYaw);
  return Math.round(relative / VIEW_ANGLE_STEP_RADIANS) % VIEW_ANGLE_COUNT;
}

/** The column for a camera standing at `camera` looking at a guard at `guard` —
 *  the composition the billboard system actually calls, kept here so the two
 *  conventions above are never restated at a call site. */
export function viewAngleFor(guard: Bearing2D, guardYaw: number, camera: Bearing2D): number {
  return viewAngleIndex(guardYaw, bearingBetween(guard, camera));
}
