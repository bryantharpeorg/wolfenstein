// The seeded 32-bit PRNG every guard decision draws from (mulberry32). Pure: no
// DOM, no three.js (FR-001). The spec's reproducibility claim rests here (FR-002,
// US1-S9, SC-002) — if two runs of one script diverge, they diverge here first.
// The pure state functions are exported and the `Rng` handle wraps them, so a
// caller carrying the generator in a record carries a single number.

/** The state increment. Mulberry32's odd constant; declared, not inlined. */
export const RNG_INCREMENT = 0x6d2b79f5;

/** 2^32, the divisor that turns a `next()` word into a float in [0, 1). */
export const RNG_RANGE = 2 ** 32;

/** The successor of a generator state. Pure and total. */
export function nextRngState(state: number): number {
  return (state + RNG_INCREMENT) | 0;
}

/** The unsigned 32-bit value a generator state stands for. Pure. */
export function rngValue(state: number): number {
  let word = state | 0;
  word = Math.imul(word ^ (word >>> 15), word | 1);
  word ^= word + Math.imul(word ^ (word >>> 7), word | 61);
  return (word ^ (word >>> 14)) >>> 0;
}

/** A live generator: `state` is the whole of it, so two handles made from one
 *  state produce one stream. */
export interface Rng {
  /** The current state, as a signed int32. */
  state: number;
  /** Advances the state and returns an unsigned 32-bit word. */
  next(): number;
  /** That word as a float in [0, 1). */
  nextFloat(): number;
  /** As a float in [-1, 1) — a signed unit for turn deltas. */
  nextSigned(): number;
  nextRange(min: number, max: number): number;
}

export function createRng(seed: number): Rng {
  const rng: Rng = {
    state: seed | 0,
    next(): number {
      rng.state = nextRngState(rng.state);
      return rngValue(rng.state);
    },
    nextFloat: () => rng.next() / RNG_RANGE,
    nextSigned: () => rng.nextFloat() * 2 - 1,
    nextRange: (min, max) => min + rng.nextFloat() * (max - min),
  };
  return rng;
}
