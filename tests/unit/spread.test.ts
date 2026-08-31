import { describe, it, expect } from 'vitest';
import {
  SPREAD_SEED,
  angleFromForward,
  spreadDirection,
  spreadSequence,
  type Vec3,
} from '../../src/combat/spread';
import { WEAPON_KINDS, WEAPON_TABLE } from '../../src/combat/weapons';

// FR-005 / US1-S5 / SC-004. A missed shot has to be reproducible, so the spread
// is a pure function of (seed, shot index) and never of a call to Math.random.
// The bound is the other half: no vector may sit further from forward than the
// weapon's declared maximum, whichever way the camera happens to be pointing.

const SEED = 1234;
const SHOTS = 20;
const FORWARD: Vec3 = { x: 0, y: 0, z: -1 };
/** Slack for the trigonometry, far below any spread the table declares. */
const ANGLE_EPSILON = 1e-12;

function unitLength(v: Vec3): number {
  return Math.hypot(v.x, v.y, v.z);
}

describe('seeded spread reproduces (FR-005, US1-S5, SC-004)', () => {
  it('produces the identical twenty vectors on a second run at seed 1234', () => {
    const first = spreadSequence(FORWARD, WEAPON_TABLE.pistol.maxSpreadRadians, SEED, SHOTS);
    const second = spreadSequence(FORWARD, WEAPON_TABLE.pistol.maxSpreadRadians, SEED, SHOTS);
    expect(first).toHaveLength(SHOTS);
    expect(first).toEqual(second);
  });

  it('is a function of the shot index alone, not of call order', () => {
    const sequence = spreadSequence(FORWARD, WEAPON_TABLE.smg.maxSpreadRadians, SEED, SHOTS);
    // Asked for backwards, one at a time, the same indices give the same vectors.
    for (let index = SHOTS - 1; index >= 0; index -= 1) {
      expect(
        spreadDirection(FORWARD, WEAPON_TABLE.smg.maxSpreadRadians, SEED, index),
      ).toEqual(sequence[index]);
    }
  });

  it('diverges on a different seed, so the seed is load-bearing', () => {
    const a = spreadSequence(FORWARD, WEAPON_TABLE.smg.maxSpreadRadians, SEED, SHOTS);
    const b = spreadSequence(FORWARD, WEAPON_TABLE.smg.maxSpreadRadians, SEED + 1, SHOTS);
    expect(a).not.toEqual(b);
  });

  it('declares its own default seed', () => {
    expect(Number.isFinite(SPREAD_SEED)).toBe(true);
  });
});

describe('every vector is bounded by the declared maximum (FR-005, US1-S5)', () => {
  it.each([...WEAPON_KINDS])('%s stays at or below its declared spread', (kind) => {
    const max = WEAPON_TABLE[kind].maxSpreadRadians;
    for (let index = 0; index < SHOTS; index += 1) {
      const direction = spreadDirection(FORWARD, max, SEED, index);
      expect(unitLength(direction)).toBeCloseTo(1, 12);
      expect(angleFromForward(FORWARD, direction)).toBeLessThanOrEqual(max + ANGLE_EPSILON);
    }
  });

  it('holds the bound for a forward axis that is neither unit nor axis-aligned', () => {
    const forward: Vec3 = { x: 3, y: -1.5, z: 2 };
    const max = WEAPON_TABLE.chaingun.maxSpreadRadians;
    for (let index = 0; index < SHOTS; index += 1) {
      const direction = spreadDirection(forward, max, SEED, index);
      expect(unitLength(direction)).toBeCloseTo(1, 12);
      expect(angleFromForward(forward, direction)).toBeLessThanOrEqual(max + ANGLE_EPSILON);
    }
  });

  it('spreads a chaingun visibly wider than a pistol over the same seed', () => {
    const widest = (max: number): number =>
      Math.max(
        ...spreadSequence(FORWARD, max, SEED, SHOTS).map((v) => angleFromForward(FORWARD, v)),
      );
    expect(widest(WEAPON_TABLE.chaingun.maxSpreadRadians)).toBeGreaterThan(
      widest(WEAPON_TABLE.pistol.maxSpreadRadians),
    );
  });

  it('actually deflects: twenty pistol shots are not twenty copies of forward', () => {
    const angles = spreadSequence(FORWARD, WEAPON_TABLE.pistol.maxSpreadRadians, SEED, SHOTS).map(
      (v) => angleFromForward(FORWARD, v),
    );
    expect(Math.max(...angles)).toBeGreaterThan(0);
    expect(new Set(angles).size).toBe(SHOTS);
  });

  it('returns the normalised forward when the declared spread is zero', () => {
    const direction = spreadDirection({ x: 0, y: 0, z: -2 }, 0, SEED, 0);
    expect(direction.x).toBeCloseTo(0, 12);
    expect(direction.y).toBeCloseTo(0, 12);
    expect(direction.z).toBeCloseTo(-1, 12);
  });

  it('measures zero angle between a vector and itself', () => {
    expect(angleFromForward(FORWARD, FORWARD)).toBeCloseTo(0, 12);
  });
});
