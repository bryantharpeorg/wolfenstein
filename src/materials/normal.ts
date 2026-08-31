// Tangent-space normals by central difference over a material's own height
// field — never over its albedo's luminance (FR-005, US2-S1..S4). Pure data in,
// pure data out: no three.js, no DOM, so every texel is assertable under
// `npm run test`.
//
// The convention, stated once so a test can hand-compute against it. A height
// field h is the surface (u, v, h(u, v)). Its tangents are Tu = (1, 0, dh/du)
// and Tv = (0, 1, dh/dv), so the outward normal is
//
//     N = Tu x Tv = (-dh/du, -dh/dv, 1), normalised,
//
// which puts +Z out of the surface at every texel and makes a flat region
// (0, 0, 1). Encoding is the usual `round((n + 1) / 2 * 255)`, so flat lands on
// exactly (128, 128, 255).

import { RGBA_CHANNELS } from './constants';

/**
 * How far a unit of height per texel tilts the normal. A height field is a
 * unitless `0..1` scalar, so this is the one number that turns it into a slope;
 * raising it deepens every material's relief at once.
 */
export const NORMAL_STRENGTH = 8;

/** How far a decoded normal may sit from its hand-computed vector (US2-S2).
 * One 8-bit step spans 2/255 in decoded units, so half a step is 1/255 per
 * channel; this is that bound with room for the normalisation that follows. */
export const NORMAL_DECODE_TOLERANCE = 0.01;

/** How far a decoded normal's length may sit from 1 (US2-S3). Quantising three
 * channels can cost at most sqrt(3)/255 ~= 0.0068 of length. */
export const NORMAL_UNIT_TOLERANCE = 0.01;

/** What a flat surface encodes to, and what FR-007's fallback map is filled
 * with: +Z out of the surface, opaque. */
export const FLAT_NORMAL_ENCODED: readonly [number, number, number, number] = [128, 128, 255, 255];

/** Wraps a texel coordinate onto the buffer, so the central difference at an
 * edge reads the far edge instead of clamping. Clamping halves the difference
 * there and encodes a cliff that shows as a bright line at every tile boundary
 * once the texture repeats (Edge Cases). */
function wrap(coordinate: number, size: number): number {
  return ((coordinate % size) + size) % size;
}

/** Encodes one `-1..1` component into the `0..255` byte a normal map stores. */
export function encodeComponent(value: number): number {
  return Math.round((value + 1) * 0.5 * 255);
}

/** Decodes one `0..255` byte back to `-1..1`. */
export function decodeComponent(byte: number): number {
  return (byte / 255) * 2 - 1;
}

/** Decodes the normal at one texel index back into a `-1..1` vector (US2-S3). */
export function decodeNormalTexel(
  map: Uint8ClampedArray,
  texelIndex: number,
): [number, number, number] {
  const offset = texelIndex * RGBA_CHANNELS;
  return [
    decodeComponent(map[offset] ?? 0),
    decodeComponent(map[offset + 1] ?? 0),
    decodeComponent(map[offset + 2] ?? 0),
  ];
}

/**
 * An RGBA buffer every texel of which encodes (0, 0, 1). This is what FR-007
 * ships when a derivation cannot be completed: a surface that lights as if it
 * were flat, which is a degradation, rather than one that does not light at all.
 */
export function flatNormalMap(size: number): Uint8ClampedArray {
  const map = new Uint8ClampedArray(size * size * RGBA_CHANNELS);
  for (let i = 0; i < size * size; i += 1) {
    const offset = i * RGBA_CHANNELS;
    map[offset] = FLAT_NORMAL_ENCODED[0];
    map[offset + 1] = FLAT_NORMAL_ENCODED[1];
    map[offset + 2] = FLAT_NORMAL_ENCODED[2];
    map[offset + 3] = FLAT_NORMAL_ENCODED[3];
  }
  return map;
}

/**
 * The tangent-space normal map of one height field, by central difference with
 * wrapped sampling. `height` is `size * size` scalars in row-major order, the
 * same grid and the same UV space as the albedo it was shaded alongside, so no
 * sampling offset exists between the two (US2-S6).
 */
export function deriveNormalMap(
  height: Float32Array,
  size: number,
  strength: number = NORMAL_STRENGTH,
): Uint8ClampedArray {
  if (height.length !== size * size) {
    throw new Error(`height field is ${height.length} texels, expected ${size * size}`);
  }

  const map = new Uint8ClampedArray(size * size * RGBA_CHANNELS);

  for (let y = 0; y < size; y += 1) {
    const up = wrap(y - 1, size) * size;
    const down = wrap(y + 1, size) * size;
    const row = y * size;

    for (let x = 0; x < size; x += 1) {
      const left = wrap(x - 1, size);
      const right = wrap(x + 1, size);

      // Central difference: half the span between the two neighbours, which is
      // the slope per texel at this one.
      const du = ((height[row + right] ?? 0) - (height[row + left] ?? 0)) * 0.5;
      const dv = ((height[down + x] ?? 0) - (height[up + x] ?? 0)) * 0.5;

      const nx = -du * strength;
      const ny = -dv * strength;
      // Z is 1 before normalising, so it is strictly positive after it: the
      // encoded blue channel never drops below 128 (US2-S2).
      const length = Math.hypot(nx, ny, 1);

      const offset = (row + x) * RGBA_CHANNELS;
      map[offset] = encodeComponent(nx / length);
      map[offset + 1] = encodeComponent(ny / length);
      map[offset + 2] = encodeComponent(1 / length);
      map[offset + 3] = 255;
    }
  }

  return map;
}
