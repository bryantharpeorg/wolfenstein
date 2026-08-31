// The fire command, gated (FR-004, FR-007, FR-008). Pure: no DOM, no three.js
// (FR-001) — nothing here knows what a ray is; tracing arrives as a callback.
//
// The gate is elapsed seconds, not frames, and credit past one interval is
// dropped, so an idle minute is not a burst and a spike resolves at most
// `MAX_SHOTS_PER_STEP` (Edge Cases). `FireInput` collapses Ctrl and the left
// mouse button into one flag, so both on a frame is one shot, and a refusal
// traces no ray, spends no round and leaves the timer standing.

import { outOfAmmoResult } from './hitscan';
import type { ShotResult } from './hitscan';
import { DEFAULT_WEAPON, WEAPON_SWITCH_DELAY_SECONDS, startingAmmo, weaponFor } from './weapons';
import type { Weapon, WeaponKind } from './weapons';

/** Bound to fire (FR-008); both reach the one command. */
export const FIRE_KEY_CODES = ['ControlLeft', 'ControlRight'] as const;

/** Bound to fire (FR-008). */
export const FIRE_MOUSE_BUTTON = 0;

/** The most shots one step may resolve, however long the frame. */
export const MAX_SHOTS_PER_STEP = 8;

/** Slack, so accumulated millisecond deltas are not a shot short by float error. */
export const FIRE_TIMER_EPSILON = 1e-9;

/** Which binding holds the trigger: two names, one command. */
export type FireSource = 'key' | 'mouse';

const FIRE_KEY_SET: ReadonlySet<string> = new Set<string>(FIRE_KEY_CODES);

export function fireSourceForKeyCode(code: string): FireSource | null {
  return FIRE_KEY_SET.has(code) ? 'key' : null;
}

export function fireSourceForMouseButton(button: number): FireSource | null {
  return button === FIRE_MOUSE_BUTTON ? 'mouse' : null;
}

/** The one command path: any number of bindings, one held flag. */
export interface FireInput {
  readonly held: boolean;
  press(source: FireSource): void;
  release(source: FireSource): void;
  clear(): void; // every binding released: what a focus loss must do
}

export function createFireInput(): FireInput {
  const holding = new Set<FireSource>();
  return {
    get held(): boolean {
      return holding.size > 0;
    },
    press: (source) => void holding.add(source),
    release: (source) => void holding.delete(source),
    clear: () => holding.clear(),
  };
}

/** What the fire command carries between frames. A value, not a global. */
export interface FireControlState {
  weapon: WeaponKind;
  ammo: Record<WeaponKind, number>;
  readySeconds: number; // credit toward the next shot, in seconds
  switchRemaining: number; // of the declared switch delay, still to run
  shotsFired: number; // monotonic within a run; also the spread shot index
}

export function createFireControl(): FireControlState {
  return {
    weapon: DEFAULT_WEAPON,
    ammo: startingAmmo(),
    readySeconds: 0,
    switchRemaining: 0,
    shotsFired: 0,
  };
}

/** What a resolved shot needs from the gate to be traced. */
export interface TraceRequest {
  readonly weapon: Weapon;
  readonly shotIndex: number; // so shot n's spread is reproducible from the seed
}

export interface StepFireOptions {
  readonly deltaSeconds: number;
  readonly fire: boolean; // the single command, collapsed from every binding
  readonly select?: WeaponKind | null; // what the digit keys asked for, or null
  readonly trace: (request: TraceRequest) => ShotResult;
}

export interface FireReport {
  readonly results: readonly ShotResult[]; // one per shot the frame resolved
  readonly switching: boolean; // the declared switch delay is running
}

const NO_RESULTS: readonly ShotResult[] = [];

/** Advances the fire command one frame, mutating `state` and calling `trace`
 *  once per shot fired, never for a refusal. */
export function stepFireControl(state: FireControlState, options: StepFireOptions): FireReport {
  const delta =
    Number.isFinite(options.deltaSeconds) && options.deltaSeconds > 0 ? options.deltaSeconds : 0;

  // Paid out of this frame's elapsed time first, so the frame completing a switch
  // spends only what is left of itself on firing.
  const spentOnSwitch = Math.min(state.switchRemaining, delta);
  state.switchRemaining -= spentOnSwitch;
  if (state.switchRemaining < FIRE_TIMER_EPSILON) state.switchRemaining = 0;
  let usable = delta - spentOnSwitch;

  const select = options.select ?? null;
  if (select !== null && select !== state.weapon) {
    // Re-selecting the weapon held is not this branch: no delay, no ammo, no
    // timer (US1-S11).
    state.weapon = select;
    state.switchRemaining = WEAPON_SWITCH_DELAY_SECONDS;
    // The in-flight interval timer does not carry to the new weapon (Edge Cases).
    state.readySeconds = 0;
    usable = 0;
  }

  if (state.switchRemaining > 0) return { results: NO_RESULTS, switching: true };

  const weapon = weaponFor(state.weapon);
  state.readySeconds += usable;

  const results: ShotResult[] = [];
  while (
    options.fire &&
    results.length < MAX_SHOTS_PER_STEP &&
    state.readySeconds + FIRE_TIMER_EPSILON >= weapon.fireIntervalSeconds
  ) {
    const ammo = state.ammo[state.weapon];
    if (ammo < weapon.ammoCost) {
      // No ray, no round, and the timer left standing (FR-007, US1-S9).
      results.push(outOfAmmoResult());
      break;
    }
    state.ammo[state.weapon] = ammo - weapon.ammoCost;
    state.readySeconds = Math.max(0, state.readySeconds - weapon.fireIntervalSeconds);
    const shotIndex = state.shotsFired;
    state.shotsFired += 1;
    results.push(options.trace({ weapon, shotIndex }));
  }

  // Credit past one interval is dropped, so the cap is real and standing still
  // banks no burst.
  state.readySeconds = Math.min(state.readySeconds, weapon.fireIntervalSeconds);

  return { results, switching: false };
}
