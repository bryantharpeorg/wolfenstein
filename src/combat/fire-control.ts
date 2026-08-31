// The fire command, gated (FR-004, FR-007, FR-008). Pure: no DOM, no three.js
// (FR-001). Nothing here knows what a ray is — tracing arrives as a callback —
// so the whole of the gate, the ammo accounting and the switch delay is
// assertable without a page.
//
// Three rules do the work.
//
// *The gate is elapsed seconds, not frames.* Credit accumulates and is spent one
// declared interval at a time, so a held trigger produces the same count at any
// frame rate. The credit left over past one interval is dropped rather than
// carried: an idle minute cannot be cashed in as a burst on the first press, and
// a delta spike resolves at most `MAX_SHOTS_PER_STEP` shots — a long frame
// cannot empty a magazine (Edge Cases).
//
// *There is one command path.* `FireInput` collapses the Ctrl keys and the left
// mouse button into a single held flag before this module sees anything, so both
// pressed on one frame is one boolean and resolves one shot's worth of credit.
// There is no second handler for the second binding to be added to.
//
// *A refusal costs nothing.* Short of ammo, the step returns `out-of-ammo`,
// traces no ray, spends no round and leaves the interval timer standing, so a
// pickup collected on the next frame fires immediately rather than an interval
// later.

import { outOfAmmoResult } from './hitscan';
import type { ShotResult } from './hitscan';
import {
  DEFAULT_WEAPON,
  WEAPON_SWITCH_DELAY_SECONDS,
  startingAmmo,
  weaponFor,
} from './weapons';
import type { Weapon, WeaponKind } from './weapons';

/** The key codes bound to fire (FR-008). Both resolve to the one command. */
export const FIRE_KEY_CODES = ['ControlLeft', 'ControlRight'] as const;

/** The mouse button bound to fire (FR-008): the left one. */
export const FIRE_MOUSE_BUTTON = 0;

/** The most shots one step may resolve, however long the frame was. */
export const MAX_SHOTS_PER_STEP = 8;

/** Slack on the interval comparison, so a thousand accumulated millisecond
 *  deltas are not a shot short of a second's worth by float error alone. */
export const FIRE_TIMER_EPSILON = 1e-9;

/** Which binding is holding the trigger. Two names, one command. */
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
  /** Releases every binding — what a focus loss must do, so a key held across
   *  it cannot stick down (the same rule 003 applies to movement). */
  clear(): void;
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

/** Everything the fire command carries between frames. A value, not a global:
 *  two of these never share a magazine. */
export interface FireControlState {
  weapon: WeaponKind;
  ammo: Record<WeaponKind, number>;
  /** Credit toward the next shot, in seconds. */
  readySeconds: number;
  /** Seconds of the declared switch delay still to run. */
  switchRemaining: number;
  /** Monotonic within a run; also the spread stream's shot index. */
  shotsFired: number;
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
  /** Monotonic index, so the spread of shot n is reproducible from the seed. */
  readonly shotIndex: number;
}

export interface StepFireOptions {
  readonly deltaSeconds: number;
  /** The single command, already collapsed from every binding. */
  readonly fire: boolean;
  /** The weapon the digit keys asked for this frame, or null for no change. */
  readonly select?: WeaponKind | null;
  readonly trace: (request: TraceRequest) => ShotResult;
}

export interface FireReport {
  /** One entry per shot the frame resolved; empty when it resolved none. */
  readonly results: readonly ShotResult[];
  /** True while the declared switch delay runs, during which nothing fires. */
  readonly switching: boolean;
}

const NO_RESULTS: readonly ShotResult[] = [];

/**
 * Advances the fire command by one frame and returns what it resolved. Mutates
 * `state` — the caller holds the run's magazine — and calls `trace` exactly once
 * per shot that actually leaves the barrel, never for a refusal.
 */
export function stepFireControl(state: FireControlState, options: StepFireOptions): FireReport {
  const delta =
    Number.isFinite(options.deltaSeconds) && options.deltaSeconds > 0 ? options.deltaSeconds : 0;

  // The switch delay is paid out of this frame's own elapsed time first, so the
  // frame that completes a switch spends only what is left of itself on firing.
  const spentOnSwitch = Math.min(state.switchRemaining, delta);
  state.switchRemaining -= spentOnSwitch;
  if (state.switchRemaining < FIRE_TIMER_EPSILON) state.switchRemaining = 0;
  let usable = delta - spentOnSwitch;

  const select = options.select ?? null;
  if (select !== null && select !== state.weapon) {
    // Re-selecting the weapon already held is not this branch: it costs no
    // delay, no ammo and no timer (US1-S11).
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

  // Credit past one interval is a backlog this frame chose not to pay: dropped
  // rather than carried, so the shot cap is a real cap and standing still does
  // not bank a burst.
  state.readySeconds = Math.min(state.readySeconds, weapon.fireIntervalSeconds);

  return { results, switching: false };
}
