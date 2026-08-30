// The single MovementParams table: every named constant the player systems read,
// declared once so tuning never chases literals across files. Pure data: no
// three.js, no DOM.
//
// The mouse sensitivities are the only runtime-mutable entries, changed through
// the exported setters below with no page reload (FR-002, US1-S6). Everything
// else is a read-only constant that US2 and US3 import.

/** Pitch clamp: ±89 degrees of horizontal, so the camera can never flip (FR-003). */
export const PITCH_LIMIT_RAD = (89 * Math.PI) / 180;

// Collider and integration constants (US2).
export const COLLIDER_RADIUS = 0.3;
export const SUBSTEP_SIZE = 0.25;
export const DELTA_CLAMP_MS = 250;

// Camera and locomotion constants (US2, US3).
export const EYE_HEIGHT = 1.5;
export const WALK_SPEED = 3.0;
export const SPRINT_SPEED = 5.4;

// Head-bob constants (US3).
export const BOB_AMPLITUDE = 0.03;
export const BOB_FREQUENCY = 4;
export const BOB_SETTLE_MS = 250;
export const SPEED_EPSILON = 0.01;

/** The runtime-mutable subset of the params table. */
export interface MovementParams {
  sensitivityYaw: number;
  sensitivityPitch: number;
}

const movementParams: MovementParams = {
  sensitivityYaw: 0.002,
  sensitivityPitch: 0.002,
};

/** Read-only view of the mutable sensitivities, for the systems that apply them. */
export function getMovementParams(): Readonly<MovementParams> {
  return movementParams;
}

export function setSensitivityYaw(value: number): void {
  movementParams.sensitivityYaw = value;
}

export function setSensitivityPitch(value: number): void {
  movementParams.sensitivityPitch = value;
}
