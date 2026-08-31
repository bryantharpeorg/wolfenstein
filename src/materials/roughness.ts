// Roughness from the same height field the normal map is differentiated from,
// mapped into the band each material declares in `table.ts` (FR-006, US2-S5).
// Pure data in, pure data out: no three.js, no DOM.
//
// Why the bands do the ordering. `steel` declares 0.12..0.34 and `stone`
// declares 0.70..1.00, so steel reads smoother than stone *by construction* —
// there is no shared scale on which a lucky height field could reverse them.
// What this module must not do is spend a whole band on one material and none
// on another, because two bands that overlap (`wood` 0.45..0.78 against
// `stone` 0.70..1.00) would then be free to cross. So the driving field is
// standardised — centred on its own mean and scaled by its own spread — before
// it is mapped into the band. Every material therefore lands near the middle of
// its own band, and the declared order is the order that comes out.

import { RGBA_CHANNELS } from './constants';
import type { RoughnessRange } from './table';

/** How many standard deviations of the driving field span the declared band.
 * Wider spends less of the band on the common case; narrower saturates. */
export const ROUGHNESS_DETAIL_SPREAD = 4;

/** How much of the driving field is the height itself. A recess — mortar, a
 * pit, a plank groove — is the rougher part of a surface. */
export const ROUGHNESS_DEPTH_WEIGHT = 0.6;

/** How much of it is local relief. Fine structure scatters light; a polished
 * face does not. The two weights sum to 1 so the field stays comparable. */
export const ROUGHNESS_RELIEF_WEIGHT = 0.4;

/** What FR-007 ships when a roughness derivation cannot be completed: one
 * declared constant, midway between a polished and a raw surface, so a degraded
 * material still lights rather than reading as a mirror or as chalk. */
export const FALLBACK_ROUGHNESS = 0.6;

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** Encodes a `0..1` roughness into the byte the map stores. */
export function encodeRoughness(value: number): number {
  return Math.round(clamp01(value) * 255);
}

/** Decodes the roughness at one texel index back to `0..1` (FR-006). */
export function decodeRoughness(map: Uint8ClampedArray, texelIndex: number): number {
  return (map[texelIndex * RGBA_CHANNELS + 1] ?? 0) / 255;
}

/** The mean of a decoded roughness map — the statistic US2-S5 orders on. */
export function roughnessMean(map: Uint8ClampedArray): number {
  const texels = map.length / RGBA_CHANNELS;
  let total = 0;
  for (let i = 0; i < texels; i += 1) total += map[i * RGBA_CHANNELS + 1] ?? 0;
  return total / texels / 255;
}

function writeGrey(map: Uint8ClampedArray, texelIndex: number, byte: number): void {
  const offset = texelIndex * RGBA_CHANNELS;
  map[offset] = byte;
  map[offset + 1] = byte;
  map[offset + 2] = byte;
  map[offset + 3] = 255;
}

/** A map every texel of which decodes to one value, clamped into `0..1`. */
export function constantRoughnessMap(size: number, value: number): Uint8ClampedArray {
  const map = new Uint8ClampedArray(size * size * RGBA_CHANNELS);
  const byte = encodeRoughness(value);
  for (let i = 0; i < size * size; i += 1) writeGrey(map, i, byte);
  return map;
}

function wrap(coordinate: number, size: number): number {
  return ((coordinate % size) + size) % size;
}

/**
 * The field the band is spent on: how deep a texel sits, and how much relief
 * surrounds it. Sampled with the same wrap the normal derivation uses, so the
 * two maps agree at a tile boundary.
 */
function drivingField(height: Float32Array, size: number): Float32Array {
  const field = new Float32Array(size * size);

  for (let y = 0; y < size; y += 1) {
    const up = wrap(y - 1, size) * size;
    const down = wrap(y + 1, size) * size;
    const row = y * size;

    for (let x = 0; x < size; x += 1) {
      const here = height[row + x] ?? 0;
      const du = (height[row + wrap(x + 1, size)] ?? 0) - (height[row + wrap(x - 1, size)] ?? 0);
      const dv = (height[down + x] ?? 0) - (height[up + x] ?? 0);
      const relief = Math.hypot(du, dv) * 0.5;
      field[row + x] = ROUGHNESS_DEPTH_WEIGHT * -here + ROUGHNESS_RELIEF_WEIGHT * relief;
    }
  }

  return field;
}

/**
 * The roughness map of one height field, inside one material's declared band.
 * `height` is `size * size` scalars on the same grid as the albedo and the
 * normal map, so all three are addressable by one UV (US2-S6).
 *
 * A height field with no variation at all has nothing to spend the band on, so
 * it lands on the band's midpoint rather than on either end.
 */
export function deriveRoughnessMap(
  height: Float32Array,
  size: number,
  range: RoughnessRange,
): Uint8ClampedArray {
  if (height.length !== size * size) {
    throw new Error(`height field is ${height.length} texels, expected ${size * size}`);
  }

  const texels = size * size;
  const field = drivingField(height, size);

  let sum = 0;
  for (let i = 0; i < texels; i += 1) sum += field[i] ?? 0;
  const mean = sum / texels;

  let variance = 0;
  for (let i = 0; i < texels; i += 1) {
    const delta = (field[i] ?? 0) - mean;
    variance += delta * delta;
  }
  const deviation = Math.sqrt(variance / texels);

  const span = range.max - range.min;
  const map = new Uint8ClampedArray(texels * RGBA_CHANNELS);

  if (deviation === 0) {
    const byte = encodeRoughness(range.min + span * 0.5);
    for (let i = 0; i < texels; i += 1) writeGrey(map, i, byte);
    return map;
  }

  const scale = 1 / (ROUGHNESS_DETAIL_SPREAD * deviation);
  for (let i = 0; i < texels; i += 1) {
    const standardised = clamp01(0.5 + ((field[i] ?? 0) - mean) * scale);
    writeGrey(map, i, encodeRoughness(range.min + span * standardised));
  }

  return map;
}
