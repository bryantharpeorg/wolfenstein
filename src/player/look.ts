// Mouse look: a pure function over accumulated raw mouse deltas returning the
// new yaw and pitch. No three.js, no DOM, so it runs under `npm run test`.
//
// Conventions (three.js, YXZ euler order):
//   - yaw is rotation around the world Y axis; positive turns left, so a
//     positive horizontal delta (mouse right) decreases yaw to turn right.
//   - pitch is rotation around the world X axis; positive looks up, so a
//     positive vertical delta (mouse down) decreases pitch to look down.
// Yaw is wrapped modulo 2π; pitch is clamped to PITCH_LIMIT_RAD so the camera
// can never flip and never carries NaN into the camera matrix (FR-002, FR-003).

import { PITCH_LIMIT_RAD } from './params';

export interface LookState {
  yaw: number;
  pitch: number;
}

export interface LookDelta {
  deltaX: number;
  deltaY: number;
}

/** Wraps an angle into [-π, π]. */
export function wrapYaw(yaw: number): number {
  const twoPi = Math.PI * 2;
  let wrapped = yaw % twoPi;
  if (wrapped > Math.PI) wrapped -= twoPi;
  else if (wrapped < -Math.PI) wrapped += twoPi;
  return wrapped;
}

/** Clamps pitch to ±PITCH_LIMIT_RAD, never returning NaN. */
export function clampPitch(pitch: number): number {
  const clamped = Math.max(-PITCH_LIMIT_RAD, Math.min(PITCH_LIMIT_RAD, pitch));
  return Number.isNaN(clamped) ? 0 : clamped;
}

/**
 * Applies one accumulated mouse delta to a look state. Linear in the delta, so
 * a given total delta produces the same angular change whether it arrives in one
 * call or many (US1-S5).
 */
export function applyLook(
  state: LookState,
  delta: LookDelta,
  sensitivityYaw: number,
  sensitivityPitch: number,
): LookState {
  return {
    yaw: wrapYaw(state.yaw - delta.deltaX * sensitivityYaw),
    pitch: clampPitch(state.pitch - delta.deltaY * sensitivityPitch),
  };
}
