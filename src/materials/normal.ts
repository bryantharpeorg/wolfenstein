// Tangent-space normals by central difference over a material's own height
// field (FR-005). Nothing here reads a colour: the only field argument this
// module accepts is the scalar surface `patterns.ts` shaded from, which is what
// keeps a mortar joint reading as a groove rather than as a dark stripe.
//
// Convention, stated once so a test can hand-compute against it:
//   * `x` increases with the column, `row` increases downward through the
//     buffer, exactly as the RGBA buffers are laid out;
//   * green points up the image (three.js / OpenGL), so `Y = +dh/drow`;
//   * `+Z` leaves the surface, so a flat region encodes to (128, 128, 255).
// Sampling wraps at both edges, so an edge texel differences against the far
// side of a tiling field instead of encoding a cliff that shows as a bright
// line at every tile boundary (Edge Cases).

import { RGBA_CHANNELS } from './constants';

/** Height units per texel of horizontal run — the relief the encoded slope is
 * measured against. One declared number, so deepening every material's relief
 * is one edit rather than five. */
export const NORMAL_STRENGTH = 8;

/** Channel units a derived texel may differ from the hand-computed encoding of
 * the same slope: one, which is the rounding of a byte (FR-005, US2-S1). */
export const NORMAL_ENCODE_TOLERANCE = 1;

/** How far a decoded texel's length may sit from 1. Quantising three channels
 * to a byte moves the length by at most ~0.007; the declared bound is the next
 * round number above that (FR-005, US2-S3). */
export const NORMAL_UNIT_TOLERANCE = 0.02;

/** The encoded flat normal: `+Z` straight out, both tangents zero. */
export const FLAT_NORMAL_ENCODED: readonly [number, number, number] = [128, 128, 255];

function encodeChannel(component: number): number {
  return Math.round((component * 0.5 + 0.5) * 255);
}

/** One texel of an encoded map, back in `-1..1` — the inverse of the encoding
 * above, and the function every length assertion is stated over. */
export function decodeNormalTexel(
  normal: Uint8ClampedArray,
  texel: number,
): readonly [number, number, number] {
  const offset = texel * RGBA_CHANNELS;
  return [
    (normal[offset]! / 255) * 2 - 1,
    (normal[offset + 1]! / 255) * 2 - 1,
    (normal[offset + 2]! / 255) * 2 - 1,
  ];
}

/**
 * Derives a tangent-space normal map from `height`, a `size * size` scalar
 * field. Central difference on both axes, wrapped, normalised, then encoded to
 * RGBA with an opaque alpha (FR-005, US2-S1, US2-S2, US2-S3).
 */
export function deriveNormalMap(
  height: Float32Array,
  size: number,
  strength: number = NORMAL_STRENGTH,
): Uint8ClampedArray {
  const normal = new Uint8ClampedArray(size * size * RGBA_CHANNELS);

  for (let row = 0; row < size; row += 1) {
    const up = ((row - 1 + size) % size) * size;
    const down = ((row + 1) % size) * size;
    const here = row * size;

    for (let x = 0; x < size; x += 1) {
      const left = (x - 1 + size) % size;
      const right = (x + 1) % size;

      // Central difference: half the span between the two neighbours.
      const dhdx = (height[here + right]! - height[here + left]!) * 0.5;
      const dhdrow = (height[down + x]! - height[up + x]!) * 0.5;

      const nx = -dhdx * strength;
      const ny = dhdrow * strength;
      const length = Math.hypot(nx, ny, 1);

      const offset = (here + x) * RGBA_CHANNELS;
      normal[offset] = encodeChannel(nx / length);
      normal[offset + 1] = encodeChannel(ny / length);
      normal[offset + 2] = encodeChannel(1 / length);
      normal[offset + 3] = 255;
    }
  }

  return normal;
}

/**
 * The declared degradation of FR-007: a map of nothing but `+Z`, so a material
 * whose derivation could not be completed lights as an unbevelled but correctly
 * textured surface rather than shipping no map at all (US2-S7).
 */
export function flatNormalMap(size: number): Uint8ClampedArray {
  const normal = new Uint8ClampedArray(size * size * RGBA_CHANNELS);
  const [r, g, b] = FLAT_NORMAL_ENCODED;
  for (let offset = 0; offset < normal.length; offset += RGBA_CHANNELS) {
    normal[offset] = r;
    normal[offset + 1] = g;
    normal[offset + 2] = b;
    normal[offset + 3] = 255;
  }
  return normal;
}
