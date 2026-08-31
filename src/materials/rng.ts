// Seeded randomness and buffer hashing: the two primitives that make a texture
// regression a diff rather than an opinion (FR-003, US1-S4). Pure integer maths
// — one `(seed, size)` pair yields one byte-identical stream on every run.

const MULBERRY_STEP = 0x6d2b79f5;
const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;
const UINT32 = 4294967296;

/**
 * A mulberry32 stream: 32 bits of state, one multiply-shift round per draw,
 * values in `[0, 1)`. Deterministic for a given seed on every engine, because
 * every step is integer arithmetic through `Math.imul`.
 */
export function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + MULBERRY_STEP) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / UINT32;
  };
}

/**
 * A stateless hash of a lattice coordinate, in `[0, 1)`. The noise layers need
 * a value at `(x, y)` without walking a stream to get there — that is what lets
 * a tiling lattice be rebuilt identically at any size.
 */
export function hash2d(seed: number, x: number, y: number): number {
  let h = (Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ (seed | 0)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / UINT32;
}

/**
 * FNV-1a over the bytes of a generated buffer, as eight hex digits. Two runs at
 * one seed hash equal; two seeds do not (US1-S4).
 */
export function hashBuffer(buffer: ArrayLike<number>): string {
  let hash = FNV_OFFSET;
  for (let i = 0; i < buffer.length; i += 1) {
    hash = Math.imul(hash ^ (buffer[i]! & 0xff), FNV_PRIME);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
