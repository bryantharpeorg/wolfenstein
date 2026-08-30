import { describe, it, expect } from 'vitest';
import { computeDesiredVelocity, type MovementKeys } from '../../src/player/locomotion';
import { WALK_SPEED, SPRINT_SPEED } from '../../src/player/params';

function keys(partial: Partial<MovementKeys>): MovementKeys {
  return {
    forward: false,
    back: false,
    left: false,
    right: false,
    sprint: false,
    ...partial,
  };
}

describe('locomotion', () => {
  it('at yaw 0, W moves along the camera forward horizontal vector (-Z)', () => {
    const vel = computeDesiredVelocity(keys({ forward: true }), 0);
    expect(vel.x).toBeCloseTo(0, 10);
    expect(vel.z).toBeCloseTo(-WALK_SPEED, 10);
  });

  it('at yaw 90°, W produces a displacement rotated 90° about the player', () => {
    const vel = computeDesiredVelocity(keys({ forward: true }), Math.PI / 2);
    expect(vel.x).toBeCloseTo(-WALK_SPEED, 10);
    expect(vel.z).toBeCloseTo(0, 10);
  });

  it('W+S produce exactly zero displacement', () => {
    const vel = computeDesiredVelocity(keys({ forward: true, back: true }), 0);
    expect(vel.x).toBe(0);
    expect(vel.z).toBe(0);
  });

  it('A+D produce exactly zero displacement', () => {
    const vel = computeDesiredVelocity(keys({ left: true, right: true }), 0);
    expect(vel.x).toBe(0);
    expect(vel.z).toBe(0);
  });

  it('W+A has magnitude equal to the single-key speed, not √2 times it', () => {
    const vel = computeDesiredVelocity(keys({ forward: true, left: true }), 0);
    const magnitude = Math.hypot(vel.x, vel.z);
    expect(magnitude).toBeCloseTo(WALK_SPEED, 10);
    expect(magnitude).not.toBeCloseTo(WALK_SPEED * Math.SQRT2, 10);
  });

  it('W+D diagonal is also normalised to the single-key speed', () => {
    const vel = computeDesiredVelocity(keys({ forward: true, right: true }), 0);
    expect(Math.hypot(vel.x, vel.z)).toBeCloseTo(WALK_SPEED, 10);
  });

  it('Shift selects a sprint speed between 1.6x and 2.0x walk, declared as named constants', () => {
    const ratio = SPRINT_SPEED / WALK_SPEED;
    expect(ratio).toBeGreaterThanOrEqual(1.6);
    expect(ratio).toBeLessThanOrEqual(2.0);

    const vel = computeDesiredVelocity(keys({ forward: true, sprint: true }), 0);
    expect(Math.hypot(vel.x, vel.z)).toBeCloseTo(SPRINT_SPEED, 10);
  });
});
