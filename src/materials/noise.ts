// Tiling value noise and its fbm octave sum, built on the seeded hash in
// `rng.ts`. Every layer is periodic over the unit square, so a texture that
// repeats across a merged wall run has no seam at the buffer edge (FR-001,
// FR-003, US1-S6).

import { hash2d } from './rng';

/** Per-octave seed stride: octaves must not share a lattice. */
const OCTAVE_STRIDE = 0x9e37;

export interface FbmOptions {
  /** Lattice cells across the texture's width on the first octave. */
  readonly periodX: number;
  /** Lattice cells across the texture's height on the first octave. Differing
   * from `periodX` is what makes a brushed or grained surface anisotropic. */
  readonly periodY: number;
  readonly octaves: number;
  /** Amplitude falloff per octave; 0.5 unless a material says otherwise. */
  readonly gain?: number;
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

function wrap(index: number, period: number): number {
  return ((index % period) + period) % period;
}

function lattice(seed: number, periodX: number, periodY: number): Float32Array {
  const cells = new Float32Array(periodX * periodY);
  for (let y = 0; y < periodY; y += 1) {
    for (let x = 0; x < periodX; x += 1) {
      cells[y * periodX + x] = hash2d(seed, x, y);
    }
  }
  return cells;
}

function sampleLattice(
  cells: Float32Array,
  periodX: number,
  periodY: number,
  u: number,
  v: number,
): number {
  const fx = u * periodX;
  const fy = v * periodY;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = smoothstep(fx - x0);
  const ty = smoothstep(fy - y0);
  const xa = wrap(x0, periodX);
  const xb = wrap(x0 + 1, periodX);
  const ya = wrap(y0, periodY) * periodX;
  const yb = wrap(y0 + 1, periodY) * periodX;
  const top = cells[ya + xa]! + (cells[ya + xb]! - cells[ya + xa]!) * tx;
  const bottom = cells[yb + xa]! + (cells[yb + xb]! - cells[yb + xa]!) * tx;
  return top + (bottom - top) * ty;
}

/** One fbm sample in `[0, 1]` at a point of the unit square. */
export function fbm2D(seed: number, u: number, v: number, options: FbmOptions): number {
  const gain = options.gain ?? 0.5;
  let amplitude = 1;
  let total = 0;
  let sum = 0;
  for (let octave = 0; octave < options.octaves; octave += 1) {
    const scale = 2 ** octave;
    const periodX = options.periodX * scale;
    const periodY = options.periodY * scale;
    const cells = lattice(seed + octave * OCTAVE_STRIDE, periodX, periodY);
    sum += amplitude * sampleLattice(cells, periodX, periodY, u, v);
    total += amplitude;
    amplitude *= gain;
  }
  return sum / total;
}

/**
 * The same fbm evaluated across a whole `size x size` field, in `[0, 1]`. The
 * lattices are built once per octave rather than once per texel, which is what
 * keeps five 512px materials inside the generation budget (US1-S8).
 */
export function fbmField(seed: number, size: number, options: FbmOptions): Float32Array {
  const gain = options.gain ?? 0.5;
  const field = new Float32Array(size * size);
  let amplitude = 1;
  let total = 0;
  for (let octave = 0; octave < options.octaves; octave += 1) {
    const scale = 2 ** octave;
    const periodX = options.periodX * scale;
    const periodY = options.periodY * scale;
    const cells = lattice(seed + octave * OCTAVE_STRIDE, periodX, periodY);
    for (let y = 0; y < size; y += 1) {
      const v = (y + 0.5) / size;
      const row = y * size;
      for (let x = 0; x < size; x += 1) {
        const index = row + x;
        const carried = field[index] ?? 0;
        field[index] = carried + amplitude * sampleLattice(cells, periodX, periodY, (x + 0.5) / size, v);
      }
    }
    total += amplitude;
    amplitude *= gain;
  }
  for (let i = 0; i < field.length; i += 1) field[i] = (field[i] ?? 0) / total;
  return field;
}

/** A ridged fold of an fbm value: 1 at the crest, 0 at the extremes. Veins and
 * cracks are ridges, not blobs. */
export function ridge(value: number): number {
  return 1 - Math.abs(value * 2 - 1);
}
