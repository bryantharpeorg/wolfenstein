// T014 (FR-007; US2-S6, US2-S8). The one figure on the stats screen no earlier spec owns:
// it counts completed runs, once each, and is the only thing 007's reset leaves standing.
// It is driven through `stepRun` rather than a hand-written transition, because a counter
// watching for a transition that machine never produces would pass a hand-written test and
// fail on the page.

import { beforeEach, describe, expect, it } from 'vitest';
import { completionCount, countCompletion, resetCompletionsForTest } from '../../src/run/completions';
import {
  ELEVATOR_TRAVEL_MS,
  beginElevatorExit,
  createRun,
  resetRunTimeline,
  setRunDead,
  stepRun,
  type RunTimeline,
} from '../../src/run/state';

/** One frame, exactly as the stats-screen system spends it. */
function frame(run: RunTimeline, deltaMs: number): void {
  countCompletion(stepRun(run, deltaMs));
}

/** Plays a run for `playedMs` and then rides the lift to `complete`. */
function completeRun(run: RunTimeline, playedMs: number, deltaMs = 100): void {
  for (let spent = 0; spent < playedMs; spent += deltaMs) frame(run, deltaMs);
  beginElevatorExit(run);
  for (let spent = 0; spent <= ELEVATOR_TRAVEL_MS; spent += deltaMs) frame(run, deltaMs);
}

beforeEach(() => {
  resetCompletionsForTest();
});

describe('the completion counter (FR-007)', () => {
  it('starts at zero and counts nothing on a frame that made no transition', () => {
    expect(completionCount()).toBe(0);
    const run = createRun();
    for (let step = 0; step < 20; step += 1) frame(run, 50);
    expect(completionCount()).toBe(0);
  });

  it('counts nothing for a transition that is not into `complete`', () => {
    // `exiting`, then `dead` and back: every transition the machine makes but one.
    const run = createRun();
    beginElevatorExit(run);
    const dead = createRun();
    setRunDead(dead, true);
    setRunDead(dead, false);
    countCompletion(null);
    expect(completionCount()).toBe(0);
  });

  it('counts one for one completed run, however many frames follow it', () => {
    const run = createRun();
    completeRun(run, 1_000);
    expect(run.state).toBe('complete');
    expect(completionCount()).toBe(1);
    for (let step = 0; step < 200; step += 1) frame(run, 16);
    expect(completionCount()).toBe(1);
  });

  it('survives the reset that returns the run to `playing` (US2-S6)', () => {
    const run = createRun();
    completeRun(run, 1_000);
    expect(completionCount()).toBe(1);

    // 007's reset as `resetElevatorRun` applies it: the timeline goes back, not the count.
    resetRunTimeline(run);
    expect(run.state).toBe('playing');
    expect(run.elapsedMs).toBe(0);
    expect(run.travelSeconds).toBe(0);
    expect(completionCount()).toBe(1);
  });

  it('reads 2 after a completion, a restart and a second completion (US2-S8)', () => {
    const run = createRun();
    completeRun(run, 4_000);
    const firstElapsed = run.elapsedMs;
    expect(completionCount()).toBe(1);
    expect(firstElapsed).toBeCloseTo(4_000 + ELEVATOR_TRAVEL_MS, 6);

    resetRunTimeline(run);
    completeRun(run, 1_000);

    expect(completionCount()).toBe(2);
    // The second run's own timer, not the two runs added together (US2-S8).
    expect(run.elapsedMs).toBeLessThan(firstElapsed);
    expect(run.elapsedMs).toBeCloseTo(1_000 + ELEVATOR_TRAVEL_MS, 6);
  });
});
