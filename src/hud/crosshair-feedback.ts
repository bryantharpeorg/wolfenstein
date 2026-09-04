// The mark state machine (T016, US3; FR-011, FR-012, FR-013): the one active
// mark on the reticle, as arithmetic. Previous and current `hits` and `kills`
// counters, the run state and the dead flag in, one `FeedbackMark` out — pure,
// no `three`, no DOM, which is what lets `npm run test` walk every branch
// (SC-009) and what the render edge in `src/systems/crosshair/register.ts` is
// left unable to decide.
//
// What starts a mark is the load-bearing decision, and it is the shape `007`'s
// muzzle flash established against `shotsFired`: a counter *rising*, never the
// fact of a shot. A counter that does not move is not a hit, so a trigger held
// against a wall — or while dead, or out of ammo — lights nothing (US3-S5). A
// rise is consumed by the gate: a counter that moves while the run is not being
// played lights nothing on that frame and nothing on the next, because the
// previous counters move with it either way (FR-013).
import type { RunState } from '../run/state';
import { CROSSHAIR_HIT_MARK_SECONDS, CROSSHAIR_KILL_MARK_SECONDS } from './crosshair-constants';

/** What a mark can be: nothing, a hit, or the kill that outranks it (FR-012). */
export type FeedbackMarkKind = 'none' | 'hit' | 'kill';

/** The one active mark. `remainingSeconds` is the decay clock; a mark of kind
 *  `none` is always at zero. */
export interface FeedbackMark {
  readonly kind: FeedbackMarkKind;
  readonly remainingSeconds: number;
}

/** The reticle's resting state: no mark lit, nothing left to decay. */
export const NO_MARK: FeedbackMark = { kind: 'none', remainingSeconds: 0 };

/** The counters and run facts one step reads. `prevHits`/`prevKills` are the
 *  counters as the previous frame read them; ignition is `current > previous`,
 *  so the caller holds the previous values and moves them every frame — the
 *  same shape `src/systems/hud/register.ts` holds `lastShotsFired` in. */
export interface FeedbackCounters {
  readonly prevHits: number;
  readonly hits: number;
  readonly prevKills: number;
  readonly kills: number;
  readonly runState: RunState;
  readonly dead: boolean;
}

/** The declared durations, restated here only through their own constants so
 *  the tests read them from the one place every tuning value lives in. */
const DURATION = {
  hit: CROSSHAIR_HIT_MARK_SECONDS,
  kill: CROSSHAIR_KILL_MARK_SECONDS,
} as const satisfies Record<Exclude<FeedbackMarkKind, 'none'>, number>;

/** The mark's declared duration, in seconds, for its kind. */
export function markDuration(kind: FeedbackMarkKind): number {
  return kind === 'none' ? 0 : DURATION[kind];
}

/** One frame of the machine. A rising `kills` counter ignites the kill mark, a
 *  rising `hits` counter the hit mark, the kill taking precedence when both
 *  rise on one frame (FR-012); a rise replaces whatever mark was lit rather
 *  than overlaying a second one, and a rise of more than one lights exactly one
 *  mark at its full duration. With no counter moving, the active mark decays by
 *  elapsed seconds — by the whole delta, so a coarse step and fine steps land on
 *  the same clock — and reaches `none` exactly, with no residual remainder.
 *  While the run is not `playing` or the player is dead, nothing ignites and an
 *  active mark is cleared that frame (FR-013). */
export function stepFeedbackMark(
  active: FeedbackMark,
  counters: FeedbackCounters,
  deltaSeconds: number,
): FeedbackMark {
  // The gate first, before ignition or decay: a run not being played is a
  // frame the reticle shows its ordinary state, whatever the counters did.
  if (counters.runState !== 'playing' || counters.dead) return NO_MARK;

  if (counters.kills > counters.prevKills) {
    return { kind: 'kill', remainingSeconds: DURATION.kill };
  }
  if (counters.hits > counters.prevHits) {
    return { kind: 'hit', remainingSeconds: DURATION.hit };
  }

  if (active.kind === 'none') return NO_MARK;
  if (!(Number.isFinite(deltaSeconds) && deltaSeconds > 0)) return active;
  const remaining = active.remainingSeconds - deltaSeconds;
  return remaining > 0 ? { kind: active.kind, remainingSeconds: remaining } : NO_MARK;
}