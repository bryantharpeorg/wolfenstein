// Tangent-space normals by central difference over a material's own height
// field, never over its albedo's luminance (FR-005). Tangents of h are
// (1,0,dh/du) and (0,1,dh/dv), so N = normalize(-dh/du, -dh/dv, 1): +Z out of
// the surface everywhere, and a flat region on exactly (128, 128, 255).
import { RGBA_CHANNELS } from './constants';

/** Height units per texel turned into slope: the one knob on relief depth. */
export const NORMAL_STRENGTH = 8;
/** How far a decoded normal may sit from the hand-computed vector (US2-S2). */
export const NORMAL_DECODE_TOLERANCE = 0.01;
/** How far its length may sit from 1: quantising three channels costs at most
 * sqrt(3)/255 ~= 0.0068 (US2-S3). */
export const NORMAL_UNIT_TOLERANCE = 0.01;
/** Flat, opaque — what FR-007's fallback map is filled with. */
export const FLAT_NORMAL_ENCODED: readonly [number, number, number, number] = [128, 128, 255, 255];

/** Wrapped sampling: clamping halves the difference at the edge and encodes a
 * cliff, which a repeating texture shows as a line at every tile boundary. */
const wrap = (c: number, n: number): number => ((c % n) + n) % n;

export const encodeComponent = (v: number): number => Math.round((v + 1) * 0.5 * 255);
export const decodeComponent = (b: number): number => (b / 255) * 2 - 1;

/** One texel decoded from 0..255 back to -1..1 (US2-S3). */
export function decodeNormalTexel(map: Uint8ClampedArray, texel: number): [number, number, number] {
  const o = texel * RGBA_CHANNELS;
  return [
    decodeComponent(map[o] ?? 0),
    decodeComponent(map[o + 1] ?? 0),
    decodeComponent(map[o + 2] ?? 0),
  ];
}

/** Every texel (0, 0, 1): a surface that lights flat, never one that does not
 * light at all — the degraded map FR-007 ships. */
export function flatNormalMap(size: number): Uint8ClampedArray {
  const map = new Uint8ClampedArray(size * size * RGBA_CHANNELS);
  for (let i = 0; i < size * size; i += 1) map.set(FLAT_NORMAL_ENCODED, i * RGBA_CHANNELS);
  return map;
}

/** The normal map of one height field: size*size scalars row-major, the same
 * grid and UV space as the albedo shaded alongside it (US2-S6). */
export function deriveNormalMap(
  height: Float32Array,
  size: number,
  strength: number = NORMAL_STRENGTH,
): Uint8ClampedArray {
  if (height.length !== size * size) throw new Error(`height field is not ${size} x ${size}`);
  const map = new Uint8ClampedArray(size * size * RGBA_CHANNELS);
  for (let y = 0; y < size; y += 1) {
    const row = y * size;
    const up = wrap(y - 1, size) * size;
    const down = wrap(y + 1, size) * size;
    for (let x = 0; x < size; x += 1) {
      const du = ((height[row + wrap(x + 1, size)] ?? 0) - (height[row + wrap(x - 1, size)] ?? 0)) / 2;
      const dv = ((height[down + x] ?? 0) - (height[up + x] ?? 0)) / 2;
      const nx = -du * strength;
      const ny = -dv * strength;
      // Z is 1 before normalising, so it is strictly positive after it.
      const len = Math.hypot(nx, ny, 1);
      const o = (row + x) * RGBA_CHANNELS;
      map[o] = encodeComponent(nx / len);
      map[o + 1] = encodeComponent(ny / len);
      map[o + 2] = encodeComponent(1 / len);
      map[o + 3] = 255;
    }
  }
  return map;
}
