// Locomotion: a pure function from the live key set, camera yaw and sprint flag
// to a desired horizontal velocity. No three.js, no DOM, so it runs under
// `npm run test` (FR-011, FR-012).
//
// Conventions (three.js, YXZ euler order): at yaw 0 the camera faces -Z, so the
// forward horizontal basis vector is (-sin yaw, -cos yaw) and the right vector is
// (cos yaw, -sin yaw). Opposite key pairs cancel to exactly zero before any
// normalisation, and diagonals are normalised so no combination exceeds the
// current base speed.

import { WALK_SPEED, SPRINT_SPEED } from './params';

/** The live movement key set, produced by the keyboard adapter. */
export interface MovementKeys {
  forward: boolean;
  back: boolean;
  left: boolean;
  right: boolean;
  sprint: boolean;
}

/** A desired horizontal velocity in world units per second. */
export interface DesiredVelocity {
  x: number;
  z: number;
}

/**
 * Computes the desired horizontal velocity from the key set and camera yaw.
 * Opposite pairs (W/S, A/D) cancel to exactly zero; a diagonal (e.g. W+A) is
 * normalised to the base speed rather than √2 times it; Shift selects the sprint
 * speed. Both speeds are read from the single MovementParams table.
 */
export function computeDesiredVelocity(keys: MovementKeys, yaw: number): DesiredVelocity {
  const forwardInput = (keys.forward ? 1 : 0) - (keys.back ? 1 : 0);
  const rightInput = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);

  // No net input (including a cancelled opposite pair): exactly zero, with no
  // floating-point residue from the trig below.
  if (forwardInput === 0 && rightInput === 0) {
    return { x: 0, z: 0 };
  }

  let fx = forwardInput;
  let fz = rightInput;
  if (fx !== 0 && fz !== 0) {
    const invSqrt2 = 1 / Math.SQRT2;
    fx *= invSqrt2;
    fz *= invSqrt2;
  }

  const speed = keys.sprint ? SPRINT_SPEED : WALK_SPEED;
  const sin = Math.sin(yaw);
  const cos = Math.cos(yaw);

  return {
    x: (-sin * fx + cos * fz) * speed,
    z: (-cos * fx - sin * fz) * speed,
  };
}
