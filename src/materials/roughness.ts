// Roughness from the same height field the normal map is differentiated from,
// inside the band each material declares in `table.ts` (FR-006, US2-S5). The
// bands do the ordering — steel 0.12..0.34 against stone 0.70..1.00 — and the
// driving field is standardised, centred on its own mean and scaled by its own
// spread, before it is mapped into the band, so each material lands near the
// middle of its own band and two overlapping bands cannot cross.
import { RGBA_CHANNELS } from './constants';
import type { RoughnessRange } from './table';

/** Standard deviations of the driving field that span the declared band. */
export const ROUGHNESS_DETAIL_SPREAD = 4;
/** Depth weight: a recess — mortar, a pit, a groove — is the rougher part. */
export const ROUGHNESS_DEPTH_WEIGHT = 0.6;
/** Relief weight. The two sum to 1 so the field stays comparable. */
export const ROUGHNESS_RELIEF_WEIGHT = 0.4;
/** The declared constant FR-007 ships when a derivation cannot be completed. */
export const FALLBACK_ROUGHNESS = 0.6;

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const wrap = (c: number, n: number): number => ((c % n) + n) % n;

export const encodeRoughness = (v: number): number => Math.round(clamp01(v) * 255);

/** One texel decoded back to 0..1 (FR-006). */
export const decodeRoughness = (map: Uint8ClampedArray, texel: number): number =>
  (map[texel * RGBA_CHANNELS + 1] ?? 0) / 255;

/** The mean of a decoded map — the statistic US2-S5 orders materials on. */
export function roughnessMean(map: Uint8ClampedArray): number {
  const texels = map.length / RGBA_CHANNELS;
  let total = 0;
  for (let i = 0; i < texels; i += 1) total += map[i * RGBA_CHANNELS + 1] ?? 0;
  return total / texels / 255;
}

function writeGrey(map: Uint8ClampedArray, texel: number, byte: number): void {
  const o = texel * RGBA_CHANNELS;
  map[o] = byte;
  map[o + 1] = byte;
  map[o + 2] = byte;
  map[o + 3] = 255;
}

/** A map every texel of which decodes to one value, clamped into 0..1. */
export function constantRoughnessMap(size: number, value: number): Uint8ClampedArray {
  const map = new Uint8ClampedArray(size * size * RGBA_CHANNELS);
  const byte = encodeRoughness(value);
  for (let i = 0; i < size * size; i += 1) writeGrey(map, i, byte);
  return map;
}

/** How deep a texel sits and how much relief surrounds it, wrapped the way the
 * normal derivation wraps so the two agree at a tile boundary. */
function drivingField(height: Float32Array, size: number): Float32Array {
  const field = new Float32Array(size * size);
  for (let y = 0; y < size; y += 1) {
    const row = y * size;
    const up = wrap(y - 1, size) * size;
    const down = wrap(y + 1, size) * size;
    for (let x = 0; x < size; x += 1) {
      const du = (height[row + wrap(x + 1, size)] ?? 0) - (height[row + wrap(x - 1, size)] ?? 0);
      const dv = (height[down + x] ?? 0) - (height[up + x] ?? 0);
      field[row + x] =
        ROUGHNESS_DEPTH_WEIGHT * -(height[row + x] ?? 0) +
        ROUGHNESS_RELIEF_WEIGHT * Math.hypot(du, dv) * 0.5;
    }
  }
  return field;
}

/** The roughness map of one height field inside one material's band, on the
 * same grid as the albedo and the normal (US2-S6). A field with no variation
 * lands on the band's midpoint: there is nothing to spend the band on. */
export function deriveRoughnessMap(
  height: Float32Array,
  size: number,
  range: RoughnessRange,
): Uint8ClampedArray {
  if (height.length !== size * size) throw new Error(`height field is not ${size} x ${size}`);
  const texels = size * size;
  const field = drivingField(height, size);
  let sum = 0;
  for (let i = 0; i < texels; i += 1) sum += field[i] ?? 0;
  const mean = sum / texels;
  let variance = 0;
  for (let i = 0; i < texels; i += 1) variance += ((field[i] ?? 0) - mean) ** 2;
  const deviation = Math.sqrt(variance / texels);
  const scale = deviation === 0 ? 0 : 1 / (ROUGHNESS_DETAIL_SPREAD * deviation);
  const span = range.max - range.min;
  const map = new Uint8ClampedArray(texels * RGBA_CHANNELS);
  for (let i = 0; i < texels; i += 1) {
    const standardised = clamp01(0.5 + ((field[i] ?? 0) - mean) * scale);
    writeGrey(map, i, encodeRoughness(range.min + span * standardised));
  }
  return map;
}
