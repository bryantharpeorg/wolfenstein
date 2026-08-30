// The complete set of interact outcomes, declared once (FR-006).
//
// Every interact command resolved against a door, a lock or a secret returns one
// of these — never an empty or silent result. The union is written out in full
// here, in the story that creates the file, so US2 and US3 import it rather than
// widening it: a union that grows story by story is a shared file every node
// edits, which is the contention this layout exists to avoid.
//
// Pure data. No DOM, no three.js.

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

const OUTCOME_SET: ReadonlySet<string> = new Set<string>(INTERACT_OUTCOMES);

/** Whether an arbitrary value is one of the declared outcomes (FR-006). */
export function isInteractOutcome(value: unknown): value is InteractOutcome {
  return typeof value === 'string' && OUTCOME_SET.has(value);
}
