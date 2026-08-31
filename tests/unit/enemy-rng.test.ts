import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  createRng,
  nextRngState,
  rngValue,
  RNG_INCREMENT,
} from '../../src/enemy/rng';

// The whole of this spec's reproducibility claim (FR-002, US1-S9, SC-002) rests on
// this module, so it is asserted twice over: as a stream (two instances, one seed,
// identical values) and as a pure function (state in, value out, no hidden memory).

const THREE_IMPORT = /(from\s+['"]three['"]|import\s+['"]three['"]|require\(\s*['"]three['"]\s*\))/;
const DOM_GLOBAL =
  /\b(window|document|navigator|localStorage|sessionStorage|HTMLElement|HTMLCanvasElement|CanvasRenderingContext2D|requestAnimationFrame|addEventListener|getElementById|createElement)\b/;

const draw = (seed: number, count: number): number[] => {
  const rng = createRng(seed);
  return Array.from({ length: count }, () => rng.next());
};

describe('enemy rng purity (FR-001, FR-002)', () => {
  it('imports neither three nor a DOM API', () => {
    const source = readFileSync(new URL('../../src/enemy/rng.ts', import.meta.url), 'utf8');
    expect(THREE_IMPORT.test(source)).toBe(false);
    expect(DOM_GLOBAL.test(source)).toBe(false);
  });

  it('loads in an environment with no window defined', () => {
    expect('window' in globalThis).toBe(false);
    expect(createRng).toBeTypeOf('function');
  });
});

describe('seeded sequence (US1-S9, SC-002)', () => {
  it('returns an identical value sequence for seed 1234 across two independent instances', () => {
    const first = draw(1234, 200);
    const second = draw(1234, 200);
    expect(second).toEqual(first);
    expect(second.join(',')).toBe(first.join(','));
  });

  it('returns a different sequence for a different seed', () => {
    const a = draw(1234, 200);
    const b = draw(9999, 200);
    expect(b).not.toEqual(a);
    // Not merely different at one index: an offset stream would still be a bug.
    const shared = a.filter((value, index) => value === b[index]).length;
    expect(shared).toBeLessThan(4);
  });

  it('does not repeat its first value within a short run, and is not constant', () => {
    const values = draw(1234, 64);
    expect(new Set(values).size).toBe(64);
  });
});

describe('value range', () => {
  it('yields unsigned 32-bit integers', () => {
    const rng = createRng(7);
    for (let i = 0; i < 500; i += 1) {
      const value = rng.next();
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(2 ** 32);
    }
  });

  it('yields floats in [0, 1)', () => {
    const rng = createRng(1234);
    for (let i = 0; i < 500; i += 1) {
      const value = rng.nextFloat();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('yields a signed unit in [-1, 1)', () => {
    const rng = createRng(1234);
    let sawNegative = false;
    let sawPositive = false;
    for (let i = 0; i < 500; i += 1) {
      const value = rng.nextSigned();
      expect(value).toBeGreaterThanOrEqual(-1);
      expect(value).toBeLessThan(1);
      if (value < 0) sawNegative = true;
      if (value > 0) sawPositive = true;
    }
    expect(sawNegative && sawPositive).toBe(true);
  });
});

describe('pure state functions (FR-002)', () => {
  it('advances state by the declared increment', () => {
    expect(nextRngState(0)).toBe(RNG_INCREMENT | 0);
    expect(nextRngState(nextRngState(0))).toBe(((RNG_INCREMENT | 0) + RNG_INCREMENT) | 0);
  });

  it('maps a state to the same value every time it is asked', () => {
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
