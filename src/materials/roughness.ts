// Roughness from the same height field the normal comes from, mapped into the
// band `table.ts` declares for that material (FR-006). Steel reads smooth and
// stone reads rough because their declared bands say so — not because a
// constant here was nudged until the ordering came out (US2-S5).
//
// The mapping is deliberately mean-preserving. The height field is centred on
// its own mean and scaled by its own largest deviation, so the modulation sums
// to zero and a material's mean roughness lands on the midpoint of its band
// whatever its pattern happens to look like. Ordering the five materials is
// then ordering five declared midpoints, which is a property of the table.

import { RGBA_CHANNELS } from './constants';
import type { RoughnessRange } from './table';

/** How much of the half-band the height field is allowed to swing, leaving a
 * margin at both ends so a decoded value never leaves the declared range. */
export const ROUGHNESS_MODULATION = 0.9;

/** The constant a material falls back to when its derivation could not be
 * completed (FR-007): rough enough that an undecorated surface reads as
 * masonry rather than as a mirror (US2-S7). */
export const FALLBACK_ROUGHNESS = 0.8;

function encode(value: number): number {
  return Math.round(Math.min(1, Math.max(0, value)) * 255);
}

/** One texel of an encoded map, back in `0..1` (FR-006, US2-S5). */
export function decodeRoughnessTexel(roughness: Uint8ClampedArray, texel: number): number {
  return roughness[texel * RGBA_CHANNELS]! / 255;
}

/** The mean of a decoded map — the number US2-S5's ordering is measured on. */
export function roughnessMean(roughness: Uint8ClampedArray): number {
  let total = 0;
  const texels = roughness.length / RGBA_CHANNELS;
  for (let texel = 0; texel < texels; texel += 1) total += decodeRoughnessTexel(roughness, texel);
  return total / texels;
}

function fill(size: number, value: (texel: number) => number): Uint8ClampedArray {
  const map = new Uint8ClampedArray(size * size * RGBA_CHANNELS);
  for (let texel = 0; texel < size * size; texel += 1) {
    const offset = texel * RGBA_CHANNELS;
    const encoded = encode(value(texel));
    map[offset] = encoded;
    map[offset + 1] = encoded;
    map[offset + 2] = encoded;
    map[offset + 3] = 255;
  }
  return map;
}

/**
 * Derives a roughness map from `height` inside `range`. Low ground — mortar,
 * pits, grooves — reads rougher than the faces standing above it, which is why
 * the signal is inverted height rather than height itself.
 */
export function deriveRoughnessMap(
  height: Float32Array,
  size: number,
  range: RoughnessRange,
): Uint8ClampedArray {
  const texels = size * size;

  let mean = 0;
  for (let texel = 0; texel < texels; texel += 1) mean += height[texel]!;
  mean /= texels;

  let deviation = 0;
  for (let texel = 0; texel < texels; texel += 1) {
    deviation = Math.max(deviation, Math.abs(height[texel]! - mean));
  }

  // A constant field carries no deviation to normalise by; it collapses to the
  // middle of the band, which is the right answer for a surface with no relief.
  const scale = deviation > 0 ? (0.5 * ROUGHNESS_MODULATION) / deviation : 0;
  const span = range.max - range.min;
  const midpoint = range.min + span * 0.5;

  return fill(size, (texel) => midpoint - span * scale * (height[texel]! - mean));
}

/** The declared constant map of FR-007's degradation path (US2-S7). */
export function constantRoughnessMap(size: number, value: number): Uint8ClampedArray {
  return fill(size, () => value);
}
