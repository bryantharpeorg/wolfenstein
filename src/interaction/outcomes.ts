// The complete set of interact outcomes, declared once and in full (FR-006), so
// US2 and US3 import the union rather than widening it. No command resolves to
// an empty or silent result. Pure data: no DOM, no three.js.

export const INTERACT_OUTCOMES = [
  'opened', // a closed door accepted the command and began opening
  'opened-now', // an open door accepted it; its dwell timer was reset
  'blocked-moving', // the door is opening: it neither reverses nor re-triggers
  'refusing-closing', // the door is closing and will finish before it re-opens
  'blocked-neighbour', // opening would drive the leaf into another door's tile
  'locked-missing-key', // locked, and the inventory lacks the named key kind
  'crush-reversed', // a closing door reversed rather than close on the player
  'already-open', // a secret already pushed; secrets do not close
  'blocked-geometry', // a secret whose travel path is obstructed
  'no-target', // nothing interactable was in range
  // 008's elevator, resolved through this same one command path (008 FR-001):
  // the `E` tile is a thing you use, so it answers here beside the doors.
  'exit-used', // the elevator accepted the command; the run is now `exiting`
  'already-exiting', // the elevator has already been used and does not re-trigger
  'exit-refused-dead', // a player at zero health does not complete the level
] as const;

export type InteractOutcome = (typeof INTERACT_OUTCOMES)[number];

// The refusal a moving door answers with, named per state (US1-S5): a door in
// `opening` says `blocked-moving`, one in `closing` says `refusing-closing`
// (US1-S6). Both refuse identically — no reverse, no re-trigger (FR-003).
export const MOVING_REFUSALS = ['blocked-moving', 'refusing-closing'] as const;

export type MovingRefusal = (typeof MOVING_REFUSALS)[number];

/** True when `outcome` refuses the command because the door is moving. */
export function isMovingRefusal(outcome: InteractOutcome): outcome is MovingRefusal {
  return (MOVING_REFUSALS as readonly InteractOutcome[]).includes(outcome);
}
