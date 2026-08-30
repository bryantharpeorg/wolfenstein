// The complete set of interact outcomes, declared once and in full (FR-006), so
// US2 and US3 import the union rather than widening it. No command resolves to
// an empty or silent result. Pure data: no DOM, no three.js.

export const INTERACT_OUTCOMES = [
  /** A closed door accepted the command and began opening. */
  'opened',
  /** An already-open door accepted the command; its dwell timer was reset. */
  'opened-now',
  /** The door is mid-travel (opening); it neither reverses nor re-triggers. */
  'blocked-moving',
  /** The door is closing and will finish closing before it can be re-opened. */
  'refusing-closing',
  /** Opening would drive this door's leaf into a neighbouring door's tile. */
  'blocked-neighbour',
  /** The door is locked and the inventory lacks the named key kind. */
  'locked-missing-key',
  /** A closing door aborted and reversed rather than closing on the player. */
  'crush-reversed',
  /** A secret that has already been pushed; secrets do not close. */
  'already-open',
  /** A secret whose travel path is obstructed by level geometry. */
  'blocked-geometry',
  /** Nothing interactable was in range of the player. */
  'no-target',
] as const;

export type InteractOutcome = (typeof INTERACT_OUTCOMES)[number];

// US1-S5 and US1-S6 read together: a door in `opening` *or* `closing` refuses with
// state and progress unchanged (S5), and the closing case names `refusing-closing`
// rather than re-opening (S6, FR-003). Both hold at once because `refusing-closing`
// is the closing-specific member of the moving-door refusal class below, not a
// different answer to it — one union, two names, one behaviour: refuse, do not
// reverse, do not re-trigger.
export const MOVING_REFUSALS = ['blocked-moving', 'refusing-closing'] as const;

/** A refusal issued because the door is mid-travel (US1-S5, US1-S6, FR-003). */
export type MovingRefusal = (typeof MOVING_REFUSALS)[number];

/** True when `outcome` refuses the command because the door is moving. */
export function isMovingRefusal(outcome: InteractOutcome): outcome is MovingRefusal {
  return (MOVING_REFUSALS as readonly InteractOutcome[]).includes(outcome);
}
