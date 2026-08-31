import { describe, it, expect } from 'vitest';
import { createRng, nextRngState, rngValue, RNG_INCREMENT } from '../../src/enemy/rng';
import { expectPure } from './enemy-pure';

// This spec's whole reproducibility claim (FR-002, US1-S9, SC-002) rests on this
// module, so it is asserted twice over: as a stream (two instances, one seed,
// identical values) and as a pure function (state in, value out, no memory).

const draw = (seed: number, count: number): number[] => {
  const rng = createRng(seed);
  return Array.from({ length: count }, () => rng.next());
};

describe('enemy rng purity (FR-001, FR-002)', () => {
  it('imports neither three nor a DOM API, and loads with no window defined', () => {
    expectPure('rng.ts');
    expect('window' in globalThis).toBe(false);
    expect(createRng).toBeTypeOf('function');
  });
});

describe('seeded sequence (US1-S9, SC-002)', () => {
  it('returns an identical sequence for seed 1234 across two independent instances', () => {
    const first = draw(1234, 200);
    const second = draw(1234, 200);
    expect(second).toEqual(first);
    expect(second.join(',')).toBe(first.join(','));
    expect(new Set(first).size, 'a constant generator is not a generator').toBe(first.length);
  });

  it('returns a different sequence for a different seed', () => {
    const a = draw(1234, 200);
    const b = draw(9999, 200);
    expect(b).not.toEqual(a);
    // Not merely different at one index: an offset stream would still be a bug.
    expect(a.filter((value, index) => value === b[index]).length).toBeLessThan(4);
  });

  it('yields 32-bit words, a unit float, a signed unit and a scaled range', () => {
    const rng = createRng(1234);
    let negatives = 0;
    for (let i = 0; i < 400; i += 1) {
      const word = rng.next();
      expect(Number.isInteger(word) && word >= 0 && word < 2 ** 32).toBe(true);
      const unit = rng.nextFloat();
      expect(unit >= 0 && unit < 1).toBe(true);
      const signed = rng.nextSigned();
      expect(signed >= -1 && signed < 1).toBe(true);
      if (signed < 0) negatives += 1;
      const scaled = rng.nextRange(-Math.PI, Math.PI);
      expect(scaled >= -Math.PI && scaled < Math.PI).toBe(true);
    }
    expect(negatives, 'a signed unit spans both signs').toBeGreaterThan(0);
  });
});

describe('pure state functions (FR-002)', () => {
  it('advances state by the declared increment and maps a state to one value', () => {
    expect(nextRngState(0)).toBe(RNG_INCREMENT | 0);
    expect(nextRngState(nextRngState(0))).toBe(((RNG_INCREMENT | 0) + RNG_INCREMENT) | 0);
    for (const state of [0, 1234, -1, 0x7fffffff, -0x80000000]) {
      expect(rngValue(state)).toBe(rngValue(state));
    }
  });

  it('reproduces the instance stream from the pure functions alone', () => {
    const rng = createRng(1234);
    let state = 1234 | 0;
    for (let i = 0; i < 50; i += 1) {
      state = nextRngState(state);
      expect(rng.next()).toBe(rngValue(state));
    }
  });

  it('exposes its live state so a caller can carry it in a record', () => {
    const rng = createRng(1234);
    rng.next();
    rng.next();
    const resumed = createRng(rng.state);
    expect(resumed.next()).toBe(rng.next());
  });
});
