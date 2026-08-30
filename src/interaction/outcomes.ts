// The complete set of interact outcomes, declared once and in full (FR-006), so
// US2 and US3 import the union rather than widening it. No command resolves to
// an empty or silent result. Pure data: no DOM, no three.js.

export const INTERACT_OUTCOMES = [
  /** A closed door accepted the command and began opening. */
  'opened',
  /** An already-open door accepted the command; its dwell timer was reset. */
  'opened-now',
  /** The door is mid-travel; it neither reverses nor re-triggers. */
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
