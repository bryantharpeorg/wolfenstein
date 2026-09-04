// T015 (FR-011, FR-012, FR-013; US3-S1..S6, SC-009): the hit and kill mark state
// machine, driven as arithmetic. The load-bearing distinction is what starts a
// mark, as T032 established for the muzzle flash: a counter *rising*, never the
// fact of a shot -- a counter that does not move is not a hit, so a trigger held
// against a wall lights nothing. "Exactly one mark" is asserted as exactly one.

import { describe, expect, it } from 'vitest';
import {
  CROSSHAIR_HIT_MARK_SECONDS, CROSSHAIR_KILL_MARK_SECONDS,
} from '../../src/hud/crosshair-constants';
import {
  NO_MARK, stepFeedbackMark, type FeedbackCounters, type FeedbackMark,
} from '../../src/hud/crosshair-feedback';
import { feedbackMarkStrokes, crosshairStrokes } from '../../src/hud/crosshair';

const FRAME = 1 / 60;

const counters = (overrides: Partial<FeedbackCounters> = {}): FeedbackCounters => ({
  prevHits: 0, hits: 0, prevKills: 0, kills: 0, runState: 'playing', dead: false, ...overrides,
});

const step = (active: FeedbackMark, overrides: Partial<FeedbackCounters> = {}, delta = FRAME) =>
  stepFeedbackMark(active, counters(overrides), delta);

describe('a rising counter ignites its mark (FR-011, US3-S1, US3-S2)', () => {
  it('a hit counter rising lights the hit mark for its declared duration', () => {
    expect(CROSSHAIR_HIT_MARK_SECONDS).toBeGreaterThan(0);
    expect(step(NO_MARK, { prevHits: 4, hits: 5 })).toEqual({
      kind: 'hit', remainingSeconds: CROSSHAIR_HIT_MARK_SECONDS,
    });
  });

  it('a kill counter rising lights the kill mark for its declared duration', () => {
    expect(CROSSHAIR_KILL_MARK_SECONDS).toBeGreaterThan(CROSSHAIR_HIT_MARK_SECONDS);
    expect(step(NO_MARK, { prevKills: 2, kills: 3 })).toEqual({
      kind: 'kill', remainingSeconds: CROSSHAIR_KILL_MARK_SECONDS,
    });
  });

  it('a mark that was already lit re-ignites at full duration, not a top-up', () => {
    const halfSpent: FeedbackMark = { kind: 'hit', remainingSeconds: CROSSHAIR_HIT_MARK_SECONDS / 2 };
    expect(step(halfSpent, { prevHits: 4, hits: 5 }))
      .toEqual({ kind: 'hit', remainingSeconds: CROSSHAIR_HIT_MARK_SECONDS });
  });
});

describe('one frame yields one mark, and the kill outranks the hit (FR-012, US3-S3)', () => {
  it('both counters rising on one frame lights the kill mark alone, never both', () => {
    const mark = step(NO_MARK, { prevHits: 4, hits: 5, prevKills: 2, kills: 3 });
    expect(mark).toEqual({ kind: 'kill', remainingSeconds: CROSSHAIR_KILL_MARK_SECONDS });
  });

  it('a hit mark already lit is replaced, not overlaid, when the kill arrives', () => {
    const lit: FeedbackMark = { kind: 'hit', remainingSeconds: CROSSHAIR_HIT_MARK_SECONDS / 2 };
    expect(step(lit, { prevHits: 4, hits: 5, prevKills: 2, kills: 3 }))
      .toEqual({ kind: 'kill', remainingSeconds: CROSSHAIR_KILL_MARK_SECONDS });
  });

  it('a counter rising by more than one lights exactly one mark, not several', () => {
    // A chaingun burst resolving five hits at once: the same mark a single hit
    // lights, at the same full duration -- never a longer or a doubled one.
    expect(step(NO_MARK, { prevHits: 4, hits: 9 }))
      .toEqual(step(NO_MARK, { prevHits: 4, hits: 5 }));
  });
});

