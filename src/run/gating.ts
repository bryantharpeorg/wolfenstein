// What a run's phase permits (FR-003). Four predicates and nothing else: the
// guard step, the guard's fire, the damage the player takes and the player's own
// fire each ask one of them, and a completed run stops every actor by being
// answered `false` rather than by having a system unregistered or a frame
// returned from early. That distinction is the whole module. FR-003 stops actors,
// not frames — the render loop must keep running in `complete`, and the naive
// implementations that stop a guard by stopping the loop produce a frozen canvas
// no harness can read.
//
// So this file may only answer questions. It imports the run states and nothing
// else, holds no state of its own, and names nothing that draws a frame or holds
// the systems that do.

import type { RunState } from './state';

/** One row per state, so a fifth caller reads the same four facts rather than
 *  inventing a fifth. `dead` is 007's: guards carry on over a body, but nothing
 *  further is applied to the player and the player's commands do not resolve. */
const PERMISSIONS: Record<RunState, Readonly<Record<GateName, boolean>>> = {
  playing: { guardsMayMove: true, guardsMayFire: true, damageApplies: true, playerMayFire: true },
  // The world does not pause while the lift travels: FR-003 names `complete`.
  exiting: { guardsMayMove: true, guardsMayFire: true, damageApplies: true, playerMayFire: true },
  dead: { guardsMayMove: true, guardsMayFire: true, damageApplies: false, playerMayFire: false },
  complete: {
    guardsMayMove: false,
    guardsMayFire: false,
    damageApplies: false,
    playerMayFire: false,
  },
};

export type GateName = 'guardsMayMove' | 'guardsMayFire' | 'damageApplies' | 'playerMayFire';

/** An unrecognised state permits nothing: a gate that fails open would let a
 *  completed run keep shooting on the strength of a typo. */
function permits(state: RunState, gate: GateName): boolean {
  return PERMISSIONS[state]?.[gate] ?? false;
}

/** Whether 006's guards may take their fixed-step tick this frame (US1-S5). */
export function guardsMayMove(state: RunState): boolean {
  return permits(state, 'guardsMayMove');
}

/** Whether a guard's tick may resolve a shot at the player (US1-S5). */
export function guardsMayFire(state: RunState): boolean {
  return permits(state, 'guardsMayFire');
}

/** Whether damage 006 resolved is applied to the player (US1-S5). */
export function damageApplies(state: RunState): boolean {
  return permits(state, 'damageApplies');
}

/** Whether the player's own fire command resolves anything (US1-S5). */
export function playerMayFire(state: RunState): boolean {
  return permits(state, 'playerMayFire');
}

/** The four, by name, for a caller that gates on a name it was handed. */
export const RUN_GATES = { guardsMayMove, guardsMayFire, damageApplies, playerMayFire } as const;
