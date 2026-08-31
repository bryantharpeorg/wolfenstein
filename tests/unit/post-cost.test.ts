// T039 (FR-017; US4-S4, US4-S5). The point of this module is that a post-processing
// regression arrives as a *number*. It reduces one window of frames with all four
// effects on and one with all four off to a single `frameCostMs`, and refuses to answer
// until both windows are full — a cost quoted from nine frames is a feeling with a
// decimal point on it.
//
// The reduction is a median rather than a mean: a garbage-collection spike in the middle
// of a 120-frame window is not the cost of bloom, and one 400 ms frame moves a mean of
// 120 by more than the whole effect chain does.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  POST_COST_SAMPLE_FRAMES,
  createPostCostSampler,
  postCostSampleCount,
  postFrameCostMs,
  postPhaseFrameMs,
  recordPostCostSample,
  resetPostCostSampler,
} from '../../src/post/cost';

/** The claim is about code, not prose: a comment that says "window" is not a DOM access. */
const codeOf = (path: string): string =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');

const feed = (
  sampler: ReturnType<typeof createPostCostSampler>,
  phase: 'enabled' | 'disabled',
  frameMs: number,
  frames = POST_COST_SAMPLE_FRAMES,
): void => {
  for (let frame = 0; frame < frames; frame += 1) recordPostCostSample(sampler, phase, frameMs);
};

describe('the frame-cost sampler (FR-017, US4-S4)', () => {
  it('measures over a declared window of 120 frames', () => {
    expect(POST_COST_SAMPLE_FRAMES).toBe(120);
  });

  it('reduces 120 enabled and 120 disabled frames to one frameCostMs', () => {
    const sampler = createPostCostSampler();
    feed(sampler, 'disabled', 4);
    feed(sampler, 'enabled', 10);

    expect(postCostSampleCount(sampler, 'disabled')).toBe(120);
    expect(postCostSampleCount(sampler, 'enabled')).toBe(120);
    expect(postPhaseFrameMs(sampler, 'disabled')).toBeCloseTo(4, 6);
    expect(postPhaseFrameMs(sampler, 'enabled')).toBeCloseTo(10, 6);
    expect(postFrameCostMs(sampler)).toBeCloseTo(6, 6);
  });

  it('refuses to answer until both windows are full, so a cost is never quoted early', () => {
    const sampler = createPostCostSampler();
    feed(sampler, 'disabled', 4);
    expect(postPhaseFrameMs(sampler, 'disabled')).toBeCloseTo(4, 6);
    expect(postPhaseFrameMs(sampler, 'enabled')).toBeNull();
    expect(postFrameCostMs(sampler)).toBeNull();

    feed(sampler, 'enabled', 10, POST_COST_SAMPLE_FRAMES - 1);
    expect(postFrameCostMs(sampler)).toBeNull();
    recordPostCostSample(sampler, 'enabled', 10);
    expect(postFrameCostMs(sampler)).toBeCloseTo(6, 6);
  });

  it('keeps the most recent window, so a retuned chain is not averaged with the old one', () => {
    const sampler = createPostCostSampler();
    feed(sampler, 'disabled', 4);
    feed(sampler, 'enabled', 30);
    expect(postFrameCostMs(sampler)).toBeCloseTo(26, 6);
    feed(sampler, 'enabled', 10);
    expect(postPhaseFrameMs(sampler, 'enabled')).toBeCloseTo(10, 6);
    expect(postFrameCostMs(sampler)).toBeCloseTo(6, 6);
    expect(postCostSampleCount(sampler, 'enabled')).toBe(120);
  });

  it('takes the median, so one stalled frame is not reported as the cost of the chain', () => {
    const sampler = createPostCostSampler();
    feed(sampler, 'disabled', 4);
    feed(sampler, 'enabled', 10, POST_COST_SAMPLE_FRAMES - 1);
    recordPostCostSample(sampler, 'enabled', 4000);
    expect(postFrameCostMs(sampler)).toBeCloseTo(6, 6);
  });

  it('ignores a frame that is not a positive finite duration, and a mixed phase', () => {
    const sampler = createPostCostSampler();
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      recordPostCostSample(sampler, 'enabled', bad);
    }
    expect(postCostSampleCount(sampler, 'enabled')).toBe(0);

    // A state with some effects on and some off belongs to neither window: the cost
    // FR-017 asks for is all four against none, not a blend of the two.
    recordPostCostSample(sampler, null, 8);
    expect(postCostSampleCount(sampler, 'enabled')).toBe(0);
    expect(postCostSampleCount(sampler, 'disabled')).toBe(0);
  });

  it('clears both windows on reset, so a resized viewport is not measured against the old one', () => {
    const sampler = createPostCostSampler();
    feed(sampler, 'disabled', 4);
    feed(sampler, 'enabled', 10);
    expect(postFrameCostMs(sampler)).toBeCloseTo(6, 6);

    resetPostCostSampler(sampler);
    expect(postCostSampleCount(sampler, 'enabled')).toBe(0);
    expect(postCostSampleCount(sampler, 'disabled')).toBe(0);
    expect(postFrameCostMs(sampler)).toBeNull();
  });
});

describe('the cost sampler is pure (Constitution III)', () => {
  it('imports no renderer and reads no clock of its own', () => {
    const source = codeOf('../../src/post/cost.ts');
    expect(source).not.toMatch(/from\s+['"]three/);
    expect(source).not.toMatch(/\b(window|document|performance|Date)\b/);
  });
});
