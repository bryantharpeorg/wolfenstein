// T041 (FR-017; US4-S4, US4-S5): the frame-cost sampler, so a regression arrives as a number.
// Two windows — all four effects requested, and none — reduced to the difference of their
// medians once both are full. A median, because a collection mid-window is not the cost of
// bloom; null until both are full, because a cost from nine frames is a feeling with a decimal
// point on it. Pure: no clock, no renderer, no DOM.

export const POST_COST_SAMPLE_FRAMES = 120;

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

/** Records one frame. A `null` phase is a mixed state, dropped rather than banked: the cost
 *  FR-017 asks for is all four against none. A duration that is not positive and finite is
 *  dropped for the same reason. */
export function recordPostCostSample(
  sampler: PostCostSampler, phase: PostCostPhase | null, frameMs: number,
): void {
  if (phase == null) return;
  if (!Number.isFinite(frameMs) || frameMs <= 0) return;
  const samples = windowFor(sampler, phase);
  samples.push(frameMs);
  // The most recent window, so a retuned chain is not averaged with the one it replaced.
  if (samples.length > sampler.windowFrames) {
    samples.splice(0, samples.length - sampler.windowFrames);
  }
}

export function postCostSampleCount(sampler: PostCostSampler, phase: PostCostPhase): number {
  return windowFor(sampler, phase).length;
}

function median(samples: readonly number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

export function postPhaseFrameMs(sampler: PostCostSampler, phase: PostCostPhase): number | null {
  const samples = windowFor(sampler, phase);
  return samples.length < sampler.windowFrames ? null : median(samples);
}

export function postFrameCostMs(sampler: PostCostSampler): number | null {
  const enabled = postPhaseFrameMs(sampler, 'enabled');
  const disabled = postPhaseFrameMs(sampler, 'disabled');
  if (enabled == null || disabled == null) return null;
  return enabled - disabled;
}

export function resetPostCostSampler(sampler: PostCostSampler): void {
  sampler.enabled.length = 0;
  sampler.disabled.length = 0;
}