describe('a counter that does not move lights nothing, and a lit mark decays (FR-011, US3-S4, US3-S5)', () => {
  it('static counters ignite nothing, however many frames pass', () => {
    let mark = NO_MARK;
    for (let frame = 0; frame < 600; frame += 1) {
      mark = step(mark, { prevHits: 4, hits: 4, prevKills: 2, kills: 2 });
      expect(mark.kind, `frame ${frame}`).toBe('none');
    }
  });

  it('the hit mark is out within its declared duration, and stays out', () => {
    let mark = step(NO_MARK, { prevHits: 4, hits: 5 });
    expect(mark.kind).toBe('hit');
    const framesNeeded = Math.ceil(CROSSHAIR_HIT_MARK_SECONDS / FRAME);
    for (let frame = 0; frame < framesNeeded; frame += 1) mark = step(mark, { prevHits: 5, hits: 5 });
    // Not `toBeCloseTo`: decayed to nothing means exactly the resting state.
    expect(mark).toEqual(NO_MARK);
    for (let frame = 0; frame < 60; frame += 1) mark = step(mark, { prevHits: 5, hits: 5 });
    expect(mark).toEqual(NO_MARK);
  });

  it('the kill mark outlasts the hit mark but is out within its own duration', () => {
    let mark = step(NO_MARK, { prevKills: 2, kills: 3 });
    const hitFrames = Math.ceil(CROSSHAIR_HIT_MARK_SECONDS / FRAME);
    for (let frame = 0; frame < hitFrames; frame += 1) mark = step(mark, { prevKills: 3, kills: 3 });
    expect(mark.kind, 'the kill mark survives a hit mark\'s whole duration').toBe('kill');
    const killFrames = Math.ceil(CROSSHAIR_KILL_MARK_SECONDS / FRAME);
    for (let frame = 0; frame < killFrames; frame += 1) mark = step(mark, { prevKills: 3, kills: 3 });
    expect(mark).toEqual(NO_MARK);
  });

  it('decays by elapsed seconds, not by frames: the same total elapsed lands in the same place', () => {
    const statics = { prevKills: 3, kills: 3 };
    // Both clocks start on a lit kill mark, then spend the same quarter second
    // -- one coarse step against two hundred and fifty fine ones.
    const coarse = stepFeedbackMark(step(NO_MARK, { prevKills: 2, kills: 3 }), counters(statics), 0.25);
    let fine = step(NO_MARK, { prevKills: 2, kills: 3 });
    for (let stepIndex = 0; stepIndex < 250; stepIndex += 1) {
      fine = stepFeedbackMark(fine, counters(statics), 0.001);
    }
    expect(coarse.kind).toBe(fine.kind);
    expect(coarse.remainingSeconds).toBeGreaterThan(fine.remainingSeconds - 1e-9);
    expect(coarse.remainingSeconds).toBeLessThan(fine.remainingSeconds + 1e-9);
  });

  it('a non-finite or negative delta does not decay a lit mark and lights nothing', () => {
    const lit: FeedbackMark = { kind: 'kill', remainingSeconds: 0.2 };
    for (const delta of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
      expect(stepFeedbackMark(lit, counters(), delta)).toEqual(lit);
      expect(stepFeedbackMark(NO_MARK, counters({ prevHits: 4, hits: 5 }), delta).kind).toBe('hit');
    }
  });
});

describe('no mark while the run is not being played (FR-013, US3-S6)', () => {
  it('a rising counter in any non-playing state, or a dead player, lights nothing', () => {
    for (const runState of ['dead', 'exiting', 'complete'] as const) {
      expect(step(NO_MARK, { prevHits: 4, hits: 5, prevKills: 2, kills: 3, runState }))
        .toEqual(NO_MARK);
    }
    expect(step(NO_MARK, { prevHits: 4, hits: 5, prevKills: 2, kills: 3, dead: true }))
      .toEqual(NO_MARK);
  });

  it('an active mark is cleared the frame the state leaves playing or the player dies', () => {
    const litHit: FeedbackMark = { kind: 'hit', remainingSeconds: CROSSHAIR_HIT_MARK_SECONDS / 2 };
    const litKill: FeedbackMark = { kind: 'kill', remainingSeconds: CROSSHAIR_KILL_MARK_SECONDS / 2 };
    for (const runState of ['dead', 'exiting', 'complete'] as const) {
      expect(step(litHit, { runState })).toEqual(NO_MARK);
      expect(step(litKill, { runState })).toEqual(NO_MARK);
    }
    expect(step(litKill, { dead: true })).toEqual(NO_MARK);
  });

  it('a rise consumed while gated does not light when the gate lifts', () => {
    // The counter moved while dead: the next frame's static read lights nothing.
    expect(step(NO_MARK, { prevHits: 5, hits: 5, runState: 'dead' })).toEqual(NO_MARK);
  });
});

