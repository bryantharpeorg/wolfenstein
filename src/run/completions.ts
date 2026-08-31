// [US2] The completion counter (FR-007, US2-S6, US2-S8) — the one figure on the stats
// screen no earlier spec owns. It counts the `complete` transition `src/run/state.ts`
// *returns*, not a frame on which the state reads `complete`: `stepRun` enters `complete`
// once and returns `null` after, so a run counts once however long the screen is left up,
// where a state watcher needs a flag the reset can forget to clear. It is exempt from 007's
// reset by never entering the reset registry, as `deaths` is.

import type { RunTransition } from './state';

let completions = 0;

/** Runs completed this session (FR-007). Survives every restart. */
export function completionCount(): number {
  return completions;
}

/** Offers one frame's transition to the counter (FR-007, US2-S8); anything that is not an
 *  arrival in `complete` counts nothing. Returns the count, so a caller reports what it
 *  incremented rather than reading it back. */
export function countCompletion(transition: RunTransition | null): number {
  if (transition != null && transition.to === 'complete') completions += 1;
  return completions;
}

/** Test seam only: nothing in the running page returns this to zero (US2-S6). */
export function resetCompletionsForTest(): void {
  completions = 0;
}
