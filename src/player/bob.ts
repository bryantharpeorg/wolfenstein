// Head-bob: a pure phase integrator advancing on distance travelled, returning a
// camera-y offset whose amplitude and frequency scale with measured horizontal
// speed. No three.js, no DOM, so it runs under `npm run test` (FR-013).
//
// The offset is `amplitude * sin(phase)` where amplitude scales with speed and
// phase advances with distance, so both amplitude and frequency fall as speed
// falls. Below the declared speed epsilon the offset is exactly zero in the
// steady state, and after motion stops it is damped back to within 1e-4 of zero
// within the declared settle time.

import { WALK_SPEED, BOB_AMPLITUDE, BOB_FREQUENCY, BOB_SETTLE_MS, SPEED_EPSILON } from './params';

// Time constant for the settle decay. After BOB_SETTLE_MS the offset is exp(-6)
// ≈ 2.5e-3 of its value; from the peak amplitude BOB_AMPLITUDE that is 7.4e-5,
// below the 1e-4 FR-013 requires within 250 ms.
const SETTLE_TAU_MS = BOB_SETTLE_MS / 6;

/** The bob's accumulated phase and current camera-y offset. */
export interface BobState {
  phase: number;
  offset: number;
}

export function createBobState(): BobState {
  return { phase: 0, offset: 0 };
}

/**
 * Advances the bob by one frame. `speed` is the measured horizontal speed in
 * world units per second; `dtMs` is the frame delta in milliseconds. When speed
 * is below the epsilon the offset decays toward zero; otherwise the phase
 * advances with the distance travelled and the offset oscillates.
 */
export function advanceBob(state: BobState, speed: number, dtMs: number): BobState {
  if (speed < SPEED_EPSILON) {
    const decay = Math.exp(-dtMs / SETTLE_TAU_MS);
    let offset = state.offset * decay;
    if (Math.abs(offset) < 1e-6) offset = 0;
    return { phase: state.phase, offset };
  }

  const dt = dtMs / 1000;
  const distance = speed * dt;
  const phase = state.phase + (2 * Math.PI * BOB_FREQUENCY * distance) / WALK_SPEED;
  const amplitude = BOB_AMPLITUDE * (speed / WALK_SPEED);
  return { phase, offset: amplitude * Math.sin(phase) };
}
