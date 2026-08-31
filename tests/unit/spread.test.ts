import { describe, it, expect } from 'vitest';
import {
  SPREAD_SEED, angleFromForward, spreadDirection, spreadSequence, type Vec3,
} from '../../src/combat/spread';
import { WEAPON_KINDS, WEAPON_TABLE, type WeaponKind } from '../../src/combat/weapons';

// FR-005 / US1-S5 / SC-004. A missed shot has to be reproducible, so spread is a
// pure function of (seed, shot index), never of Math.random; the bound is the
// other half, whichever way the camera points.

const SEED = 1234;
const SHOTS = 20;
const FORWARD: Vec3 = { x: 0, y: 0, z: -1 };
/** Slack for the trigonometry, far below any spread the table declares. */
const ANGLE_EPSILON = 1e-12;

const unit = (v: Vec3) => Math.hypot(v.x, v.y, v.z);
const spread = (kind: WeaponKind) => WEAPON_TABLE[kind].maxSpreadRadians;
const angles = (forward: Vec3, max: number) =>
  spreadSequence(forward, max, SEED, SHOTS).map((v) => angleFromForward(forward, v));

describe('seeded spread reproduces (FR-005, US1-S5, SC-004)', () => {
  it('produces the identical twenty vectors on a second run at seed 1234', () => {
    const first = spreadSequence(FORWARD, spread('pistol'), SEED, SHOTS);
    expect(first).toHaveLength(SHOTS);
    expect(first).toEqual(spreadSequence(FORWARD, spread('pistol'), SEED, SHOTS));
  });

  it('is a function of the shot index alone, not of call order', () => {
    const sequence = spreadSequence(FORWARD, spread('smg'), SEED, SHOTS);
    // Asked for backwards, one at a time, the same indices give the same vectors.
    for (let i = SHOTS - 1; i >= 0; i -= 1) {
      expect(spreadDirection(FORWARD, spread('smg'), SEED, i)).toEqual(sequence[i]);
    }
  });

  it('diverges on a different seed, so the seed is load-bearing', () => {
    expect(spreadSequence(FORWARD, spread('smg'), SEED, SHOTS)).not.toEqual(
      spreadSequence(FORWARD, spread('smg'), SEED + 1, SHOTS),
    );
    expect(Number.isFinite(SPREAD_SEED)).toBe(true);
  });
});

describe('every vector is bounded by the declared maximum (FR-005, US1-S5)', () => {
  it.each([...WEAPON_KINDS])('%s stays at or below its declared spread', (kind) => {
    for (let i = 0; i < SHOTS; i += 1) {
      const direction = spreadDirection(FORWARD, spread(kind), SEED, i);
      expect(unit(direction)).toBeCloseTo(1, 12);
      expect(angleFromForward(FORWARD, direction)).toBeLessThanOrEqual(spread(kind) + ANGLE_EPSILON);
    }
  });

  it('holds the bound for a forward axis that is neither unit nor axis-aligned', () => {
    const forward: Vec3 = { x: 3, y: -1.5, z: 2 };
    for (let i = 0; i < SHOTS; i += 1) {
      const direction = spreadDirection(forward, spread('chaingun'), SEED, i);
      expect(unit(direction)).toBeCloseTo(1, 12);
      expect(angleFromForward(forward, direction)).toBeLessThanOrEqual(
        spread('chaingun') + ANGLE_EPSILON,
      );
    }
  });

  it('deflects, widest for a chaingun, and not at all at a declared spread of zero', () => {
    // Twenty pistol shots are twenty distinct deflections, not twenty forwards.
    const pistol = angles(FORWARD, spread('pistol'));
    expect(Math.max(...pistol)).toBeGreaterThan(0);
    expect(new Set(pistol).size).toBe(SHOTS);
    expect(Math.max(...angles(FORWARD, spread('chaingun')))).toBeGreaterThan(Math.max(...pistol));

    const straight = spreadDirection({ x: 0, y: 0, z: -2 }, 0, SEED, 0);
    expect(straight.x).toBeCloseTo(0, 12);
    expect(straight.y).toBeCloseTo(0, 12);
    expect(straight.z).toBeCloseTo(-1, 12);
    expect(angleFromForward(FORWARD, FORWARD)).toBeCloseTo(0, 12);
  });
});
