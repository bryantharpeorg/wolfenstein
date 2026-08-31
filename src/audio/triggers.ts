// Resolved event to sound (FR-011, US3-S4). Pure: no DOM, no three.js, no context,
// and — the point of the story — no key code anywhere in the file.
//
// The rule this module exists to enforce is that a sound answers to what
// *happened*, not to what was asked for. 007's fire command already separates the
// two: a shot refused for ammo resolves as `out-of-ammo` and traces no ray, so it
// maps to nothing here. 004 does the same for doors: a locked door answers
// `locked-missing-key` and its leaf does not move, so nothing grinds. And the
// footstep cadence accumulates *distance travelled*, so a player pressing W into a
// wall travels nothing and is silent however long the key is held.

import type { ShotOutcome } from '../combat/hitscan';
import type { WeaponKind } from '../combat/weapons';
import type { DoorState } from '../interaction/door';
import type { InteractOutcome } from '../interaction/outcomes';
import { BOB_FREQUENCY, WALK_SPEED } from '../player/params';
import { gunfireSoundFor, type SoundId } from './sound-table';

/** A shot as the gate resolved it: which weapon fired, and what the ray found. */
export interface ResolvedShot {
  readonly weapon: WeaponKind;
  readonly outcome: ShotOutcome;
}

/** The outcome that means no round left the barrel (007 FR-007). */
const REFUSED_SHOT: ShotOutcome = 'out-of-ammo';

/** The gunfire a resolved shot makes, or null for a shot that never fired. */
export function soundForShot(shot: ResolvedShot): SoundId | null {
  return shot.outcome === REFUSED_SHOT ? null : gunfireSoundFor(shot.weapon);
}

/** A door's state on two successive frames. */
export interface DoorTransition {
  readonly from: DoorState;
  readonly to: DoorState;
}

/** The states in which a leaf is travelling: entering one is what makes the noise. */
const MOVING_DOOR_STATES: readonly DoorState[] = ['opening', 'closing'];

/**
 * The grind a door makes when its leaf *starts* moving (FR-011). An arrival —
 * `opening` to `open`, `closing` to `closed` — starts no travel and is silent, so
 * one open-and-close cycle grinds twice rather than four times, and a door that
 * refused the command never changed state and so is silent (US3-S4).
 */
export function soundForDoorTransition(transition: DoorTransition): SoundId | null {
  if (transition.from === transition.to) return null;
  return MOVING_DOOR_STATES.includes(transition.to) ? 'door' : null;
}

/** The one outcome in 004's declared set that moved a leaf that was not moving. */
const SOUNDING_OUTCOME: InteractOutcome = 'opened';

/**
 * The sound an interact command's *resolution* makes (FR-011). Every refusal in
 * 004's outcome set — locked, blocked, moving, no target — answers null, so the
 * key that requested a door it could not open is silent (US3-S4). `opened-now`
 * only reset a dwell timer; the leaf was already open and did not move.
 */
export function soundForInteractOutcome(outcome: InteractOutcome): SoundId | null {
  return outcome === SOUNDING_OUTCOME ? 'door' : null;
}

/**
 * The declared stride, in world units, derived from 003's walk speed and bob
 * frequency rather than restated: the bob completes `BOB_FREQUENCY` cycles per
 * `WALK_SPEED` units, so one footfall per cycle puts the step on the bob's beat
 * and the two cannot drift apart when either constant is retuned.
 */
export const FOOTSTEP_STRIDE_UNITS = WALK_SPEED / BOB_FREQUENCY;

/** The most footsteps one frame may fire: a teleport is a step, not a stampede. */
export const MAX_FOOTSTEPS_PER_STEP = 2;

/** Distance banked toward the next footfall. A value, not a global. */
export interface FootstepCadence {
  travelledUnits: number;
}

export function createFootstepCadence(): FootstepCadence {
  return { travelledUnits: 0 };
}

/**
 * Banks `distanceUnits` of travel and reports how many footfalls it completed
 * (FR-011, US3-S4). The argument is distance, not time and not a key state, which
 * is the whole claim: a blocked player travels zero and steps zero. Credit past
 * the per-frame cap is dropped rather than banked, so one long frame does not
 * leave a queue of steps to work off.
 */
export function stepFootstepCadence(cadence: FootstepCadence, distanceUnits: number): number {
  if (!Number.isFinite(distanceUnits) || distanceUnits <= 0) return 0;

  cadence.travelledUnits += distanceUnits;
  let steps = 0;
  while (steps < MAX_FOOTSTEPS_PER_STEP && cadence.travelledUnits >= FOOTSTEP_STRIDE_UNITS) {
    cadence.travelledUnits -= FOOTSTEP_STRIDE_UNITS;
    steps += 1;
  }
  if (cadence.travelledUnits >= FOOTSTEP_STRIDE_UNITS) {
    cadence.travelledUnits = cadence.travelledUnits % FOOTSTEP_STRIDE_UNITS;
  }
  return steps;
}
