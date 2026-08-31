// Which of the eight sprite columns a viewer sees (FR-010, US4-S3). Pure arithmetic
// over two yaws — no DOM, no three.js (Article III). The convention is inherited: yaw
// 0 looks down -Z (`src/player/look.ts`, `src/enemy/guard.ts`) and positive yaw turns
// left, so due north is -Z. Index 0 is the *front* view — the viewer stands on the
// bearing the guard faces — and index 4 its back.

/** Columns on the sheet, one per view angle (FR-009). */
export const VIEW_ANGLE_COUNT = 8;

export const VIEW_ANGLE_STEP_RADIANS = (Math.PI * 2) / VIEW_ANGLE_COUNT;

const TWO_PI = Math.PI * 2;

export function wrapAngle(angle: number): number {
  const wrapped = angle % TWO_PI;
  return wrapped < 0 ? wrapped + TWO_PI : wrapped + 0;
}

export function bearingFromDelta(dx: number, dz: number): number {
  return Math.atan2(-dx, -dz);
}

/**
 * The column for a guard at `guardYaw` seen from `cameraBearing` — the bearing
 * *from the guard to the viewer*, not the direction the camera looks. Rounding,
 * not flooring, is what puts index 0 at due north: index `i` owns the 45-degree
 * band centred on `i * 45` (US4-S3).
 */
export function viewAngleIndex(guardYaw: number, cameraBearing: number): number {
  const relative = wrapAngle(cameraBearing - guardYaw);
  return (Math.round(relative / VIEW_ANGLE_STEP_RADIANS) % VIEW_ANGLE_COUNT) + 0;
}

export interface OrientedGuard {
  readonly x: number;
  readonly z: number;
  readonly facing: number;
}

export function viewAngleIndexFromPositions(
  guard: OrientedGuard,
  viewer: { readonly x: number; readonly z: number },
): number {
  const dx = viewer.x - guard.x;
  const dz = viewer.z - guard.z;
  if (dx === 0 && dz === 0) return 0;
  return viewAngleIndex(guard.facing, bearingFromDelta(dx, dz));
}