describe('every branch of the machine is produced (SC-009)', () => {
  it('walks none, hit, kill and the cleared-on-death path in one run', () => {
    let mark = NO_MARK;
    expect(mark.kind).toBe('none');
    mark = step(mark, { prevHits: 1, hits: 2 });
    expect(mark.kind).toBe('hit');
    mark = step(mark, { prevHits: 2, hits: 3, prevKills: 1, kills: 2 });
    expect(mark.kind).toBe('kill');
    mark = step(mark, { prevKills: 2, kills: 2, dead: true });
    expect(mark).toEqual(NO_MARK);
  });
});

// FR-012's second clause, asserted on the geometry (T017): the two marks are
// distinct *shapes*, not one mark drawn twice at different brightness -- and
// each is a different mark from the resting reticle itself. The distinction is
// asserted structurally: the reticle's arms ride the axes, the hit mark's
// segments are disconnected diagonals, and the kill mark's segments close into
// a ring the hit mark has nowhere near.
describe('the marks are distinct stroke sets (FR-012, SC-007)', () => {
  type Stroke = { x1: number; y1: number; x2: number; y2: number };

  const asPoints = (strokes: readonly Stroke[]) =>
    strokes.flatMap((s) => [`${s.x1},${s.y1}`, `${s.x2},${s.y2}`]);

  /** True when every stroke's far endpoint is some stroke's near endpoint: the
   *  set closes into a ring rather than floating as disconnected segments. */
  const closes = (strokes: readonly Stroke[]) => {
    const starts = new Set(strokes.map((s) => `${s.x1},${s.y1}`));
    return strokes.every((s) => starts.has(`${s.x2},${s.y2}`));
  };

  /** True when no two strokes share an endpoint: the set is disconnected. */
  const disconnected = (strokes: readonly Stroke[]) => {
    const points = asPoints(strokes);
    return new Set(points).size === points.length;
  };

  it('the hit mark is a different mark from the resting reticle', () => {
    const hit = feedbackMarkStrokes('hit');
    expect(hit.length).toBeGreaterThan(0);
    const reticle = crosshairStrokes({ gapPx: 3.6, armLengthPx: 14, viewport: { heightPx: 720 } });
    expect(asPoints(hit).sort()).not.toEqual(asPoints(reticle).sort());
    // The reticle is four axis-aligned arms; no hit segment rides an axis.
    for (const stroke of hit) {
      expect(stroke.x1 === stroke.x2, 'a hit segment is purely vertical, like a reticle arm')
        .toBe(false);
      expect(stroke.y1 === stroke.y2, 'a hit segment is purely horizontal, like a reticle arm')
        .toBe(false);
    }
  });

  it('the kill mark is not a brighter hit: its shape, not its intensity, differs', () => {
    const hit = feedbackMarkStrokes('hit');
    const kill = feedbackMarkStrokes('kill');
    expect(kill.length).toBeGreaterThan(0);
    expect(asPoints(kill).sort()).not.toEqual(asPoints(hit).sort());
    // The hit mark floats as disconnected segments around the centre; the kill
    // mark closes into a ring. Same strokes rearranged would fail the first
    // line above; a rescaled hit would fail this one.
    expect(disconnected(hit), 'the hit mark should float as disconnected segments').toBe(true);
    expect(closes(kill), 'the kill mark should close into a ring').toBe(true);
    // And the ring encloses the hit mark rather than replacing it at one size.
    const reach = (strokes: readonly Stroke[]) =>
      Math.max(...asPoints(strokes).map((point) => Math.hypot(...point.split(',').map(Number))));
    expect(reach(kill)).toBeGreaterThan(reach(hit));
  });

  it('an unknown kind draws nothing, so a resting reticle draws no mark', () => {
    expect(feedbackMarkStrokes('none')).toEqual([]);
  });
});