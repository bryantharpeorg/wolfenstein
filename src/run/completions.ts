// [US2] The completion counter (FR-007, US2-S6, US2-S8). The one figure on the stats
// screen that no earlier spec owns, and the only one this story counts for itself.
//
// It counts the `complete` transition `src/run/state.ts` *returns* rather than watching
// the run's state for a frame on which it reads `complete`. That distinction is the
// whole file: `stepRun` enters `complete` once and returns `null` on every frame after,
// so counting its return value counts a completed run exactly once however many frames
// the stats screen is then left on the page — where a state watcher needs an
// "already counted" flag, and a flag the reset forgot to clear counts the next run
// twice.
//
// It is exempt from 007's reset by never being registered with `restart.ts` at all,
// rather than by a resettable that declines to reset. There is nothing to register: a
// session counter is reset by nothing, exactly as `deaths` and `restarts` are, and the
// cheapest way to guarantee that is to give the reset registry no handle on it.
// `RESTART_EXEMPT_FIELDS` names it so the exemption is a declaration rather than an
// omission.

import type { RunTransition } from './state';

// Module-level, in the shape `combat/restart.ts`'s `restarts` established: one session
// has one completion count, and a second copy of it would be a second answer to "how
// many runs have been finished".
let completions = 0;

/** Runs completed this session (FR-007). Survives every restart. */
export function completionCount(): number {
  return completions;
}

/**
 * Offers one frame's transition to the counter (FR-007, US2-S8).
 *
 * Anything that is not an arrival in `complete` — a null frame, a run entering
 * `exiting`, a run that died — counts nothing. Returns the count, so a caller reports
 * what it incremented rather than reading it back.
 */
export function countCompletion(transition: RunTransition | null): number {
  if (transition != null && transition.to === 'complete') completions += 1;
  return completions;
}

/** Test seam only. Nothing in the running page returns this counter to zero — that is
 *  the point of it (US2-S6). */
export function resetCompletionsForTest(): void {
  completions = 0;
}
