// The gap stepper (US2, FR-007 to FR-010): active weapon, player speed, the
// shots-fired counter and elapsed seconds in, the next gap out. Pure — no
// `three`, no DOM — so the ordering, the movement ceiling, the recoil decay,
// the settling and the 1 ms/250 ms equivalence are all answered under
// `npm run test` rather than watched on a page.
//
// Nothing here restates a value from the weapon table: the resting gap is the
// weapon's own `maxSpreadRadians`, read through the table's accessor and
// scaled by the constant the constants module declares, so the importer scan
// in `tests/unit/weapons.test.ts` holds the derived-not-authored line for this
// module too. The movement term saturates at the player module's own declared
// sprint speed rather than at a second speed table.
//
// The gap is driven by accumulated elapsed seconds, never by frames — the rule
// `004` fixed for doors and `007` for fire rate (FR-010). Both easing terms
// are exponential, which is exact for a piecewise-constant target: the same
// weapon, speed and shot sequence stepped at 1 ms and at 250 ms lands on the
// same gaps, to well inside the declared tolerance.

import { weaponFor, type WeaponKind } from '../combat/weapons';
import { SPRINT_SPEED } from '../player/params';
import {
  CROSSHAIR_DECAY_SECONDS, CROSSHAIR_GAP_SCALE, CROSSHAIR_MOVEMENT_OPEN_PX,
  CROSSHAIR_RECOIL_PX, CROSSHAIR_SETTLE_SECONDS,
} from './crosshair-constants';

/** The gap chases its target on an exponential time constant of this fraction
 *  of the declared settle time: one settle time then leaves `e^-5` of any
 *  opening — under the declared tolerance for every gap this spec can
 *  produce — while stopping still reads as a glide, not a snap. */
const SETTLE_TIME_CONSTANT_FRACTION = 5;

/** Pixels of resting gap for a weapon: the weapon table's own spread for that
 *  kind, scaled into pixels (FR-007). */
export function restingGapPx(kind: WeaponKind): number {
  return weaponFor(kind).maxSpreadRadians * CROSSHAIR_GAP_SCALE;
}

/** Pixels of gap the movement term adds at this speed: the declared movement
 *  opening, saturating at the player module's declared sprint speed, so no
 *  speed the player can reach — or anything faster — pushes past the declared
 *  ceiling (FR-008). Monotone in the speed, zero at rest. */
export function movementOpenPx(speed: number): number {
  if (!Number.isFinite(speed) || speed <= 0) return 0;
  return CROSSHAIR_MOVEMENT_OPEN_PX * Math.min(1, speed / SPRINT_SPEED);
}

/** The mutable side of the reticle: where the gap sits, what the recent shots
 *  have added, and the counter's last seen value. One per reticle, owned by
 *  the caller. */
export interface CrosshairSpreadState {
  /** The eased gap in pixels, excluding recoil — where the reticle sits,
   *  chasing the weapon's resting gap plus the movement opening. */
  gap: number;
  /** The recoil pool in pixels: what the shots since the last full decay
   *  added, falling back out of the gap on the declared decay time. */
  recoil: number;
  /** The shots-fired counter's last seen value: a rise is a shot, a fall is a
   *  restart, which adds nothing. */
  lastShotsFired: number;
}

/** What one step is driven by, in the shapes `__diag.combat` and
 *  `__diag.player` publish. */
export interface CrosshairSpreadInput {
  readonly weapon: WeaponKind;
  /** Horizontal speed in world units per second, as the player diagnostics
   *  report it. */
  readonly speed: number;
  /** Shots that left the barrel so far, as the combat diagnostics count them. */
  readonly shotsFired: number;
  /** Seconds since the previous step — elapsed time, never a frame count. */
  readonly elapsedSeconds: number;
}

/** The state at rest for a weapon: the reticle starts on the weapon's own
 *  resting gap, with no recoil owed and no shots counted. */
export function createCrosshairSpreadState(kind: WeaponKind): CrosshairSpreadState {
  return { gap: restingGapPx(kind), recoil: 0, lastShotsFired: 0 };
}

/** A missing or degenerate delta means no time passed, not an error. */
function finiteSeconds(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function decayFactor(seconds: number): number {
  if (seconds === 0) return 1;
  return Math.exp(-seconds / CROSSHAIR_DECAY_SECONDS);
}

function easeFactor(seconds: number): number {
  if (seconds === 0) return 0;
  return 1 - Math.exp(-seconds / (CROSSHAIR_SETTLE_SECONDS / SETTLE_TIME_CONSTANT_FRACTION));
}

/** Advances the gap by one step of elapsed time and answers it. The state is
 *  updated in place — the caller owns it, and no per-frame allocation is
 *  spent on a value recomputed every frame. A rise in the shot counter adds
 *  the declared recoil on this step (FR-009); both the recoil pool and the
 *  eased gap fall back toward the resting value over elapsed seconds, not
 *  frames (FR-010). A weapon switch changes the target, so the gap moves
 *  toward the new resting value rather than snapping to it (US2-S7). */
export function stepCrosshairSpread(
  state: CrosshairSpreadState,
  input: CrosshairSpreadInput,
): number {
  const seconds = finiteSeconds(input.elapsedSeconds);
  const shots = Math.max(0, input.shotsFired - state.lastShotsFired);
  state.lastShotsFired = input.shotsFired;
  // The pool is decayed first and the new shots added after, so the jump a
  // shot produces on its own frame is exactly the declared recoil.
  state.recoil = state.recoil * decayFactor(seconds) + CROSSHAIR_RECOIL_PX * shots;
  const target = restingGapPx(input.weapon) + movementOpenPx(input.speed);
  state.gap += (target - state.gap) * easeFactor(seconds);
  return state.gap + state.recoil;
}