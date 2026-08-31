// T035 (FR-017; US4-S6, US4-S7): the muzzle flash, as arithmetic. Pure — no DOM,
// no three.js — so the whole of FR-017 is asserted under `npm run test`.
//
// What starts the flash is the requirement. A *resolved shot* does, and the fire
// key never reaches this module at all: `igniteFlash` is the only way in, and the
// combat system calls it once per shot the fire control actually resolved. A
// trigger held while out of ammo, mid-switch or dead resolves nothing, so it lights
// nothing — not because a branch checks for those cases, but because there is no
// path from a key to this state (US4-S7).
//
// The clock is elapsed-since-the-shot with a lit flag, not a decrementing
// remainder. That is deliberate: US4-S7 asks for *exactly* zero, and a remainder
// stepped by a hundred floating-point frame deltas can land a whisker above zero
// and leave a flash faintly alight for the rest of the run.

/** The declared decay (FR-017): a shot's flash is out this many seconds later. */
export const MUZZLE_FLASH_DECAY_SECONDS = 0.12;

/** The view-model's declared fire motion, in metres and radians at full
 *  intensity. It rides the flash's clock, so it returns to rest exactly when the
 *  flash does — one duration, declared once (US4-S6). */
export const VIEWMODEL_FIRE_MOTION = {
  kickBack: 0.055,
  drop: 0.028,
  pitch: 0.12,
} as const;

export interface FlashState {
  /** Seconds since the shot that lit it; meaningless while `lit` is false. */
  secondsSinceShot: number;
  /** False once the decay has fully elapsed, and the reason zero is exact. */
  lit: boolean;
}

export function createFlashState(): FlashState {
  return { secondsSinceShot: 0, lit: false };
}

/** Called once per shot the fire control resolved, and from nowhere else. */
export function igniteFlash(state: FlashState): void {
  state.secondsSinceShot = 0;
  state.lit = true;
}

/** Back to dark, for a restart mid-flash. */
export function resetFlash(state: FlashState): void {
  state.secondsSinceShot = 0;
  state.lit = false;
}

/** Intensity in `[0, 1]`, and exactly `0` once the decay has elapsed. */
export function flashIntensity(state: Readonly<FlashState>): number {
  if (!state.lit) return 0;
  return Math.min(1, Math.max(0, 1 - state.secondsSinceShot / MUZZLE_FLASH_DECAY_SECONDS));
}

/** Advances the decay by one frame and reports the intensity that frame renders.
 *  A nonsense delta advances nothing rather than corrupting the clock. */
export function stepFlash(state: FlashState, deltaSeconds: number): number {
  if (!state.lit) return 0;
  if (Number.isFinite(deltaSeconds) && deltaSeconds > 0) {
    state.secondsSinceShot += deltaSeconds;
    if (state.secondsSinceShot >= MUZZLE_FLASH_DECAY_SECONDS) {
      // Latched rather than clamped: from here the intensity is zero by the flag,
      // whatever the accumulated float says.
      state.secondsSinceShot = MUZZLE_FLASH_DECAY_SECONDS;
      state.lit = false;
    }
  }
  return flashIntensity(state);
}

/** How far the view-model is displaced at `intensity`. Zero intensity is exact
 *  rest, so the model returns to where it started rather than near it (US4-S6). */
export function fireMotion(intensity: number): { back: number; drop: number; pitch: number } {
  const eased = Number.isFinite(intensity) ? Math.min(1, Math.max(0, intensity)) : 0;
  if (eased === 0) return { back: 0, drop: 0, pitch: 0 };
  return {
    back: VIEWMODEL_FIRE_MOTION.kickBack * eased,
    drop: VIEWMODEL_FIRE_MOTION.drop * eased,
    pitch: VIEWMODEL_FIRE_MOTION.pitch * eased,
  };
}
