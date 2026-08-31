// The bearing arithmetic behind a billboard's sprite column (FR-010, US4-S3).
// Pure: no DOM, no three.js (FR-001).
//
// The convention is the codebase's own: bearing 0 is due north (-Z, the yaw a
// guard with `facing === 0` looks along) and `b` names `(-sin b, -cos b)` — what
// `step.ts`'s `yawToward` and `camera.rotation.y` already mean, so a bearing and
// a facing can be subtracted at all, and column 0 is the guard's front.

/** Columns on the sheet, one per 45 degrees of relative bearing (FR-009). */
export const VIEW_ANGLE_COUNT = 8;

/** The angular width of one column. */
export const VIEW_ANGLE_STEP_RADIANS = (Math.PI * 2) / VIEW_ANGLE_COUNT;

const TWO_PI = Math.PI * 2;

/** A position on the level plane, in cell units — the units guards use. */
export interface Bearing2D {
  readonly x: number;
  readonly z: number;
}

/** The same direction, named in `[0, 2*PI)`. */
export function normalizeAngle(radians: number): number {
  const wrapped = radians % TWO_PI;
  return wrapped < 0 ? wrapped + TWO_PI : wrapped;
}

/** The bearing from `from` to `to`. Coincident points answer 0, not NaN, so a
 *  camera standing on a guard still picks a column. */
export function bearingBetween(from: Bearing2D, to: Bearing2D): number {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  if (dx === 0 && dz === 0) return 0;
  return normalizeAngle(Math.atan2(-dx, -dz));
}

/** The sheet column for a guard facing `guardYaw` seen from `cameraBearing` —
 *  the bearing *of the camera as seen from the guard*, so the difference is what
 *  the eye sees: 0 the front, 4 the back (FR-010, US4-S3). Rounding, not
 *  flooring, puts index 0 astride due north rather than starting at it. */
export function viewAngleIndex(guardYaw: number, cameraBearing: number): number {
  const relative = normalizeAngle(cameraBearing - guardYaw);
  return Math.round(relative / VIEW_ANGLE_STEP_RADIANS) % VIEW_ANGLE_COUNT;
}

/** The column for a camera at `camera` looking at a guard at `guard`: the
 *  composition the billboard system calls, so no call site restates the above. */
export function viewAngleFor(guard: Bearing2D, guardYaw: number, camera: Bearing2D): number {
  return viewAngleIndex(guardYaw, bearingBetween(guard, camera));
}
