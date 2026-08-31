// Which of the eight sprite columns a viewer sees (FR-010, US4-S3).
//
// Pure arithmetic over two yaws: no DOM, no three.js, so the whole of US4's
// angle claim is provable under `npm run test` rather than by eye (Article III).
//
// Conventions, inherited rather than invented. A yaw of 0 looks down -Z — that is
// `src/player/look.ts`'s convention for the camera and `src/enemy/guard.ts`'s for
// a guard's `facing` — and positive yaw turns left. Due north is therefore -Z and
// yaw 0, which is what makes "index 0 at due north" a statement about the sheet
// rather than about a coordinate frame chosen here.
//
// Index 0 is the *front* view: the viewer stands on the bearing the guard faces,
// so the guard is looking at them. Index 4 is its back, and 1..3 and 5..7 are the
// obliques, one every 45 degrees, turning the way a guard turns.

/** Columns on the sheet, one per view angle (FR-009). */
export const VIEW_ANGLE_COUNT = 8;

/** Radians one column covers. */
export const VIEW_ANGLE_STEP_RADIANS = (Math.PI * 2) / VIEW_ANGLE_COUNT;

const TWO_PI = Math.PI * 2;

/** Wraps an angle into `[0, 2*PI)`. Unlike `wrapYaw`, the range is non-negative,
 *  because the result indexes a column and a negative index has no cell. */
export function wrapAngle(angle: number): number {
  const wrapped = angle % TWO_PI;
  if (wrapped < 0) return wrapped + TWO_PI;
  // `+ 0` collapses the negative zero `%` produces for a negative input, so a
  // north bearing is the same value however the caller arrived at it.
  return wrapped + 0;
}

/** The yaw of the direction `(dx, dz)`, in the convention above: 0 is due north
 *  (-Z) and a quarter turn is due west (-X). The inverse of
 *  `(dx, dz) = (-sin(yaw), -cos(yaw))`. */
export function bearingFromDelta(dx: number, dz: number): number {
  return Math.atan2(-dx, -dz);
}

/**
 * The sheet column for a guard at `guardYaw` seen from `cameraBearing` — the
 * bearing *from the guard to the viewer*, not the direction the camera looks.
 * Rounding, not flooring, is what puts index 0 at due north: index `i` owns the
 * 45-degree band centred on `i * 45`, so a viewer exactly north reads 0 and one
 * 22 degrees off still does (US4-S3).
 */
export function viewAngleIndex(guardYaw: number, cameraBearing: number): number {
  const relative = wrapAngle(cameraBearing - guardYaw);
  return (Math.round(relative / VIEW_ANGLE_STEP_RADIANS) % VIEW_ANGLE_COUNT) + 0;
}

/** A guard as this module needs it: where it stands and which way it looks. */
export interface OrientedGuard {
  readonly x: number;
  readonly z: number;
  readonly facing: number;
}

export interface ViewerPosition {
  readonly x: number;
  readonly z: number;
}

/**
 * The column for a guard seen from a viewer position — the form the renderer
 * calls, with the bearing derived rather than passed. A viewer standing exactly
 * on the guard has no bearing at all, and takes the front frame rather than
 * whatever `atan2(0, 0)` happens to be.
 */
export function viewAngleIndexFromPositions(
  guard: OrientedGuard,
  viewer: ViewerPosition,
): number {
  const dx = viewer.x - guard.x;
  const dz = viewer.z - guard.z;
  if (dx === 0 && dz === 0) return 0;
  return viewAngleIndex(guard.facing, bearingFromDelta(dx, dz));
}
