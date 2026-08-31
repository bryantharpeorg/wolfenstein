// The seeded 32-bit PRNG every guard decision draws from. Pure: no DOM, no
// three.js (FR-001). This module is the whole of the spec's reproducibility
// claim (FR-002, US1-S9, SC-002) — if two runs of the same script diverge, they
// diverge here first.
//
// The generator is mulberry32: one 32-bit word of state, advanced by a fixed
// increment and avalanched into the output. It is written as two exported pure
// functions — `nextRngState` and `rngValue` — with the stateful `Rng` handle a
// thin wrapper over them, so a caller that wants to carry the generator inside a
// record (as `stepGuard` does) can do so with a single number.

/** The state increment. Mulberry32's odd constant; declared, not inlined. */
export const RNG_INCREMENT = 0x6d2b79f5;

/** 2^32, the divisor that turns a `next()` word into a float in [0, 1). */
export const RNG_RANGE = 2 ** 32;

/** The successor of a generator state. Pure, total, and its own inverse-free. */
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

/**
 * A live generator. `state` is the whole of it: two handles created from the
 * same state produce the same stream from that point on, which is what lets a
 * guard record carry its generator across ticks.
 */
export interface Rng {
  /** The current 32-bit state, as a signed int32. */
  state: number;
  /** Advances the state and returns the next unsigned 32-bit word. */
  next(): number;
  /** The next value as a float in [0, 1). */
  nextFloat(): number;
  /** The next value as a float in [-1, 1) — a signed unit for turn deltas. */
  nextSigned(): number;
  /** The next value scaled into [min, max). */
  nextRange(min: number, max: number): number;
}

export function createRng(seed: number): Rng {
  const rng: Rng = {
    state: seed | 0,
    next(): number {
      rng.state = nextRngState(rng.state);
      return rngValue(rng.state);
    },
    nextFloat(): number {
      return rng.next() / RNG_RANGE;
    },
    nextSigned(): number {
      return rng.nextFloat() * 2 - 1;
    },
    nextRange(min: number, max: number): number {
      return min + rng.nextFloat() * (max - min);
    },
  };
  return rng;
}
