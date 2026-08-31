// T035 (FR-017; US4-S6, US4-S7): the muzzle flash, as arithmetic. What starts it is the
// requirement: a *resolved shot*, and `igniteFlash` is the only way in -- the fire key never
// reaches this module, so a trigger held while out of ammo, mid-switch or dead lights
// nothing (US4-S7). The clock is elapsed-since-the-shot plus a lit flag rather than a
// decrementing remainder, because US4-S7 asks for *exactly* zero.

/** The declared decay (FR-017): a shot's flash is out this many seconds later. */
export const MUZZLE_FLASH_DECAY_SECONDS = 0.12;

export const VIEWMODEL_FIRE_MOTION = { kickBack: 0.055, drop: 0.028, pitch: 0.12 } as const;

export interface FlashState {
  secondsSinceShot: number;
  lit: boolean;
}

export function createFlashState(): FlashState {
  return { secondsSinceShot: 0, lit: false };
}

export function igniteFlash(state: FlashState): void {
  state.secondsSinceShot = 0;
  state.lit = true;
}

export function resetFlash(state: FlashState): void {
  state.secondsSinceShot = 0;
  state.lit = false;
}

export function flashIntensity(state: Readonly<FlashState>): number {
  if (!state.lit) return 0;
  return Math.min(1, Math.max(0, 1 - state.secondsSinceShot / MUZZLE_FLASH_DECAY_SECONDS));
}

export function stepFlash(state: FlashState, deltaSeconds: number): number {
  if (!state.lit) return 0;
  if (Number.isFinite(deltaSeconds) && deltaSeconds > 0) {
    state.secondsSinceShot += deltaSeconds;
    if (state.secondsSinceShot >= MUZZLE_FLASH_DECAY_SECONDS) {
      state.secondsSinceShot = MUZZLE_FLASH_DECAY_SECONDS;
      state.lit = false;
    }
  }
  return flashIntensity(state);
}

export function fireMotion(intensity: number): { back: number; drop: number; pitch: number } {
  const eased = Number.isFinite(intensity) ? Math.min(1, Math.max(0, intensity)) : 0;
  if (eased === 0) return { back: 0, drop: 0, pitch: 0 };
  return {
    back: VIEWMODEL_FIRE_MOTION.kickBack * eased,
    drop: VIEWMODEL_FIRE_MOTION.drop * eased,
    pitch: VIEWMODEL_FIRE_MOTION.pitch * eased,
  };
}
