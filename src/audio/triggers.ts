// Resolved event to sound (FR-011, US3-S4). Pure, and — the point of the story — no
// key code appears anywhere in the file: a sound answers what *happened*. 007
// resolves a shot refused for ammo as `out-of-ammo` and traces no ray, 004 answers a
// locked door `locked-missing-key` and does not move its leaf, and the cadence
// accumulates distance, so a player pressing W into a wall is silent.

import type { ShotOutcome } from '../combat/hitscan';
import type { WeaponKind } from '../combat/weapons';
import type { DoorState } from '../interaction/door';
import type { InteractOutcome } from '../interaction/outcomes';
import { BOB_FREQUENCY, WALK_SPEED } from '../player/params';
import { gunfireSoundFor, type SoundId } from './sound-table';

export interface ResolvedShot {
  readonly weapon: WeaponKind;
  readonly outcome: ShotOutcome;
}

const REFUSED_SHOT: ShotOutcome = 'out-of-ammo';

export function soundForShot(shot: ResolvedShot): SoundId | null {
  return shot.outcome === REFUSED_SHOT ? null : gunfireSoundFor(shot.weapon);
}

/** The gunfire one frame's resolved shots earned (FR-011): a delta of 007's
 *  `shotsFired`, which excludes refusals, so a refused shot cannot reach here
 *  (US3-S4). Bounded by `limit`, since the cap would drop the excess anyway. */
export function gunfireForResolvedShots(weapon: WeaponKind, shots: number, limit: number): SoundId[] {
  if (!Number.isFinite(shots) || shots <= 0) return [];
  const count = Math.min(Math.floor(shots), Math.max(0, Math.floor(limit)));
  return new Array<SoundId>(count).fill(gunfireSoundFor(weapon));
}

export interface DoorTransition {
  readonly from: DoorState;
  readonly to: DoorState;
}

const MOVING_DOOR_STATES: readonly DoorState[] = ['opening', 'closing'];

/** The grind a door makes when its leaf *starts* moving (FR-011). An arrival starts no
 *  travel and is silent, and a door that refused a command never changed state at
 *  all, so both are silent (US3-S4). */
export function soundForDoorTransition(transition: DoorTransition): SoundId | null {
  if (transition.from === transition.to) return null;
  return MOVING_DOOR_STATES.includes(transition.to) ? 'door' : null;
}

const SOUNDING_OUTCOME: InteractOutcome = 'opened';

/** The sound an interact command's *resolution* makes (FR-011): every refusal in 004's
 *  outcome set answers null, so a key that asked for a door it could not open is
 *  silent (US3-S4). */
export function soundForInteractOutcome(outcome: InteractOutcome): SoundId | null {
  return outcome === SOUNDING_OUTCOME ? 'door' : null;
}

/** The declared stride, derived from 003's walk speed and bob frequency rather than
 *  restated, so a footfall lands on the bob's beat and the two cannot drift. */
export const FOOTSTEP_STRIDE_UNITS = WALK_SPEED / BOB_FREQUENCY;

export const MAX_FOOTSTEPS_PER_STEP = 2;

export interface FootstepCadence {
  travelledUnits: number;
}

export function createFootstepCadence(): FootstepCadence {
  return { travelledUnits: 0 };
}

/** Banks travel and reports the footfalls it completed (FR-011, US3-S4). The argument
 *  is distance — not time, not a key state — which is the whole claim: a blocked
 *  player travels zero and steps zero. Credit past the cap is dropped, not banked. */
export function stepFootstepCadence(cadence: FootstepCadence, distanceUnits: number): number {
  if (!Number.isFinite(distanceUnits) || distanceUnits <= 0) return 0;

  cadence.travelledUnits += distanceUnits;
  let steps = 0;
  while (steps < MAX_FOOTSTEPS_PER_STEP && cadence.travelledUnits >= FOOTSTEP_STRIDE_UNITS) {
    cadence.travelledUnits -= FOOTSTEP_STRIDE_UNITS;
    steps += 1;
  }
  if (cadence.travelledUnits >= FOOTSTEP_STRIDE_UNITS) {
    cadence.travelledUnits %= FOOTSTEP_STRIDE_UNITS;
  }
  return steps;
}
