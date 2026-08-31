import { describe, it, expect } from 'vitest';
import {
  ELEVATOR_TRAVEL_MS,
  RUN_STATES,
  beginElevatorExit,
  createRun,
  elevatorProgress,
  resetRunTimeline,
  setRunDead,
  stepRun,
  type RunTimeline,
} from '../../src/run/state';

// T001 (FR-002, FR-004, US1-S3, US1-S4, US1-S7). The machine is stepped by
// accumulated elapsed time and never by frame count, so every claim below is
// made twice: once at 1 ms and once at 500 ms, which is the only difference a
// frame-counting implementation would survive.

/** Steps `totalMs` in `deltaMs` slices, returning the run timer at the moment the
 *  first `complete` transition fired — or null when none did. */
function stepUntilComplete(run: RunTimeline, totalMs: number, deltaMs: number): number | null {
  let completedAt: number | null = null;
  const steps = Math.ceil(totalMs / deltaMs);
  for (let i = 0; i < steps; i += 1) {
    const transition = stepRun(run, deltaMs);
    if (transition?.to === 'complete' && completedAt === null) completedAt = transition.atMs;
  }
  return completedAt;
}

describe('the run-state machine (FR-002, FR-004)', () => {
  it('declares the four states, each once', () => {
    expect([...RUN_STATES]).toEqual(['playing', 'dead', 'exiting', 'complete']);
    expect(new Set(RUN_STATES).size).toBe(RUN_STATES.length);
  });

  it('starts a run playing at a zero timer', () => {
    const run = createRun();
    expect(run.state).toBe('playing');
    expect(run.elapsedMs).toBe(0);
    expect(elevatorProgress(run)).toBe(0);
  });

  it('moves playing -> exiting -> complete after the declared travel duration', () => {
    const run = createRun();
    expect(beginElevatorExit(run)).toBe(true);
    expect(run.state).toBe('exiting');

    // One tick short of the duration is still travelling.
    expect(stepRun(run, ELEVATOR_TRAVEL_MS - 1)).toBeNull();
    expect(run.state).toBe('exiting');
    expect(elevatorProgress(run)).toBeGreaterThan(0.9);

    const transition = stepRun(run, 1);
    expect(transition).toEqual({ from: 'exiting', to: 'complete', atMs: ELEVATOR_TRAVEL_MS });
    expect(run.state).toBe('complete');
    expect(elevatorProgress(run)).toBe(1);
  });

  it('completes after the same total elapsed time at 1 ms and at 500 ms deltas (US1-S3)', () => {
    const fine = createRun();
    beginElevatorExit(fine);
    const fineAt = stepUntilComplete(fine, ELEVATOR_TRAVEL_MS, 1);

    const coarse = createRun();
    beginElevatorExit(coarse);
    const coarseAt = stepUntilComplete(coarse, ELEVATOR_TRAVEL_MS, 500);

    expect(fineAt).not.toBeNull();
    expect(coarseAt).not.toBeNull();
    expect(fine.state).toBe('complete');
    expect(coarse.state).toBe('complete');
    expect(Math.abs(fineAt! - coarseAt!)).toBeLessThanOrEqual(1e-6);
    expect(Math.abs(fine.elapsedMs - coarse.elapsedMs)).toBeLessThanOrEqual(1e-6);
    expect(Math.abs(fineAt! - ELEVATOR_TRAVEL_MS)).toBeLessThanOrEqual(1e-6);
  });

  it('completes at the same elapsed time when a delta straddles the transition', () => {
    // 500 ms deltas do not divide the remaining travel evenly here: the machine
    // must spend the part of the delta the travel needed and no more.
    const run = createRun();
    stepRun(run, 130);
    beginElevatorExit(run);
    const at = stepUntilComplete(run, ELEVATOR_TRAVEL_MS + 500, 500);
    expect(at).not.toBeNull();
    expect(Math.abs(at! - (130 + ELEVATOR_TRAVEL_MS))).toBeLessThanOrEqual(1e-6);
    expect(Math.abs(run.elapsedMs - (130 + ELEVATOR_TRAVEL_MS))).toBeLessThanOrEqual(1e-6);
  });

  it('runs the timer monotonically while playing and stops it at complete (US1-S7)', () => {
    const run = createRun();
    let previous = run.elapsedMs;
    for (let i = 0; i < 20; i += 1) {
      stepRun(run, 16.7);
      expect(run.elapsedMs).toBeGreaterThanOrEqual(previous);
      previous = run.elapsedMs;
    }
    expect(run.elapsedMs).toBeCloseTo(20 * 16.7, 9);

    beginElevatorExit(run);
    stepUntilComplete(run, ELEVATOR_TRAVEL_MS, 50);
    expect(run.state).toBe('complete');

    const frozen = run.elapsedMs;
    expect(Math.abs(frozen - (20 * 16.7 + ELEVATOR_TRAVEL_MS))).toBeLessThanOrEqual(1e-6);
    for (let i = 0; i < 100; i += 1) expect(stepRun(run, 500)).toBeNull();
    expect(run.elapsedMs).toBe(frozen);
    expect(run.state).toBe('complete');
  });

  it('refuses a nonsense delta rather than running the timer backwards', () => {
    const run = createRun();
    stepRun(run, 100);
    stepRun(run, -50);
    stepRun(run, Number.NaN);
    stepRun(run, Number.POSITIVE_INFINITY);
    expect(run.elapsedMs).toBe(100);
  });

  it('neither re-transitions nor restarts the travel on a second exit (US1-S4)', () => {
    const run = createRun();
    beginElevatorExit(run);
    stepRun(run, ELEVATOR_TRAVEL_MS / 2);
    const halfway = elevatorProgress(run);

    expect(beginElevatorExit(run)).toBe(false);
    expect(run.state).toBe('exiting');
    expect(elevatorProgress(run)).toBe(halfway);

    // The travel finishes on its original schedule, once.
    let completions = 0;
    for (let i = 0; i < 20; i += 1) {
      if (stepRun(run, ELEVATOR_TRAVEL_MS / 4)?.to === 'complete') completions += 1;
    }
    expect(completions).toBe(1);
    expect(beginElevatorExit(run)).toBe(false);
  });

  it('takes a run to dead and back, and lets no death undo an exit', () => {
    const run = createRun();
    setRunDead(run, true);
    expect(run.state).toBe('dead');
    expect(beginElevatorExit(run)).toBe(false);

    setRunDead(run, false);
    expect(run.state).toBe('playing');
    expect(beginElevatorExit(run)).toBe(true);
    setRunDead(run, true);
    expect(run.state).toBe('exiting');
  });

  it('discards a pending completion when the run restarts mid-exiting (T011)', () => {
    const run = createRun();
    stepRun(run, 900);
    beginElevatorExit(run);
    stepRun(run, ELEVATOR_TRAVEL_MS - 1);

    resetRunTimeline(run);
    expect(run.state).toBe('playing');
    expect(run.elapsedMs).toBe(0);
    expect(elevatorProgress(run)).toBe(0);

    // The transition that was one millisecond away must not fire after the reset.
    for (let i = 0; i < 10; i += 1) expect(stepRun(run, 500)).toBeNull();
    expect(run.state).toBe('playing');
    expect(run.elapsedMs).toBe(5000);
  });
});
