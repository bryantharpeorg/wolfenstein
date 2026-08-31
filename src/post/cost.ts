// T041 (FR-017; US4-S4, US4-S5): the frame-cost sampler, so a post-processing regression
// arrives as a number rather than as a feeling. It holds two windows -- one of frames
// with all four effects requested, one with none -- and answers the difference of their
// medians once both are full.
//
// Two decisions worth their lines. *A median, not a mean*: a garbage collection or a
// shader compile in the middle of a 120-frame window is not the cost of bloom, and one
// 400 ms frame moves a mean of 120 by more than the entire chain does. *Null until both
// windows are full*: a cost quoted from nine frames is a feeling with a decimal point on
// it, and FR-017 asks for a measurement against a baseline, which is two windows or it is
// nothing.
//
// Pure: no clock of its own, no renderer, no DOM. The caller supplies each frame's
// duration and which window it belongs to.

/** The window FR-017 declares. Both phases are measured over the same count. */
export const POST_COST_SAMPLE_FRAMES = 120;

/** All four requested, or none. A state in between belongs to neither window. */
export type PostCostPhase = 'enabled' | 'disabled';

export interface PostCostSampler {
  readonly windowFrames: number;
  readonly enabled: number[];
  readonly disabled: number[];
}

export function createPostCostSampler(windowFrames = POST_COST_SAMPLE_FRAMES): PostCostSampler {
  return { windowFrames, enabled: [], disabled: [] };
}

function windowFor(sampler: PostCostSampler, phase: PostCostPhase): number[] {
  return phase === 'enabled' ? sampler.enabled : sampler.disabled;
}

/**
 * Records one frame. `phase` is `null` for a mixed state, which is dropped rather than
 * banked: the cost FR-017 asks for is all four against none, and a blend of the two is
 * neither. A duration that is not positive and finite is dropped for the same reason --
 * a frame that took no time did not happen.
 */
export function recordPostCostSample(
  sampler: PostCostSampler,
  phase: PostCostPhase | null,
  frameMs: number,
): void {
  if (phase == null) return;
  if (!Number.isFinite(frameMs) || frameMs <= 0) return;
  const samples = windowFor(sampler, phase);
  samples.push(frameMs);
  // The most recent window, so a retuned chain is not averaged with the one it replaced.
  if (samples.length > sampler.windowFrames) samples.splice(0, samples.length - sampler.windowFrames);
}

export function postCostSampleCount(sampler: PostCostSampler, phase: PostCostPhase): number {
  return windowFor(sampler, phase).length;
}

function median(samples: readonly number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 === 1
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

/** One window's representative frame time, or `null` while it is still filling. */
export function postPhaseFrameMs(sampler: PostCostSampler, phase: PostCostPhase): number | null {
  const samples = windowFor(sampler, phase);
  return samples.length < sampler.windowFrames ? null : median(samples);
}

/** What `__diag.post.frameCostMs` publishes: the chain's cost against its own baseline,
 *  or `null` until both windows have been measured (FR-017, US4-S4). */
export function postFrameCostMs(sampler: PostCostSampler): number | null {
  const enabled = postPhaseFrameMs(sampler, 'enabled');
  const disabled = postPhaseFrameMs(sampler, 'disabled');
  if (enabled == null || disabled == null) return null;
  return enabled - disabled;
}

/** Clears both windows. A resized viewport changes what a frame costs, so the frames
 *  before it are not a baseline for the frames after it. */
export function resetPostCostSampler(sampler: PostCostSampler): void {
  sampler.enabled.length = 0;
  sampler.disabled.length = 0;
}
