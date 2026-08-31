// The run-state machine: `playing | dead | exiting | complete`, the run timer, and
// the elevator travel that carries a run from one to the other (FR-002, FR-004).
// Pure: no DOM, no three.js, so the whole of a won run is asserted under
// `npm run test` and the system in `src/systems/elevator/` is left with plumbing.
//
// Two properties are load-bearing, and both are properties of *time*, not frames.
// The travel is interpolated from accumulated elapsed seconds and a step that
// would carry the lift past its arrival spends only the part of the delta the
// travel needed, so 2000 one-millisecond steps and four five-hundred-millisecond
// steps complete at the same total elapsed time (US1-S3). And `step()` *returns*
// the transition it made rather than announcing it, so US2 observes `complete`
// without this file being reopened.

/** The four run states, declared once and in the order a run passes through them
 *  (FR-002). `dead` is 007's losing end; `complete` is this spec's winning one. */
export const RUN_STATES = ['playing', 'dead', 'exiting', 'complete'] as const;

export type RunState = (typeof RUN_STATES)[number];

/** The declared elevator travel duration (FR-002): long enough that the exit
 *  reads as a lift arriving rather than a level ending on a keypress, short
 *  enough that a scripted gate run is not waiting on it. */
export const ELEVATOR_TRAVEL_MS = 2000;

/** The same duration in the unit the travel accumulates in (FR-002). */
export const ELEVATOR_TRAVEL_SECONDS = ELEVATOR_TRAVEL_MS / 1000;

/**
 * The tolerance the arrival comparison allows, in seconds. Accumulating 2000
 * additions of 0.001 lands a few parts in 1e13 short of 2, and without this the
 * lift would need one further millisecond at fine deltas and none at coarse
 * ones — the exact 1e-6 disagreement US1-S3 forbids. It is nine orders of
 * magnitude below the smallest delta a frame can bring, so it can never complete
 * a travel early.
 */
export const TRAVEL_EPSILON_SECONDS = 1e-9;

/** One run's clock. `travelSeconds` is zero unless the lift is moving. */
export interface RunTimeline {
  state: RunState;
  /** Wall-clock milliseconds since spawn or the most recent restart (FR-004). */
  elapsedMs: number;
  /** Accumulated elapsed seconds of elevator travel (FR-002). */
  travelSeconds: number;
}

/** What one step did, and when. `atMs` is the run timer at the moment of the
 *  transition — not at the end of the delta that contained it. */
export interface RunTransition {
  readonly from: RunState;
  readonly to: RunState;
  readonly atMs: number;
}

export function createRun(): RunTimeline {
  return { state: 'playing', elapsedMs: 0, travelSeconds: 0 };
}

/** 007's restart, applied to this spec's run (Edge Cases): back to `playing` with
 *  the elevator closed and the timer at zero. A travel that was one millisecond
 *  from arriving is discarded here rather than firing after the reset — which is
 *  the whole reason the pending transition is a number in this record and not a
 *  callback somebody scheduled. */
export function resetRunTimeline(run: RunTimeline): void {
  run.state = 'playing';
  run.elapsedMs = 0;
  run.travelSeconds = 0;
}

/** The lift's travel fraction, 0 closed to 1 arrived, for whatever draws it. */
export function elevatorProgress(run: Readonly<RunTimeline>): number {
  if (run.state === 'complete') return 1;
  return Math.min(1, run.travelSeconds / ELEVATOR_TRAVEL_SECONDS);
}

/** Enters `exiting` (FR-002). Returns false — and changes nothing — when the run
 *  is not `playing`: a second use neither re-transitions nor restarts the travel
 *  (US1-S4), and a dead run does not leave by the front door (US1-S6). */
export function beginElevatorExit(run: RunTimeline): boolean {
  if (run.state !== 'playing') return false;
  run.state = 'exiting';
  run.travelSeconds = 0;
  return true;
}

/** Follows 007's health: `playing` closes to `dead` and a restarted run reopens.
 *  A run already in the lift is not reopened by either — whichever of the two
 *  ends came first is the one this run had, so a run is never both won and lost
 *  (Edge Cases). */
export function setRunDead(run: RunTimeline, dead: boolean): void {
  if (dead && run.state === 'playing') run.state = 'dead';
  else if (!dead && run.state === 'dead') run.state = 'playing';
}

/**
 * Advances a run by `deltaMs` of wall-clock time (FR-002, FR-004).
 *
 * The timer takes the whole delta while the run is live and none of it once
 * `complete` is entered; a delta that straddles the lift's arrival is split at
 * the arrival, so the timer reports the moment `complete` was entered rather
 * than the end of the frame that contained it (US1-S7). Returns the transition
 * it made, or null.
 */
export function stepRun(run: RunTimeline, deltaMs: number): RunTransition | null {
  if (!Number.isFinite(deltaMs) || deltaMs <= 0) return null;
  if (run.state === 'complete') return null;

  if (run.state !== 'exiting') {
    run.elapsedMs += deltaMs;
    return null;
  }

  const neededSeconds = ELEVATOR_TRAVEL_SECONDS - run.travelSeconds;
  const deltaSeconds = deltaMs / 1000;
  if (deltaSeconds < neededSeconds - TRAVEL_EPSILON_SECONDS) {
    run.travelSeconds += deltaSeconds;
    run.elapsedMs += deltaMs;
    return null;
  }

  // Only the part of the delta the travel had left to spend: the remainder
  // belongs to a run that is already over.
  run.elapsedMs += Math.max(0, neededSeconds) * 1000;
  run.travelSeconds = ELEVATOR_TRAVEL_SECONDS;
  run.state = 'complete';
  return { from: 'exiting', to: 'complete', atMs: run.elapsedMs };
}

// The run the page is playing. Module-level, in the shape `player/state.ts` and
// `combat/run-state.ts` already established, so 006's and 007's systems consult
// one fact through `currentRunState()` rather than importing another system.
let live: RunTimeline | null = null;

export function setLiveRun(run: RunTimeline | null): void {
  live = run;
}

export function getLiveRun(): RunTimeline | null {
  return live;
}

/** The phase the gates read. `playing` before a run exists, so a module under
 *  test — and every frame before the elevator system's setup — behaves exactly as
 *  it did before this spec landed. */
export function currentRunState(): RunState {
  return live?.state ?? 'playing';
}
